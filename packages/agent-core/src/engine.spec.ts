import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ProviderError, createProviderSelection } from '@focusloop/llm-provider';
import { TUTOR_LIMITS, type AIProvider, type CompletionRequest } from '@focusloop/shared-types';
import { EngineError } from './engine';
import { DEMO_COURSE_ID } from './demo-course';
import { createTestEngine, type TestEngine } from './test-helpers';

function failingProvider(): AIProvider & { readonly requests: CompletionRequest[] } {
  const requests: CompletionRequest[] = [];
  return Object.assign(
    {
      id: 'deepseek',
      model: 'deepseek-chat',
      offline: false,
      complete: async (request: CompletionRequest) => {
        requests.push(request);
        throw new ProviderError('offline', 'deepseek', 'no network in this test');
      },
    } satisfies AIProvider,
    { requests },
  );
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
    it('defaults to English, the system theme, and the material text shown', () => {
      expect(ctx.engine.getSettings()).toEqual({
        locale: 'en',
        theme: 'system',
        showMaterialText: true,
      });
    });

    it('remembers the chosen language', () => {
      expect(ctx.engine.setLocale('zh')).toEqual({
        locale: 'zh',
        theme: 'system',
        showMaterialText: true,
      });
      expect(ctx.engine.getSettings().locale).toBe('zh');
    });

    it('remembers the chosen theme without disturbing the language', () => {
      ctx.engine.setLocale('zh');
      expect(ctx.engine.setTheme('light')).toEqual({
        locale: 'zh',
        theme: 'light',
        showMaterialText: true,
      });
      expect(ctx.engine.getSettings()).toEqual({
        locale: 'zh',
        theme: 'light',
        showMaterialText: true,
      });
    });

    it('remembers whether the imported text is shown, through a store that holds strings', () => {
      expect(ctx.engine.setShowMaterialText(false)).toEqual({
        locale: 'en',
        theme: 'system',
        showMaterialText: false,
      });
      // `app_meta` stores strings, so the value comes back as the word rather than the primitive.
      // A guard that only accepted a real boolean would silently fall back to the default, and the
      // preference would look like it saved while never taking effect.
      expect(ctx.engine.getSettings().showMaterialText).toBe(false);
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

  describe('agent context', () => {
    /*
     * `buildAgentContext` is covered directly in its own spec. These cover `getAgentContext`, which had
     * no test at all — and which is the only place the material lookup, the event log and the
     * checkpoint are joined up. A regression in that wiring would have been invisible.
     */
    it('has nothing to be about before a session starts', () => {
      const report = ctx.engine.getAgentContext();

      expect(report.context).toBeNull();
      expect(report.omissions[0]?.field).toBe('session');
    });

    it('gathers the course, the material and the log for the running session', () => {
      ctx.engine.importMaterial(
        'notes.md',
        '# Sorting\n\n' + 'a'.repeat(200) + '\n\n## Merge sort\n\n' + 'b'.repeat(200),
      );
      const imported = ctx.engine.listCourses().find((course) => course.id !== DEMO_COURSE_ID);
      const { session } = ctx.engine.startSession(imported!.id);

      /*
       * A task has to be under way before there is a concept, and therefore before there is a section
       * to excerpt. That is the design, not an accident: before the learner has started anything, the
       * agent is told nothing about the material rather than being handed the first section of it.
       */
      const firstTask = imported!.microTasks[0]!;
      ctx.engine.dispatch({
        sessionId: session.id,
        type: 'TASK_STARTED',
        source: 'user',
        payload: { taskId: firstTask.id },
      });
      const checkpoint = ctx.engine.createCheckpoint(session.id);

      const report = ctx.engine.getAgentContext();

      expect(report.context?.session.sessionId).toBe(session.id);
      expect(report.context?.task.taskId).toBe(firstTask.id);
      /*
       * Asserted against a real checkpoint. The commit that added these tests claimed they covered
       * "the only place the material lookup, the event log and the checkpoint are joined up" while no
       * assertion read the checkpoint at all — a regression passing `null` through would have left
       * every other line here green, and the resume capability would lose its input silently.
       *
       * The report carries the bounded projection, not the persistence record: same facts the agent
       * needs, none of the ids that would widen the boundary.
       */
      expect(report.context?.checkpoint).toMatchObject({
        currentTaskTitle: checkpoint.currentTaskTitle,
        currentStep: checkpoint.currentStep,
        frictionState: checkpoint.frictionState,
      });
      expect(report.context?.checkpoint).not.toHaveProperty('id');
      expect(report.context?.checkpoint).not.toHaveProperty('sessionId');
      // The point of the wiring test: a real document is found, and its text reaches the agent.
      expect(report.context?.material.materialId).not.toBeNull();
      expect(report.context?.material.text.length).toBeGreaterThan(0);
      expect(report.context?.recentEvents.length).toBeGreaterThan(0);
      expect(
        report.context?.recentEvents.every((event) => !('sessionId' in event) && !('id' in event)),
      ).toBe(true);
      expect(report.context?.task.totalSteps).toBeGreaterThan(0);
    });

    it('projects hostile stored event payloads before returning the shared context report', () => {
      const { session } = ctx.engine.startSession(DEMO_COURSE_ID);
      ctx.engine.dispatch({
        sessionId: session.id,
        type: 'TAB_LEFT',
        source: 'extension',
        payload: {
          origin: 'https://private.example',
          url: 'https://private.example/private?token=secret',
          formValue: 'FORM_SECRET',
        },
      });

      const report = ctx.engine.getAgentContext();
      const serialized = JSON.stringify(report);

      expect(report.context?.recentEvents.length).toBeGreaterThan(0);
      expect(report.context?.recentEvents.at(-1)).toMatchObject({ type: 'TAB_LEFT' });
      expect(report.context?.recentEvents.at(-1)?.payload).toEqual({});
      expect(serialized).not.toContain('FORM_SECRET');
      expect(serialized).not.toContain('token=secret');
    });

    it('assembles context only from the active course when other courses contain private text', () => {
      ctx.engine.importMaterial(
        'other.md',
        '# Other course\n\n## Private section\n\nOTHER_COURSE_SECRET '.repeat(12),
      );
      ctx.engine.importMaterial(
        'current.md',
        '# Current course\n\n## Current section\n\nCURRENT_COURSE_TEXT '.repeat(12),
      );
      const current = ctx.engine.listCourses().find((course) => course.title === 'Current course');
      expect(current).toBeDefined();

      const { session } = ctx.engine.startSession(current!.id);
      const task = current!.microTasks[0]!;
      ctx.engine.dispatch({
        sessionId: session.id,
        type: 'TASK_STARTED',
        source: 'user',
        payload: { taskId: task.id },
      });

      const report = ctx.engine.getAgentContext();
      const serialized = JSON.stringify(report);

      expect(serialized).toContain('CURRENT_COURSE_TEXT');
      expect(serialized).not.toContain('OTHER_COURSE_SECRET');
      expect(report.omissions.some((item) => item.field === 'courses')).toBe(true);
    });

    it('has no section to give before a task is under way, and says so', () => {
      ctx.engine.importMaterial('notes.md', '# Sorting\n\n' + 'a'.repeat(200));
      const imported = ctx.engine.listCourses().find((course) => course.id !== DEMO_COURSE_ID);
      const { session } = ctx.engine.startSession(imported!.id);

      const report = ctx.engine.getAgentContext();

      // The document is found, so the wiring ran; there is simply nothing to excerpt yet.
      expect(report.context?.session.sessionId).toBe(session.id);
      expect(report.context?.material.materialId).not.toBeNull();
      expect(report.context?.material.text).toBe('');
      expect(report.omissions).toContainEqual({
        field: 'material',
        detail: 'no concept is current, so no section was chosen',
      });
    });
  });

  describe('stuck reasons (AG2)', () => {
    it('does not create a rescue card when the learner does not provide a reason', () => {
      const { session } = ctx.engine.startSession(DEMO_COURSE_ID);
      const response = ctx.engine.dispatch({
        sessionId: session.id,
        type: 'HELP_REQUESTED',
        source: 'user',
        payload: {},
      });
      expect(response.rescue).toBeNull();
      expect(ctx.engine.getPendingRescue(session.id)).toBeNull();
    });

    it('ignores an unknown rescue resolution and does not treat Continue as acceptance', () => {
      const { session } = ctx.engine.startSession(DEMO_COURSE_ID);
      const asked = ctx.engine.dispatch({
        sessionId: session.id,
        type: 'HELP_REQUESTED',
        source: 'user',
        payload: { reason: 'went-wrong' },
      });
      expect(asked.rescue?.phase).toBe('offered');
      expect(
        ctx.engine.resolveRescue({
          sessionId: session.id,
          interventionId: 'missing-intervention',
          resolution: 'accept',
        }),
      ).toMatchObject({ outcome: null });
      expect(
        ctx.engine.resolveRescue({
          sessionId: session.id,
          interventionId: asked.interventionId!,
          resolution: 'continue',
        }),
      ).toMatchObject({ outcome: null, rescue: { phase: 'offered' } });
      expect(ctx.engine.listOutcomes(session.id)).toHaveLength(0);
    });

    it('dismisses an offered rescue once and keeps the saved outcome on replay', () => {
      const { session } = ctx.engine.startSession(DEMO_COURSE_ID);
      const asked = ctx.engine.dispatch({
        sessionId: session.id,
        type: 'HELP_REQUESTED',
        source: 'user',
        payload: { reason: 'went-wrong' },
      });
      const request = {
        sessionId: session.id,
        interventionId: asked.interventionId!,
        resolution: 'dismiss' as const,
      };
      const dismissed = ctx.engine.resolveRescue(request);
      expect(dismissed.outcome?.dismissed).toBe(true);
      expect(dismissed.rescue).toBeNull();
      expect(ctx.engine.resolveRescue(request).outcome).toEqual(dismissed.outcome);
      expect(ctx.engine.listOutcomes(session.id)).toHaveLength(1);
    });

    it('answers a reasoned help request through the engine, not only in the policy package', () => {
      /*
       * `docs/testing.md` asks agent-core to prove every policy rule *through the engine*, and the
       * reason is that the policy's inputs are assembled here — `recentEvents` and `shownInterventions`
       * come from this layer. A rule can therefore be correct in the policy package and never fire in a
       * real session, which is exactly what a unit test of the policy cannot notice.
       */
      const { session } = ctx.engine.startSession(DEMO_COURSE_ID);
      const response = ctx.engine.dispatch({
        sessionId: session.id,
        type: 'HELP_REQUESTED',
        source: 'user',
        payload: { reason: 'tired' },
      });

      expect(response.decision?.action).toBe('BREAK');
      expect(response.rescue?.phase).toBe('offered');
      expect(response.rescue?.plan).toBeNull();
    });

    it('persists accept and Continue times and restores the accepted rescue', () => {
      const { session } = ctx.engine.startSession(DEMO_COURSE_ID);
      ctx.engine.dispatch({
        sessionId: session.id,
        type: 'TASK_STARTED',
        source: 'user',
        payload: { taskId: 'rbt-t1' },
      });
      const response = ctx.engine.dispatch({
        sessionId: session.id,
        type: 'HELP_REQUESTED',
        source: 'user',
        payload: { reason: 'went-wrong', taskId: 'rbt-t1' },
      });
      expect(response.rescue?.decision.action).toBe('HINT');
      const accepted = ctx.engine.resolveRescue({
        sessionId: session.id,
        interventionId: response.interventionId!,
        resolution: 'accept',
      });
      expect(accepted.rescue?.phase).toBe('active');
      expect(accepted.rescue?.plan?.steps).toHaveLength(2);
      expect(ctx.engine.getPendingRescue(session.id)?.phase).toBe('active');
      ctx.clock.advance(60_000);
      const continued = ctx.engine.resolveRescue({
        sessionId: session.id,
        interventionId: response.interventionId!,
        resolution: 'continue',
      });
      expect(continued.rescue).toBeNull();
      expect(continued.outcome?.acceptedAt).toBe(ctx.clock.now().replace('00:01:00', '00:00:00'));
      expect(continued.outcome?.continuedAt).toBe(ctx.clock.now());
      const replay = ctx.engine.resolveRescue({
        sessionId: session.id,
        interventionId: response.interventionId!,
        resolution: 'continue',
      });
      expect(replay.outcome).toEqual(continued.outcome);
      expect(ctx.engine.listOutcomes(session.id)).toHaveLength(1);
    });

    it('does not restore or accept a rescue after the task has changed', () => {
      const { session } = ctx.engine.startSession(DEMO_COURSE_ID);
      ctx.engine.dispatch({
        sessionId: session.id,
        type: 'TASK_STARTED',
        source: 'user',
        payload: { taskId: 'rbt-t1' },
      });
      const asked = ctx.engine.dispatch({
        sessionId: session.id,
        type: 'HELP_REQUESTED',
        source: 'user',
        payload: { taskId: 'rbt-t1', reason: 'went-wrong' },
      });
      ctx.engine.dispatch({
        sessionId: session.id,
        type: 'TASK_STARTED',
        source: 'user',
        payload: { taskId: 'rbt-t2' },
      });
      expect(ctx.engine.getPendingRescue(session.id)).toBeNull();
      const stale = ctx.engine.resolveRescue({
        sessionId: session.id,
        interventionId: asked.interventionId!,
        resolution: 'accept',
      });
      expect(stale).toMatchObject({ outcome: null, rescue: null });
      expect(ctx.engine.listOutcomes(session.id)).toHaveLength(0);
    });

    it('rejects an accept replay after its session has ended', () => {
      const firstSession = ctx.engine.startSession(DEMO_COURSE_ID).session;
      ctx.engine.dispatch({
        sessionId: firstSession.id,
        type: 'TASK_STARTED',
        source: 'user',
        payload: { taskId: 'rbt-t1' },
      });
      const asked = ctx.engine.dispatch({
        sessionId: firstSession.id,
        type: 'HELP_REQUESTED',
        source: 'user',
        payload: { taskId: 'rbt-t1', reason: 'went-wrong' },
      });
      ctx.engine.startSession(DEMO_COURSE_ID);
      const stale = ctx.engine.resolveRescue({
        sessionId: firstSession.id,
        interventionId: asked.interventionId!,
        resolution: 'accept',
      });
      expect(stale).toMatchObject({ outcome: null, rescue: null });
      expect(ctx.engine.listOutcomes(firstSession.id)).toHaveLength(0);
    });

    it('does not answer a second reasoned request that this session has already had an answer to', () => {
      // The request stays the most recent event after it is answered, so without the "already answered"
      // test the same request would be answered on every subsequent dispatch.
      const { session } = ctx.engine.startSession(DEMO_COURSE_ID);
      const first = ctx.engine.dispatch({
        sessionId: session.id,
        type: 'HELP_REQUESTED',
        source: 'user',
        payload: { reason: 'too-big' },
      });
      const second = ctx.engine.dispatch({
        sessionId: session.id,
        type: 'TASK_STARTED',
        source: 'user',
        payload: { taskId: 'missing-task' },
      });

      expect(first.decision?.action).toBe('SIMPLIFY');
      expect(second.decision?.action).not.toBe('SIMPLIFY');
    });

    it('records which request the answer answered', () => {
      /*
       * The link between the answer and the request, as the store actually keeps it. The policy's own
       * test asserts the decision carries the id; this asserts the round trip — decision → saved
       * intervention → read back — because that is the part a wrong column name would break, and it is
       * the only thing standing between the learner and the same request being answered for ever.
       */
      const { session } = ctx.engine.startSession(DEMO_COURSE_ID);
      const response = ctx.engine.dispatch({
        sessionId: session.id,
        type: 'HELP_REQUESTED',
        source: 'user',
        payload: { reason: 'tired' },
      });

      const request = ctx.engine.listEvents(session.id).at(-1);
      expect(request?.type).toBe('HELP_REQUESTED');

      const shown = ctx.engine
        .listInterventions(session.id)
        .filter((item) => item.action !== 'RESUME');
      expect(shown).toHaveLength(1);
      expect(shown[0]?.answersRequestId).toBe(request?.id);
      expect(shown[0]?.id).toBe(response.interventionId);
    });

    it('records the answer even when something else is shown in the same millisecond', () => {
      /*
       * The collision that made the fix in the previous test incomplete.
       *
       * `saveIntervention` inserts and ignores a duplicate id, so two interventions sharing a session,
       * a millisecond and an action are one row. A state rule that shows a break and a `tired` request
       * that asks for one are both `BREAK`, and the clock is frozen in these tests, so they are the
       * same millisecond by construction rather than by contrivance. Whichever row loses, the request
       * is never recorded as answered — and then the answer is emitted on every later dispatch for
       * ever, which the session budget cannot stop because no new row is ever stored. The request id is
       * part of the intervention id so that the two rows cannot be the same row.
       */
      const { session } = ctx.engine.startSession(DEMO_COURSE_ID);
      const overload = ctx.engine.simulate({ command: 'overload', sessionId: session.id });
      expect(overload.decision?.action).toBe('BREAK');

      const asked = ctx.engine.dispatch({
        sessionId: session.id,
        type: 'HELP_REQUESTED',
        source: 'user',
        payload: { reason: 'tired' },
      });
      expect(asked.decision?.action).toBe('BREAK');

      const request = ctx.engine
        .listEvents(session.id)
        .filter((event) => event.type === 'HELP_REQUESTED')
        .at(-1);
      const answer = ctx.engine
        .listInterventions(session.id)
        .find((item) => item.id === asked.interventionId);

      // The row survived, and it names the request. Dropped, it would be `undefined` here.
      expect(answer).toBeDefined();
      expect(answer?.answersRequestId).toBe(request?.id);
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

  describe('the tutor', () => {
    /**
     * A provider that answers from a script, and remembers what it was asked.
     *
     * `prompts` is the point of it: the transcript is invisible from outside the engine by design, so
     * the only way to assert that the last exchange was carried into the next prompt is to look at what
     * the second call actually received.
     */
    function scriptedProvider(
      replies: readonly string[],
      options: { offline?: boolean } = {},
    ): AIProvider & { readonly prompts: string[] } {
      const prompts: string[] = [];
      let index = 0;
      return {
        id: 'scripted',
        model: 'scripted-1',
        offline: options.offline ?? false,
        prompts,
        complete: async (request) => {
          prompts.push(request.prompt);
          const text = replies[Math.min(index, replies.length - 1)] ?? '';
          index += 1;
          return { text, providerId: 'scripted', model: 'scripted-1', latencyMs: 1 };
        },
      };
    }

    /** The engine with a scripted provider, and the session to ask about. */
    function withProvider(replies: readonly string[], offline = false) {
      const provider = scriptedProvider(replies, { offline });
      const scripted = createTestEngine({ providers: createProviderSelection(provider) });
      const { session } = scripted.engine.startSession(DEMO_COURSE_ID);
      return { scripted, provider, sessionId: session.id };
    }

    it('does not call an offline provider, and says so rather than paying for two calls with no answer', async () => {
      const { scripted, provider, sessionId } = withProvider(['[hint]\nunused'], true);
      try {
        const answer = await scripted.engine.askTutor({
          sessionId,
          mode: 'HINT',
          question: 'why does the colour change?',
        });

        // The offline mock's output is documented never to parse, so a call here is a rejection and then
        // a retry: two calls, no answer, on every question of the golden path.
        expect(provider.prompts).toEqual([]);
        expect(answer.outcome.status).toBe('unavailable');
        if (answer.outcome.status !== 'unavailable') return;
        expect(answer.outcome.reason).toBe('no-model');
        // The prompt was built and nothing left the process, so the account says nothing was sent while
        // still carrying what the prompt would have left out.
        expect(answer.context.sent).toEqual({
          turns: 0,
          inputCharacters: 0,
          excerptCharacters: 0,
        });
        expect(answer.outcome.fallback.reason).toBe('no-model');
        // The excerpt is the object rather than a nullable source, so "no section" is an empty excerpt
        // with a heading of `null` rather than a second absent value for the screen to branch on.
        expect(answer.outcome.fallback.excerpt).toEqual({
          materialId: null,
          title: null,
          heading: null,
          text: '',
          truncated: false,
        });
      } finally {
        scripted.close();
      }
    });

    it('refuses an empty question as "nothing to ask", without calling the provider', async () => {
      const { scripted, provider, sessionId } = withProvider(['[hint]\nunused']);
      try {
        const answer = await scripted.engine.askTutor({
          sessionId,
          mode: 'HINT',
          question: '   ',
        });

        expect(provider.prompts).toEqual([]);
        expect(answer.outcome.status).toBe('unavailable');
        if (answer.outcome.status !== 'unavailable') return;
        // Not `no-model`: the provider is online and would have answered. A learner whose message was
        // empty is told about their message.
        expect(answer.outcome.reason).toBe('no-question');
        expect(answer.outcome.fallback.reason).toBe('no-question');
      } finally {
        scripted.close();
      }
    });

    it('carries the exchange into the next prompt, which is the whole point of the transcript', async () => {
      const { scripted, provider, sessionId } = withProvider([
        '[hint]\nLook at the parent pointer first.',
        '[hint]\nNow check whether the node is red.',
      ]);
      try {
        const first = await scripted.engine.askTutor({
          sessionId,
          mode: 'HINT',
          question: 'why does the colour change?',
        });
        expect(first.outcome.status).toBe('answered');
        expect(provider.prompts[0]).not.toContain('[hint]');

        const second = await scripted.engine.askTutor({
          sessionId,
          mode: 'HINT',
          question: 'and then?',
        });
        expect(second.outcome.status).toBe('answered');

        const secondPrompt = provider.prompts[1] ?? '';
        expect(secondPrompt).toContain('why does the colour change?');
        expect(secondPrompt).toContain('[hint]');
        expect(secondPrompt).toContain('Look at the parent pointer first.');
        expect(secondPrompt).toContain('and then?');
        expect(second.context.sent.turns).toBe(2);
      } finally {
        scripted.close();
      }
    });

    it('asks once more when the format was wrong, and shows the model the answer it is redoing', async () => {
      const { scripted, provider, sessionId } = withProvider([
        'Sure! The parent pointer is set to the grandparent.',
        '[hint]\nLook at what happens to the node that was moved.',
      ]);
      try {
        const answer = await scripted.engine.askTutor({
          sessionId,
          mode: 'HINT',
          question: 'why is the node red?',
        });

        expect(provider.prompts).toHaveLength(2);
        expect(provider.prompts[1]).toContain('Your answer had no labelled blocks at all.');
        expect(provider.prompts[1]).toContain(
          'Sure! The parent pointer is set to the grandparent.',
        );
        expect(answer.outcome.status).toBe('answered');

        /*
         * Composing a retry from the whole prompt carries the builder's `[question]` block *and* the
         * complaint's, so the question is sent twice — the defect that made the retry unaffordable. Counted
         * on the **question text** rather than on the label, so the assertion measures the duplication itself
         * and not the complaint's format; here it is the only assertion that can see it, because the
         * duplicate fits at this size while the long-question fixture trips the ceiling and stops at one
         * call. Verified by putting the bug back, where this reports 2.
         */
        const asked = 'why is the node red?';
        expect(provider.prompts[1]?.split(asked)).toHaveLength(2);
      } finally {
        scripted.close();
      }
    });

    it('asks exactly once, and stops, when the second answer is wrong too', async () => {
      const { scripted, provider, sessionId } = withProvider([
        'prose one',
        'prose two',
        'prose three',
      ]);
      try {
        const answer = await scripted.engine.askTutor({
          sessionId,
          mode: 'HINT',
          question: 'why?',
        });

        // Two, not three: the retry budget is one, and nothing here counts — `isRetryable` is a
        // predicate, so the second call is the caller's decision and this is where it is made.
        expect(provider.prompts).toHaveLength(2);
        expect(answer.outcome.status).toBe('rejected');
        if (answer.outcome.status !== 'rejected') return;
        expect(answer.outcome.reason).toBe('unparseable');
        expect(answer.outcome.provider).toEqual({
          id: 'scripted',
          model: 'scripted-1',
          degraded: false,
          failure: null,
        });
      } finally {
        scripted.close();
      }
    });

    it('does not ask again about a confirmation that quotes nothing the learner wrote', async () => {
      const { scripted, provider, sessionId } = withProvider([
        '[confirmed]\nYou are right about that.\n\n[question]\nWhat happens next?',
        '[hint]\nabc',
      ]);
      try {
        const answer = await scripted.engine.askTutor({
          sessionId,
          mode: 'CHECK_MY_ANSWER',
          question: 'Is my answer right?',
        });

        // One call. Retrying a grounding failure teaches a model to satisfy the checker, which is the
        // reason `isRetryable` excludes this reason rather than including every rejection.
        expect(provider.prompts).toHaveLength(1);
        expect(answer.outcome.status).toBe('rejected');
        if (answer.outcome.status !== 'rejected') return;
        expect(answer.outcome.reason).toBe('unquoted-confirmation');
        expect(answer.outcome.fallback.reason).toBe('unquoted-confirmation');
      } finally {
        scripted.close();
      }
    });

    it('does not put a refused answer in the transcript', async () => {
      const { scripted, provider, sessionId } = withProvider([
        'prose, which is refused',
        '[hint]\nA real hint.',
      ]);
      try {
        await scripted.engine.askTutor({ sessionId, mode: 'HINT', question: 'first?' });
        await scripted.engine.askTutor({ sessionId, mode: 'HINT', question: 'second?' });

        // The third prompt carries the first question and its answer, and not the prose that was shown
        // to nobody — with a tutor role on it, it would read as the tutor having said it.
        const third = provider.prompts[2] ?? '';
        expect(third).not.toContain('prose, which is refused');
        expect(third).toContain('A real hint.');
      } finally {
        scripted.close();
      }
    });

    it('reports a provider that failed, with degraded set', async () => {
      const provider = failingProvider();
      const failing = createTestEngine({ providers: createProviderSelection(provider) });
      try {
        const { session } = failing.engine.startSession(DEMO_COURSE_ID);
        const answer = await failing.engine.askTutor({
          sessionId: session.id,
          mode: 'HINT',
          question: 'why?',
        });

        expect(answer.outcome.status).toBe('unavailable');
        if (answer.outcome.status !== 'unavailable') return;
        expect(answer.outcome.reason).toBe('provider-failed');
        expect(answer.outcome.provider.degraded).toBe(true);
        expect(answer.outcome.provider.failure?.providerId).toBe('deepseek');
        /*
         * Exactly what was handed over, system prompt included. Not zero: the provider was **called** and
         * failed, and `sent` is what the inspector reads to watch a prompt grow — zeroing it here hides the
         * growth in the one case where the prompt was built, handed over, and answered by nobody. Zero is
         * reserved for the offline gate, which sends nothing at all.
         *
         * Asserted as an equality against the request the provider actually received, because `> 0` accepts
         * the system prompt being left out of the sum, and a sum of the wrong things is the failure this
         * change was made to fix.
         */
        const [call] = provider.requests;
        expect(answer.context.sent.inputCharacters).toBe(
          (call?.system?.length ?? 0) + (call?.prompt.length ?? 0),
        );
      } finally {
        failing.close();
      }
    });

    it('reports both calls when the retry is the one that fails', async () => {
      /*
       * The second call is the one that can fail on a path where the first succeeded, and it is the path
       * the summed `sent` exists for: a prompt was sent, an answer came back, a second prompt was sent, and
       * nobody answered it. Reporting zero there is the lie this test would catch; reporting only the first
       * call is the other one.
       */
      let calls = 0;
      const prompts: string[] = [];
      const systems: string[] = [];
      const provider: AIProvider = {
        id: 'scripted',
        model: 'scripted-1',
        offline: false,
        complete: async (request) => {
          prompts.push(request.prompt);
          systems.push(request.system ?? '');
          calls += 1;
          if (calls === 2) throw new ProviderError('timeout', 'scripted', 'the retry timed out');
          return {
            text: 'prose, which is refused',
            providerId: 'scripted',
            model: 'scripted-1',
            latencyMs: 1,
          };
        },
      };
      const scripted = createTestEngine({ providers: createProviderSelection(provider) });
      try {
        const { session } = scripted.engine.startSession(DEMO_COURSE_ID);
        const answer = await scripted.engine.askTutor({
          sessionId: session.id,
          mode: 'HINT',
          question: 'why?',
        });

        expect(prompts).toHaveLength(2);
        expect(answer.outcome.status).toBe('unavailable');
        if (answer.outcome.status !== 'unavailable') return;
        expect(answer.outcome.reason).toBe('provider-failed');
        // Both calls, each with its own system prompt, as an equality against what the provider received.
        // A zero report and a first-call-only report both fail it.
        expect(answer.context.sent.inputCharacters).toBe(
          (systems[0]?.length ?? 0) +
            (prompts[0]?.length ?? 0) +
            (systems[1]?.length ?? 0) +
            (prompts[1]?.length ?? 0),
        );
      } finally {
        scripted.close();
      }
    });

    it('emits no learning event, so using the tutor cannot trigger the overload rule', async () => {
      const { scripted, sessionId } = withProvider(['[hint]\nTry the parent pointer.']);
      try {
        const before = scripted.engine.listEvents(sessionId).length;
        const stateBefore = scripted.engine.getCurrentSession()?.session.state;
        for (let index = 0; index < 4; index += 1) {
          await scripted.engine.askTutor({ sessionId, mode: 'HINT', question: `q${index}` });
        }
        expect(scripted.engine.listEvents(sessionId)).toHaveLength(before);
        // Four asks in a row leave the state exactly where they found it: four `HELP_REQUESTED` events
        // would have moved it to OVERLOADED and made the feature punish the learner for using it.
        expect(scripted.engine.getCurrentSession()?.session.state).toBe(stateBefore);
      } finally {
        scripted.close();
      }
    });

    it('clips a long part and reports it with the answer, not beside it', async () => {
      const { scripted, sessionId } = withProvider([`[hint]\n${'h'.repeat(700)}`]);
      try {
        const answer = await scripted.engine.askTutor({
          sessionId,
          mode: 'HINT',
          question: 'why?',
        });

        expect(answer.outcome.status).toBe('answered');
        if (answer.outcome.status !== 'answered') return;
        expect(answer.outcome.reply.parts[0]?.text).toHaveLength(TUTOR_LIMITS.partCharacters);
        // In the reply, because that is what the renderer has: a caller given the omissions beside the
        // reply has nowhere to put them that the screen can reach.
        expect(
          answer.outcome.reply.omissions.some((entry) =>
            entry.detail.includes('longer than is shown'),
          ),
        ).toBe(true);
      } finally {
        scripted.close();
      }
    });

    it('asks again after a long question, because the retry does not carry the question twice', async () => {
      /*
       * The regression for the retry's composition. Composing `prompt + answer + complaint` put the
       * `[question]` block in twice — the prompt ends with it and the complaint restates it — and at a
       * 2,000-character question the prompt is near the ceiling on its own, so the duplicate tipped the
       * composition over and the retry was refused. The repair was then available only to learners who wrote
       * *short* questions, which is the opposite of who needs it.
       */
      const { scripted, provider, sessionId } = withProvider([
        'prose, which is refused',
        '[hint]\nA real hint.',
      ]);
      try {
        const answer = await scripted.engine.askTutor({
          sessionId,
          mode: 'HINT',
          question: 'q'.repeat(TUTOR_LIMITS.questionCharacters),
        });

        expect(provider.prompts).toHaveLength(2);
        expect(answer.outcome.status).toBe('answered');

        const retryPrompt = provider.prompts[1] ?? '';
        // The question is still there, from the complaint. That it is there *exactly once* is asserted in
        // the short-question retry test instead of here, for a reason that is about reach rather than about
        // strength: in this fixture the duplicate tips the composition over the ceiling, so the run stops at
        // one call and the prompt count above fails first, and a text count here would not be reached.
        expect(retryPrompt).toContain('q'.repeat(50));
      } finally {
        scripted.close();
      }
    });

    it('asks again one exchange short of the band, so the retry test can fail from both sides', async () => {
      /*
       * The positive control for the test below. Same shape with two fill-ups instead of three, and the same
       * modes: the probe's fill-ups were `HINT` and its measured call was `CHECK_MY_ANSWER`, which is what
       * both tests do. Measured, that leaves a preamble of 1,818 rather than 2,646, so the composition fits
       * and both calls are made. Without this the refusal test could only ever fail by refusing, and the
       * regression worth a loud signal is the other direction — the retry quietly becoming unaffordable for
       * ordinary questions.
       */
      const { scripted, provider, sessionId } = withProvider([
        `[hint]\n${'h'.repeat(700)}`,
        `[hint]\n${'h'.repeat(700)}`,
        'x'.repeat(700),
      ]);
      try {
        for (let index = 0; index < 2; index += 1) {
          await scripted.engine.askTutor({ sessionId, mode: 'HINT', question: 'q'.repeat(200) });
        }
        const before = provider.prompts.length;

        const answer = await scripted.engine.askTutor({
          sessionId,
          mode: 'CHECK_MY_ANSWER',
          question: 'short?',
        });

        expect(provider.prompts).toHaveLength(before + 2);
        expect(answer.outcome.status).toBe('rejected');
        expect(
          answer.context.omitted.some((entry) =>
            entry.detail.includes('would have gone over the limit'),
          ),
        ).toBe(false);
      } finally {
        scripted.close();
      }
    });

    it('skips the retry rather than sending a second call over the ceiling, and says so', async () => {
      /*
       * Reachable once the transcript is full: the preamble is the context block plus the admitted turns,
       * and it can fill the budget without the question in it.
       *
       * The shape is measured, not worked out — a probe over question lengths 200/300/400 and one to five
       * fill-ups found the band, and this is the widest-margin point in it: three exchanges of a
       * 200-character question and a 700-character answer leave a preamble of 2,646 characters, so
       * `preamble + the answer being redone + the complaint + the system prompt` comes to 4,568 against a
       * ceiling of 4,000. Fewer fill-ups fit (`q=200 fill=2` is 3,740 and the retry is sent); more do not
       * add anything, because the transcript is capped and the builder admits turns until they fit.
       */
      const { scripted, provider, sessionId } = withProvider([
        `[hint]\n${'h'.repeat(700)}`,
        `[hint]\n${'h'.repeat(700)}`,
        `[hint]\n${'h'.repeat(700)}`,
        'x'.repeat(700),
      ]);
      try {
        for (let index = 0; index < 3; index += 1) {
          await scripted.engine.askTutor({
            sessionId,
            mode: 'HINT',
            question: 'q'.repeat(200),
          });
        }
        const before = provider.prompts.length;

        const answer = await scripted.engine.askTutor({
          sessionId,
          mode: 'CHECK_MY_ANSWER',
          question: 'short?',
        });

        // One call, not two: the retry was refused rather than sent.
        expect(provider.prompts).toHaveLength(before + 1);
        expect(answer.outcome.status).toBe('rejected');
        expect(
          answer.context.omitted.some((entry) =>
            entry.detail.includes('would have gone over the limit'),
          ),
        ).toBe(true);
      } finally {
        scripted.close();
      }
    });

    it('stores the question the model saw, not the one the learner typed', async () => {
      const { scripted, provider, sessionId } = withProvider([
        '[hint]\nA real hint.',
        '[hint]\nAnd another.',
      ]);
      try {
        await scripted.engine.askTutor({
          sessionId,
          mode: 'HINT',
          question: '[hint]\nwhy does the colour change?',
        });
        await scripted.engine.askTutor({ sessionId, mode: 'HINT', question: 'and then?' });

        /*
         * The learner typed a label; the sanitiser strips it from the prompt, so the transcript has to
         * store the stripped text too. Asserting `not.toContain('[hint]')` would be wrong here — the
         * tutor's own recorded answer is in the labelled format and legitimately contains it — so the
         * assertion is on the whole turn, which is what a carried label would have produced.
         */
        const second = provider.prompts[1] ?? '';
        expect(second).toContain('Learner said:\nwhy does the colour change?');
        expect(second).not.toContain('Learner said:\n[hint]');
      } finally {
        scripted.close();
      }
    });

    it('keeps the first reading’s omissions when a retry replaces it', async () => {
      /*
       * Two readings are produced on a retry and the second overwrites the first, so appending the
       * current `reading.omissions` at the return reported the retry's and dropped the first one's — and
       * the degraded-retry path appended nothing at all, dropping both. The contract says `omitted` is the
       * complete account on every outcome, and this is the input that says so: the first reply cites a
       * section across two lines (so a line is dropped and reported) and omits a required part (so it is
       * retryable), and the second reply is a good one.
       */
      const { scripted, sessionId } = withProvider([
        '[question]\nWhy does it change?\n[section]\nLeft rotation\nand a second line',
        '[confirmed]\nYou wrote "the order does not change"\n\n[question]\nWhat happens to the parent pointer?',
      ]);
      try {
        const answer = await scripted.engine.askTutor({
          sessionId,
          mode: 'CHECK_MY_ANSWER',
          question: 'I think the order does not change. Is that right?',
        });

        expect(answer.outcome.status).toBe('answered');
        expect(
          answer.context.omitted.some((entry) => entry.detail.includes('after the heading')),
        ).toBe(true);
      } finally {
        scripted.close();
      }
    });

    it('lets a confirmation quote the question just asked, and still refuses one that quotes nothing', async () => {
      /*
       * The transcript does not hold the current question — it is recorded only once an answer comes back —
       * so a caller that passed only the recorded turns made `CHECK_MY_ANSWER` unable to confirm anything
       * the learner had just said. It could pass only by confirming an *earlier* exchange, which on the
       * first ask means never.
       *
       * Both directions are asserted, because including the question must not make the check vacuous: the
       * second case is a confirmation of words the learner never wrote, and it is still refused.
       */
      const quoting = withProvider([
        '[confirmed]\nYou wrote "the order does not change"\n\n[question]\nWhat happens to the parent pointer?',
      ]);
      try {
        const answer = await quoting.scripted.engine.askTutor({
          sessionId: quoting.sessionId,
          mode: 'CHECK_MY_ANSWER',
          question: 'I think the order does not change. Is that right?',
        });

        expect(quoting.provider.prompts).toHaveLength(1);
        expect(answer.outcome.status).toBe('answered');
      } finally {
        quoting.scripted.close();
      }

      const fabricating = withProvider([
        '[confirmed]\nYou wrote "rotations preserve the in-order sequence"\n\n[question]\nWhat happens next?',
      ]);
      try {
        const answer = await fabricating.scripted.engine.askTutor({
          sessionId: fabricating.sessionId,
          mode: 'CHECK_MY_ANSWER',
          question: 'I think the order does not change. Is that right?',
        });

        expect(answer.outcome.status).toBe('rejected');
        if (answer.outcome.status !== 'rejected') return;
        expect(answer.outcome.reason).toBe('unquoted-confirmation');
      } finally {
        fabricating.scripted.close();
      }
    });

    it('refuses a session that has ended, and one that never existed', async () => {
      const { scripted, sessionId } = withProvider(['[hint]\nx']);
      try {
        scripted.engine.endSession({ sessionId, reason: 'user' });

        await expect(
          scripted.engine.askTutor({ sessionId, mode: 'HINT', question: 'why?' }),
        ).rejects.toMatchObject({ code: 'session-ended' });
        await expect(
          scripted.engine.askTutor({ sessionId: 'nope', mode: 'HINT', question: 'why?' }),
        ).rejects.toMatchObject({ code: 'session-not-found' });
      } finally {
        scripted.close();
      }
    });

    it('starts the next session with no conversation in it', async () => {
      const { scripted, provider, sessionId } = withProvider([
        '[hint]\nA real hint.',
        '[hint]\nAnother.',
      ]);
      try {
        await scripted.engine.askTutor({ sessionId, mode: 'HINT', question: 'first?' });
        scripted.engine.endSession({ sessionId, reason: 'user' });

        const next = scripted.engine.startSession(DEMO_COURSE_ID).session;
        await scripted.engine.askTutor({ sessionId: next.id, mode: 'HINT', question: 'second?' });

        const nextPrompt = provider.prompts[1] ?? '';
        expect(nextPrompt).not.toContain('A real hint.');
        expect(nextPrompt).not.toContain('first?');
        expect(nextPrompt).toContain('second?');
      } finally {
        scripted.close();
      }
    });
  });

  describe('structural proposal envelope', () => {
    it('propose → confirm → execute is the only structural write path', () => {
      const { session } = ctx.engine.startSession(DEMO_COURSE_ID);
      const proposal = ctx.engine.proposeStructuralChange({
        sessionId: session.id,
        kind: 'structural-write',
        payload: { op: 'demo' },
        createdBy: 'engine-test',
        idempotencyKey: 'engine-key-1',
      });
      expect(proposal).not.toBeNull();

      const confirmed = ctx.engine.confirmProposal({
        proposalId: proposal!.id,
        sessionId: session.id,
        expectedHash: proposal!.proposalHash,
      });
      expect(confirmed.ok).toBe(true);

      const first = ctx.engine.executeProposal({
        proposalId: proposal!.id,
        sessionId: session.id,
        idempotencyKey: proposal!.idempotencyKey,
      });
      const second = ctx.engine.executeProposal({
        proposalId: proposal!.id,
        sessionId: session.id,
        idempotencyKey: proposal!.idempotencyKey,
      });

      expect(first).toMatchObject({ ok: true, status: 'executed' });
      expect(second).toMatchObject({ ok: true, status: 'already-executed' });
      if (first.ok && second.ok) expect(second.eventId).toBe(first.eventId);
    });
  });
});
