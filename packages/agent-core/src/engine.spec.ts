import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ProviderError } from '@focusloop/llm-provider';
import type { AIProvider } from '@focusloop/shared-types';
import { EngineError } from './engine';
import { DEMO_COURSE_ID } from './demo-course';
import { createTestEngine, type TestEngine } from './test-helpers';

function failingProvider(): AIProvider {
  return {
    id: 'deepseek',
    model: 'deepseek-chat',
    offline: false,
    complete: async () => {
      throw new ProviderError('offline', 'deepseek', 'no network in this test');
    },
  };
}

describe('FocusLoopEngine', () => {
  let ctx: TestEngine;

  beforeEach(() => {
    ctx = createTestEngine();
  });

  afterEach(() => {
    ctx.close();
  });

  describe('settings', () => {
    it('defaults to English and the system theme when nothing has been chosen', () => {
      expect(ctx.engine.getSettings()).toEqual({ locale: 'en', theme: 'system' });
    });

    it('remembers the chosen language', () => {
      expect(ctx.engine.setLocale('zh')).toEqual({ locale: 'zh', theme: 'system' });
      expect(ctx.engine.getSettings().locale).toBe('zh');
    });

    it('remembers the chosen theme without disturbing the language', () => {
      ctx.engine.setLocale('zh');
      expect(ctx.engine.setTheme('light')).toEqual({ locale: 'zh', theme: 'light' });
      expect(ctx.engine.getSettings()).toEqual({ locale: 'zh', theme: 'light' });
    });

    it('ignores a language nobody wrote wording for', () => {
      ctx.engine.setLocale('fr' as never);
      expect(ctx.engine.getSettings().locale).toBe('en');
    });

    it('ignores a theme nobody implemented', () => {
      ctx.engine.setTheme('sepia' as never);
      expect(ctx.engine.getSettings().theme).toBe('system');
    });
  });

  describe('insights', () => {
    it('returns an empty window before anything has been recorded', () => {
      const summary = ctx.engine.getInsights('week');
      expect(summary.range).toBe('week');
      expect(summary.totalMs).toBe(0);
      expect(summary.sessionCount).toBe(0);
      expect(summary.daily).toHaveLength(7);
    });

    it('aggregates a real session out of the stored event log', () => {
      const session = ctx.engine.startSession(DEMO_COURSE_ID).session;
      ctx.engine.dispatch({
        sessionId: session.id,
        type: 'TASK_STARTED',
        source: 'user',
        payload: { taskId: 'rbt-t1' },
      });
      ctx.clock.advance(30_000);
      ctx.engine.dispatch({
        sessionId: session.id,
        type: 'TASK_COMPLETED',
        source: 'user',
        payload: { taskId: 'rbt-t1' },
      });

      const summary = ctx.engine.getInsights('session');
      expect(summary.sessionCount).toBe(1);
      expect(summary.totalMs).toBe(30_000);
      expect(summary.tasksCompleted).toBe(1);
      expect(summary.stateShares.reduce((sum, s) => sum + s.durationMs, 0)).toBe(summary.totalMs);
      expect(summary.courseShares[0]?.title).toBe('Red-black trees: the basics');
    });

    it('counts an interruption from the checkpoint it produced', () => {
      const { session } = ctx.engine.startSession(DEMO_COURSE_ID);
      ctx.engine.dispatch({
        sessionId: session.id,
        type: 'TASK_STARTED',
        source: 'user',
        payload: { taskId: 'rbt-t1' },
      });
      ctx.engine.dispatch({
        sessionId: session.id,
        type: 'TASK_COMPLETED',
        source: 'user',
        payload: { taskId: 'rbt-t1' },
      });
      ctx.engine.simulate({ command: 'distraction', sessionId: session.id });
      ctx.clock.advance(30_000);
      ctx.engine.simulate({ command: 'return', sessionId: session.id });

      const summary = ctx.engine.getInsights('session');
      expect(summary.interruptions).toBe(1);
      expect(summary.daily.find((day) => day.interruptions > 0)?.interruptions).toBe(1);
    });

    it('defaults to the week window', () => {
      expect(ctx.engine.getInsights().range).toBe('week');
    });
  });

  describe('catalogue', () => {
    it('seeds the built-in demo course exactly once', () => {
      ctx.engine.seedBuiltInCourses();
      expect(ctx.engine.listCourses()).toHaveLength(1);
      expect(ctx.engine.getCourse(DEMO_COURSE_ID)?.microTasks).toHaveLength(5);
    });

    it('exposes the demo course shape required by the golden path', () => {
      const course = ctx.engine.getCourse(DEMO_COURSE_ID);
      expect(course?.concepts.length).toBeGreaterThanOrEqual(3);
      expect(course?.microTasks.length).toBeGreaterThanOrEqual(5);
      expect(course?.quizzes.length).toBeGreaterThanOrEqual(2);
    });

    it('returns null for an unknown course', () => {
      expect(ctx.engine.getCourse('nope')).toBeNull();
    });
  });

  describe('material import', () => {
    it('imports a markdown file into a course with tasks', () => {
      const result = ctx.engine.importMaterial(
        'notes.md',
        '# Sorting\n\n' + 'a'.repeat(200) + '\n\n## Merge sort\n\n' + 'b'.repeat(200),
      );
      expect(result.title).toBe('Sorting');
      expect(result.conceptsCreated).toBeGreaterThan(0);
      expect(result.microTasksCreated).toBeGreaterThan(0);
    });

    it('does not duplicate a course when the same material is imported twice', () => {
      const content = '# Same\n\n' + 'x'.repeat(200);
      const first = ctx.engine.importMaterial('same.md', content);
      const second = ctx.engine.importMaterial('same.md', content);
      expect(second.materialId).toBe(first.materialId);
      expect(second.conceptsCreated).toBe(0);
      expect(ctx.engine.listCourses()).toHaveLength(2); // demo + imported
    });

    it('propagates parser warnings', () => {
      const result = ctx.engine.importMaterial('empty.txt', '   ');
      expect(result.warnings.length).toBeGreaterThan(0);
    });
  });

  describe('session lifecycle', () => {
    it('refuses to start a session for an unknown course', () => {
      expect(() => ctx.engine.startSession('missing')).toThrow(EngineError);
    });

    it('starts a session in READY with no progress', () => {
      const { session } = ctx.engine.startSession(DEMO_COURSE_ID);
      expect(session.state).toBe('READY');
      expect(session.completedTaskIds).toEqual([]);
      expect(ctx.engine.getSessionProgress(session.id)).toMatchObject({
        completedTasks: 0,
        totalTasks: 5,
      });
    });

    it('records SESSION_STARTED as the first persisted event', () => {
      const { session } = ctx.engine.startSession(DEMO_COURSE_ID);
      const events = ctx.engine.listEvents(session.id);
      expect(events[0]?.type).toBe('SESSION_STARTED');
    });

    it('ends a session and freezes its duration', () => {
      const { session } = ctx.engine.startSession(DEMO_COURSE_ID);
      ctx.clock.advance(60_000);
      const ended = ctx.engine.endSession({ sessionId: session.id, reason: 'user' });
      expect(ended.endedAt).toBeDefined();
      expect(ended.state).toBe('READY');
      const dashboard = ctx.engine.getDashboard();
      expect(dashboard.sessionDurationMs).toBe(60_000);
    });

    it('reports the current session', () => {
      const { session } = ctx.engine.startSession(DEMO_COURSE_ID);
      expect(ctx.engine.getCurrentSession()?.session.id).toBe(session.id);
    });

    it('stops reporting a session once it has ended', () => {
      const { session } = ctx.engine.startSession(DEMO_COURSE_ID);
      ctx.engine.endSession({ sessionId: session.id, reason: 'user' });
      // "Current" means running. Falling back to the most recent session made a finished
      // session look live, which is what put a stale resume card back on screen.
      expect(ctx.engine.getCurrentSession()).toBeNull();
    });

    it('ends the running session before starting another', () => {
      const first = ctx.engine.startSession(DEMO_COURSE_ID);
      const second = ctx.engine.startSession(DEMO_COURSE_ID);

      expect(second.session.id).not.toBe(first.session.id);
      expect(ctx.engine.getCurrentSession()?.session.id).toBe(second.session.id);

      /*
       * The observable form of "at most one session is active": ending the running one
       * leaves nothing current. Before this, the first session was still active
       * underneath, so ending the newest silently handed the app back to the one the
       * learner had already left.
       */
      ctx.engine.endSession({ sessionId: second.session.id, reason: 'user' });
      expect(ctx.engine.getCurrentSession()).toBeNull();
    });

    it('does not end the running session when the course is unknown', () => {
      const { session } = ctx.engine.startSession(DEMO_COURSE_ID);
      // A bad request must not cost the learner the session they are in.
      expect(() => ctx.engine.startSession('no-such-course')).toThrow();
      expect(ctx.engine.getCurrentSession()?.session.id).toBe(session.id);
    });

    it('returns null for the current session before anything starts', () => {
      expect(ctx.engine.getCurrentSession()).toBeNull();
    });
  });

  describe('event dispatch', () => {
    it('moves to FOCUSED when a task starts', () => {
      const { session } = ctx.engine.startSession(DEMO_COURSE_ID);
      const response = ctx.engine.dispatch({
        sessionId: session.id,
        type: 'TASK_STARTED',
        source: 'user',
        payload: { taskId: 'rbt-t1' },
      });
      expect(response.state).toBe('FOCUSED');
    });

    it('rejects an unknown session', () => {
      expect(() =>
        ctx.engine.dispatch({
          sessionId: 'missing',
          type: 'TASK_STARTED',
          source: 'user',
          payload: { taskId: 't' },
        }),
      ).toThrow(EngineError);
    });

    it('ignores a replayed event id (extension reconnect protection)', () => {
      const { session } = ctx.engine.startSession(DEMO_COURSE_ID);
      const request = {
        sessionId: session.id,
        type: 'TAB_LEFT' as const,
        source: 'extension' as const,
        payload: {},
        eventId: 'ext-event-1',
      };
      const first = ctx.engine.dispatch(request);
      ctx.clock.advance(60_000);
      const second = ctx.engine.dispatch(request);
      expect(first.state).toBe('DISTRACTED');
      expect(second.state).toBe('DISTRACTED');
      expect(second.decision).toBeNull();
      expect(ctx.engine.listEvents(session.id).filter((e) => e.type === 'TAB_LEFT')).toHaveLength(
        1,
      );
    });

    it('advances progress when tasks complete', () => {
      const { session } = ctx.engine.startSession(DEMO_COURSE_ID);
      for (const taskId of ['rbt-t1', 'rbt-t2']) {
        ctx.engine.dispatch({
          sessionId: session.id,
          type: 'TASK_STARTED',
          source: 'user',
          payload: { taskId },
        });
        ctx.engine.dispatch({
          sessionId: session.id,
          type: 'TASK_COMPLETED',
          source: 'user',
          payload: { taskId },
        });
      }
      expect(ctx.engine.getSessionProgress(session.id)).toMatchObject({
        completedTasks: 2,
        totalTasks: 5,
      });
    });
  });

  describe('interruption and resume', () => {
    it('creates a checkpoint and a resume card when the learner returns late', () => {
      const { session } = ctx.engine.startSession(DEMO_COURSE_ID);
      ctx.engine.dispatch({
        sessionId: session.id,
        type: 'TASK_STARTED',
        source: 'user',
        payload: { taskId: 'rbt-t1' },
      });
      ctx.engine.dispatch({
        sessionId: session.id,
        type: 'TASK_COMPLETED',
        source: 'user',
        payload: { taskId: 'rbt-t1' },
      });

      ctx.engine.simulate({ command: 'distraction', sessionId: session.id });
      ctx.clock.advance(30_000);
      const response = ctx.engine.simulate({ command: 'return', sessionId: session.id });

      expect(response.state).toBe('INTERRUPTED');
      expect(response.checkpoint).not.toBeNull();
      expect(response.resumeCard?.card.title.key).toBe('resume.title.task');
      expect(response.resumeCard?.card.completed).toEqual(['Recall the ordering invariant']);
    });

    it('marks the interruption on a time tick without any event', () => {
      const { session } = ctx.engine.startSession(DEMO_COURSE_ID);
      ctx.engine.dispatch({
        sessionId: session.id,
        type: 'TAB_LEFT',
        source: 'extension',
        payload: {},
      });
      ctx.clock.advance(25_000);
      const tick = ctx.engine.tick();
      expect(tick?.state).toBe('INTERRUPTED');
      expect(tick?.resumeCard).not.toBeNull();
    });

    it('does not tick when nothing changed', () => {
      const { session } = ctx.engine.startSession(DEMO_COURSE_ID);
      ctx.engine.dispatch({
        sessionId: session.id,
        type: 'TASK_STARTED',
        source: 'user',
        payload: { taskId: 'rbt-t1' },
      });
      expect(ctx.engine.tick()).toBeNull();
    });

    it('is idempotent: one checkpoint per interruption', () => {
      const { session } = ctx.engine.startSession(DEMO_COURSE_ID);
      ctx.engine.simulate({ command: 'distraction', sessionId: session.id });
      ctx.clock.advance(30_000);
      const first = ctx.engine.simulate({ command: 'return', sessionId: session.id });
      const second = ctx.engine.simulate({ command: 'return', sessionId: session.id });
      expect(second.checkpoint?.id).toBe(first.checkpoint?.id);
      expect(ctx.store.listCheckpoints(session.id)).toHaveLength(1);
    });

    it('records resume latency when the learner continues', () => {
      const { session } = ctx.engine.startSession(DEMO_COURSE_ID);
      ctx.engine.simulate({ command: 'distraction', sessionId: session.id });
      ctx.clock.advance(30_000);
      const response = ctx.engine.simulate({ command: 'return', sessionId: session.id });
      const checkpointId = response.checkpoint!.id;

      expect(ctx.engine.getResumeCard(session.id)).not.toBeNull();
      ctx.clock.advance(2_500);
      const decision = ctx.engine.acceptResume(checkpointId);

      expect(decision.state).toBe('RESUMING');
      expect(decision.timing.resumeLatencyMs).toBe(2_500);
      expect(decision.outcome).toMatchObject({
        action: 'RESUME',
        accepted: true,
        resumeLatencyMs: 2_500,
      });
    });

    it('clears the pending card after a decision', () => {
      const { session } = ctx.engine.startSession(DEMO_COURSE_ID);
      ctx.engine.simulate({ command: 'distraction', sessionId: session.id });
      ctx.clock.advance(30_000);
      const response = ctx.engine.simulate({ command: 'return', sessionId: session.id });
      ctx.engine.dismissResume(response.checkpoint!.id);
      expect(ctx.engine.getResumeCard(session.id)).toBeNull();
    });

    it('records a dismissed outcome without latency', () => {
      const { session } = ctx.engine.startSession(DEMO_COURSE_ID);
      ctx.engine.simulate({ command: 'distraction', sessionId: session.id });
      ctx.clock.advance(30_000);
      const response = ctx.engine.simulate({ command: 'return', sessionId: session.id });
      const decision = ctx.engine.dismissResume(response.checkpoint!.id);
      expect(decision.outcome).toMatchObject({
        accepted: false,
        dismissed: true,
        resumeLatencyMs: null,
      });
    });

    it('throws for an unknown checkpoint', () => {
      expect(() => ctx.engine.acceptResume('nope')).toThrow(EngineError);
    });

    it('creates a checkpoint on demand', () => {
      const { session } = ctx.engine.startSession(DEMO_COURSE_ID);
      const checkpoint = ctx.engine.createCheckpoint(session.id);
      expect(checkpoint.sessionId).toBe(session.id);
      expect(ctx.engine.getLatestCheckpoint(session.id)?.id).toBe(checkpoint.id);
    });
  });

  describe('intervention policy integration', () => {
    it('escalates to an example after two wrong answers', () => {
      const { session } = ctx.engine.startSession(DEMO_COURSE_ID);
      const response = ctx.engine.simulate({ command: 'confusion', sessionId: session.id });
      expect(response.state).toBe('CONFUSED');
      expect(response.decision?.action).toBe('EXAMPLE');
      expect(response.interventionId).toBeTruthy();
    });

    it('offers a break when the learner keeps asking for help', () => {
      const { session } = ctx.engine.startSession(DEMO_COURSE_ID);
      const response = ctx.engine.simulate({ command: 'overload', sessionId: session.id });
      expect(response.state).toBe('OVERLOADED');
      expect(response.decision?.action).toBe('BREAK');
    });

    it('stays silent while the learner is making progress', () => {
      const { session } = ctx.engine.startSession(DEMO_COURSE_ID);
      const response = ctx.engine.dispatch({
        sessionId: session.id,
        type: 'TASK_STARTED',
        source: 'user',
        payload: { taskId: 'rbt-t1' },
      });
      expect(response.decision?.action).toBe('NO_ACTION');
      expect(response.interventionId).toBeNull();
    });

    it('persists outcomes the app resolves', () => {
      const { session } = ctx.engine.startSession(DEMO_COURSE_ID);
      const response = ctx.engine.simulate({ command: 'overload', sessionId: session.id });
      const outcome = ctx.engine.resolveIntervention({
        interventionId: response.interventionId!,
        accepted: true,
        dismissed: false,
        taskCompleted: false,
      });
      expect(outcome?.action).toBe('BREAK');
      expect(ctx.engine.listOutcomes(session.id)).toHaveLength(1);
    });

    it('returns null when resolving an unknown intervention', () => {
      expect(
        ctx.engine.resolveIntervention({
          interventionId: 'nope',
          accepted: true,
          dismissed: false,
          taskCompleted: false,
        }),
      ).toBeNull();
    });
  });

  describe('dashboard', () => {
    it('is empty before the first session', () => {
      const summary = ctx.engine.getDashboard();
      expect(summary).toMatchObject({ sessionId: null, tasksCompleted: 0, interruptCount: 0 });
    });

    it('aggregates duration, tasks, interruptions and outcomes', () => {
      const { session } = ctx.engine.startSession(DEMO_COURSE_ID);
      ctx.engine.dispatch({
        sessionId: session.id,
        type: 'TASK_STARTED',
        source: 'user',
        payload: { taskId: 'rbt-t1' },
      });
      ctx.engine.dispatch({
        sessionId: session.id,
        type: 'TASK_COMPLETED',
        source: 'user',
        payload: { taskId: 'rbt-t1' },
      });

      ctx.engine.simulate({ command: 'distraction', sessionId: session.id });
      ctx.clock.advance(30_000);
      const response = ctx.engine.simulate({ command: 'return', sessionId: session.id });
      ctx.clock.advance(2_000);
      ctx.engine.acceptResume(response.checkpoint!.id);
      ctx.clock.advance(10_000);

      const summary = ctx.engine.getDashboard();
      expect(summary).toMatchObject({
        courseTitle: 'Red-black trees: the basics',
        tasksCompleted: 1,
        tasksTotal: 5,
        interruptCount: 1,
        averageResumeLatencyMs: 2_000,
      });
      const resumeRow = summary.interventionOutcomes.find((row) => row.action === 'RESUME');
      expect(resumeRow).toMatchObject({ total: 1, accepted: 1 });
    });
  });

  describe('simulator', () => {
    it('is available by default', () => {
      expect(ctx.engine.getSimulatorAvailability().enabled).toBe(true);
    });

    it('can be disabled for production builds', () => {
      const other = createTestEngine({ simulatorEnabled: false });
      try {
        expect(other.engine.getSimulatorAvailability().enabled).toBe(false);
        const { session } = other.engine.startSession(DEMO_COURSE_ID);
        expect(() =>
          other.engine.simulate({ command: 'distraction', sessionId: session.id }),
        ).toThrow(EngineError);
      } finally {
        other.close();
      }
    });

    it('records successes', () => {
      const { session } = ctx.engine.startSession(DEMO_COURSE_ID);
      const response = ctx.engine.simulate({ command: 'success', sessionId: session.id });
      expect(response.event.type).toBe('QUIZ_CORRECT');
    });
  });

  describe('degraded mode (no network, no key)', () => {
    it('works end to end with the mock provider', async () => {
      const result = await ctx.engine.enrich('Explain rotations briefly.');
      expect(result.degraded).toBe(false);
      expect(result.providerId).toBe('mock');
      expect(result.text.length).toBeGreaterThan(0);
    });

    it('degrades gracefully when the real provider fails', async () => {
      const failing = createTestEngine({
        providers: { primary: failingProvider(), fallback: ctx.providers.fallback },
      });
      try {
        const result = await failing.engine.enrich('Explain rotations briefly.');
        expect(result.degraded).toBe(true);
        expect(result.failure?.reason).toBe('offline');
        expect(result.text.length).toBeGreaterThan(0);
      } finally {
        failing.close();
      }
    });

    it('keeps the golden path running when the provider is unreachable', async () => {
      const failing = createTestEngine({
        providers: { primary: failingProvider(), fallback: ctx.providers.fallback },
      });
      try {
        const { session } = failing.engine.startSession(DEMO_COURSE_ID);
        await failing.engine.enrich('anything');
        failing.engine.simulate({ command: 'distraction', sessionId: session.id });
        failing.clock.advance(30_000);
        const response = failing.engine.simulate({ command: 'return', sessionId: session.id });
        expect(response.state).toBe('INTERRUPTED');
        expect(response.resumeCard).not.toBeNull();
      } finally {
        failing.close();
      }
    });

    it('reports provider metadata', () => {
      expect(ctx.engine.providerInfo()).toMatchObject({ id: 'mock', offline: true });
    });
  });

  describe('configuration', () => {
    it('exposes the resolved thresholds', () => {
      const snapshot = ctx.engine.configSnapshot();
      expect(snapshot.state.tabLeftThresholdMs).toBeGreaterThan(0);
      expect(snapshot.policy.cooldownMs).toBeGreaterThan(0);
    });

    it('applies custom thresholds', () => {
      const custom = createTestEngine({ stateConfig: { tabLeftThresholdMs: 1_000 } });
      try {
        const { session } = custom.engine.startSession(DEMO_COURSE_ID);
        custom.engine.dispatch({
          sessionId: session.id,
          type: 'TAB_LEFT',
          source: 'extension',
          payload: {},
        });
        custom.clock.advance(1_500);
        expect(custom.engine.tick()?.state).toBe('INTERRUPTED');
      } finally {
        custom.close();
      }
    });
  });
});
