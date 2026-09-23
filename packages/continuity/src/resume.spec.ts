import { describe, expect, it } from 'vitest';
import type { LearningEvent } from '@focusloop/shared-types';
import { createInitialState, type StateEngineState } from '@focusloop/learning-state';
import { buildCheckpoint } from './checkpoint';
import {
  buildResumeCard,
  computeResumeLatencyMs,
  evaluateResumeOutcome,
  sessionTitle,
} from './resume';
import { detectInterruption, isAwayOrIdle, shouldOfferResume } from './interruption';
import { tinyCourse, tinySession } from './fixtures';

const T0 = '2026-01-01T00:00:00.000Z';
const T1 = '2026-01-01T00:05:00.000Z';

function tabReturned(awayMs: number): LearningEvent {
  return {
    id: 'e-return',
    sessionId: 'session-tiny',
    at: T1,
    type: 'TAB_RETURNED',
    source: 'extension',
    payload: { awayMs },
  };
}

function checkpointFor(engineState: StateEngineState) {
  return buildCheckpoint({
    session: tinySession(),
    course: tinyCourse(),
    engineState,
    now: T1,
  });
}

describe('buildResumeCard', () => {
  it('summarises where the learner was and what comes next', () => {
    const engineState: StateEngineState = {
      ...createInitialState(T0),
      state: 'INTERRUPTED',
      currentTaskId: 't2',
      lastActiveTaskId: 't2',
      completedTaskIds: ['t1'],
      awaitingResume: true,
    };
    const card = buildResumeCard({
      checkpoint: checkpointFor(engineState),
      session: tinySession({ completedTaskIds: ['t1'] }),
      course: tinyCourse(),
      recentEvents: [tabReturned(30_000)],
      now: T1,
    });

    expect(card.title).toEqual({ key: 'resume.title.task', params: { task: 'Practise one' } });
    expect(card.completed).toEqual(['Read one']);
    expect(card.unresolved).toEqual(['Concept one']);
    expect(card.nextAction).toEqual({
      key: 'action.practice.example',
      params: { title: 'Practise one' },
    });
    expect(card.estimatedMinutes).toBe(6);
    expect(card.lastContext.key).toBe('resume.context.away');
    expect(card.lastContext.params).toMatchObject({
      concept: 'Concept one',
      goal: 'Practise one',
      duration: '30s',
    });
  });

  it('reports idle-based interruptions too', () => {
    const engineState: StateEngineState = {
      ...createInitialState(T0),
      state: 'INTERRUPTED',
      currentTaskId: 't2',
      completedTaskIds: ['t1'],
    };
    const card = buildResumeCard({
      checkpoint: checkpointFor(engineState),
      session: tinySession({ completedTaskIds: ['t1'] }),
      course: tinyCourse(),
      recentEvents: [
        {
          id: 'e-idle',
          sessionId: 'session-tiny',
          at: T1,
          type: 'IDLE_ENDED',
          source: 'extension',
          payload: { idleMs: 180_000 },
        },
      ],
      now: T1,
    });
    expect(card.lastContext.params['duration']).toBe('3 min');
  });

  it('works when no interruption event is present', () => {
    const card = buildResumeCard({
      checkpoint: checkpointFor(createInitialState(T0)),
      session: tinySession(),
      course: tinyCourse(),
      recentEvents: [],
      now: T1,
    });
    expect(card.lastContext.key).toBe('resume.context.plain');
    expect(card.lastContext.params['goal']).toBeDefined();
    expect(card.completed).toEqual([]);
  });

  it('falls back to a sane estimate when the task has no duration', () => {
    const course = tinyCourse();
    const card = buildResumeCard({
      checkpoint: checkpointFor(createInitialState(T0)),
      session: tinySession(),
      course: {
        ...course,
        microTasks: course.microTasks.map((task) => ({ ...task, estimatedMinutes: 0 })),
      },
      recentEvents: [],
      now: T1,
    });
    expect(card.estimatedMinutes).toBe(5);
  });

  it('never reports more than three completed items', () => {
    const course = tinyCourse();
    const card = buildResumeCard({
      checkpoint: checkpointFor({
        ...createInitialState(T0),
        completedTaskIds: ['t1', 't2', 't3'],
      }),
      session: tinySession({ completedTaskIds: ['t1', 't2', 't3'] }),
      course,
      recentEvents: [],
      now: T1,
    });
    expect(card.completed.length).toBeLessThanOrEqual(3);
  });

  it('is deterministic', () => {
    const checkpoint = checkpointFor(createInitialState(T0));
    const args = {
      checkpoint,
      session: tinySession(),
      course: tinyCourse(),
      recentEvents: [tabReturned(1_000)],
      now: T1,
    };
    expect(buildResumeCard(args)).toEqual(buildResumeCard(args));
  });
});

describe('computeResumeLatencyMs', () => {
  it('measures the delay between shown and accepted', () => {
    expect(computeResumeLatencyMs(T0, '2026-01-01T00:00:04.000Z')).toBe(4_000);
  });

  it('returns null when the card was never accepted', () => {
    expect(computeResumeLatencyMs(T0, undefined)).toBeNull();
  });

  it('returns null for an invalid timestamp', () => {
    expect(computeResumeLatencyMs(T0, 'not-a-date')).toBeNull();
  });

  it('returns null when accepted before being shown (clock skew)', () => {
    expect(computeResumeLatencyMs(T1, T0)).toBeNull();
  });
});

describe('sessionTitle', () => {
  it('combines the course title with the session date', () => {
    expect(sessionTitle(tinySession(), tinyCourse())).toBe('Tiny course · 2026-01-01');
  });
});

describe('interruption detection', () => {
  it('flags a tab-left interruption past the threshold', () => {
    const state: StateEngineState = {
      ...createInitialState(T0),
      awaySince: T0,
      state: 'DISTRACTED',
    };
    const status = detectInterruption(state, T1, { tabLeftThresholdMs: 60_000 });
    expect(status).toMatchObject({ interrupted: true, kind: 'tab-left' });
    expect(status.elapsedMs).toBe(300_000);
  });

  it('flags an idle interruption past the threshold', () => {
    const state: StateEngineState = {
      ...createInitialState(T0),
      idleSince: T0,
      state: 'DISTRACTED',
    };
    const status = detectInterruption(state, T1, { idleThresholdMs: 60_000 });
    expect(status).toMatchObject({ interrupted: true, kind: 'idle' });
  });

  it('does not flag anything below the threshold', () => {
    const state: StateEngineState = {
      ...createInitialState(T0),
      awaySince: T1,
      state: 'DISTRACTED',
    };
    const status = detectInterruption(state, T1);
    expect(status.interrupted).toBe(false);
    expect(status.kind).toBe('none');
  });

  it('reports an existing interruption without re-deriving it', () => {
    const state: StateEngineState = { ...createInitialState(T0), state: 'INTERRUPTED' };
    const status = detectInterruption(state, T1);
    expect(status.interrupted).toBe(true);
    expect(status.reason).toBe('already interrupted');
  });

  it('is inclusive of the configured threshold', () => {
    const state: StateEngineState = {
      ...createInitialState(T0),
      awaySince: T0,
      state: 'DISTRACTED',
    };
    const status = detectInterruption(state, T1, { tabLeftThresholdMs: 300_000 });
    expect(status.interrupted).toBe(true);
  });

  it('shouldOfferResume only when interrupted and unanswered', () => {
    const interrupted = {
      ...createInitialState(T0),
      state: 'INTERRUPTED' as const,
      awaitingResume: true,
    };
    expect(shouldOfferResume(interrupted)).toBe(true);
    expect(shouldOfferResume({ ...interrupted, awaitingResume: false })).toBe(false);
    expect(shouldOfferResume({ ...interrupted, state: 'FOCUSED' })).toBe(false);
  });

  it('isAwayOrIdle reflects the pending markers', () => {
    expect(isAwayOrIdle(createInitialState(T0))).toBe(false);
    expect(isAwayOrIdle({ ...createInitialState(T0), awaySince: T0 })).toBe(true);
    expect(isAwayOrIdle({ ...createInitialState(T0), idleSince: T0 })).toBe(true);
  });
});

describe('evaluateResumeOutcome', () => {
  const checkpoint = {
    id: 'cp-1',
    sessionId: 'session-tiny',
    conceptId: 'c1',
    conceptTitle: 'Concept one',
    goal: 'Learn it',
    mastered: [],
    unresolved: ['Concept one'],
    currentTaskId: 't1',
    currentTaskTitle: 'Read one',
    currentStep: 1,
    frictionState: 'FOCUSED' as const,
    nextBestAction: { key: 'action.read.summarise' as const, params: {} },
    createdAt: T0,
  };

  function ev(
    id: string,
    type: LearningEvent['type'],
    at: string,
    payload: Record<string, unknown>,
  ): LearningEvent {
    return {
      id,
      sessionId: 'session-tiny',
      at,
      type,
      source: 'user',
      payload,
    } as LearningEvent;
  }

  const acceptedAt = '2026-01-01T00:01:00.000Z';

  it('marks accept-then-help-again as reengaged without progressed', () => {
    const result = evaluateResumeOutcome({
      checkpoint,
      timing: { checkpointId: 'cp-1', shownAt: T0, acceptedAt },
      events: [
        ev('e-help', 'HELP_REQUESTED', '2026-01-01T00:01:30.000Z', {
          taskId: 't1',
          reason: 'tired',
        }),
      ],
      now: '2026-01-01T00:02:00.000Z',
    });

    expect(result.reengaged).toBe(true);
    expect(result.progressed).toBe(false);
    expect(result.stalledAgain).toBe(true);
    expect(result.status).toBe('observed');
  });

  it('counts completion as both reengaged and progressed', () => {
    const result = evaluateResumeOutcome({
      checkpoint,
      timing: { checkpointId: 'cp-1', shownAt: T0, acceptedAt },
      events: [ev('e-done', 'TASK_COMPLETED', '2026-01-01T00:02:00.000Z', { taskId: 't1' })],
      now: '2026-01-01T00:03:00.000Z',
    });
    expect(result.reengaged).toBe(true);
    expect(result.progressed).toBe(true);
    expect(result.stalledAgain).toBe(false);
  });

  it('expires a silent window and keeps pending out until it closes', () => {
    const pending = evaluateResumeOutcome({
      checkpoint,
      timing: { checkpointId: 'cp-1', shownAt: T0, acceptedAt },
      events: [],
      now: '2026-01-01T00:02:00.000Z',
    });
    expect(pending.status).toBe('pending');

    const expired = evaluateResumeOutcome({
      checkpoint,
      timing: { checkpointId: 'cp-1', shownAt: T0, acceptedAt },
      events: [],
      now: '2026-01-01T00:07:00.000Z',
    });
    expect(expired.status).toBe('expired');
    expect(expired.reengaged).toBe(false);
    expect(expired.stalledAgain).toBe(false);
  });

  it('treats a session that ends inside the window as stalledAgain, not expired', () => {
    const result = evaluateResumeOutcome({
      checkpoint,
      timing: { checkpointId: 'cp-1', shownAt: T0, acceptedAt },
      events: [],
      sessionEndedAt: '2026-01-01T00:03:00.000Z',
      now: '2026-01-01T00:07:00.000Z',
    });
    expect(result.stalledAgain).toBe(true);
    expect(result.status).toBe('observed');
    expect(result.status).not.toBe('expired');
  });

  it('ignores evidence from another task and outside the window', () => {
    const result = evaluateResumeOutcome({
      checkpoint,
      timing: { checkpointId: 'cp-1', shownAt: T0, acceptedAt },
      events: [
        ev('e-other-task', 'TASK_COMPLETED', '2026-01-01T00:02:00.000Z', { taskId: 't2' }),
        ev('e-before', 'TASK_COMPLETED', T0, { taskId: 't1' }),
        ev('e-late', 'TASK_COMPLETED', '2026-01-01T00:07:00.000Z', { taskId: 't1' }),
      ],
      now: '2026-01-01T00:08:00.000Z',
    });
    expect(result.reengaged).toBe(false);
    expect(result.progressed).toBe(false);
    expect(result.status).toBe('expired');
  });

  it('keeps dismissed cards out of every count', () => {
    const result = evaluateResumeOutcome({
      checkpoint,
      timing: { checkpointId: 'cp-1', shownAt: T0, acceptedAt, dismissedAt: T1 },
      events: [ev('e-help', 'HELP_REQUESTED', '2026-01-01T00:01:30.000Z', { taskId: 't1' })],
      now: '2026-01-01T00:10:00.000Z',
    });
    expect(result.status).toBe('dismissed');
    expect(result.reengaged).toBe(false);
    expect(result.stalledAgain).toBe(false);
  });

  it('stays pending when the card was never accepted', () => {
    const result = evaluateResumeOutcome({
      checkpoint,
      timing: { checkpointId: 'cp-1', shownAt: T0 },
      events: [],
      now: T1,
    });
    expect(result.status).toBe('pending');
    expect(result.acceptedAt).toBeNull();
    expect(result.windowEndsAt).toBeNull();
  });

  it('counts another interruption in the window as stalledAgain', () => {
    const result = evaluateResumeOutcome({
      checkpoint,
      timing: { checkpointId: 'cp-1', shownAt: T0, acceptedAt },
      events: [ev('e-left', 'TAB_LEFT', '2026-01-01T00:02:00.000Z', {})],
      now: '2026-01-01T00:03:00.000Z',
    });
    expect(result.stalledAgain).toBe(true);
    expect(result.reengaged).toBe(false);
    expect(result.status).toBe('observed');
  });

  it('counts a help request without taskId as stalledAgain', () => {
    const result = evaluateResumeOutcome({
      checkpoint,
      timing: { checkpointId: 'cp-1', shownAt: T0, acceptedAt },
      events: [ev('e-help-legacy', 'HELP_REQUESTED', '2026-01-01T00:02:00.000Z', {})],
      now: '2026-01-01T00:03:00.000Z',
    });
    expect(result.stalledAgain).toBe(true);
    expect(result.reengaged).toBe(false);
    expect(result.status).toBe('observed');
  });

  it('counts each event id once and ignores another session', () => {
    const result = evaluateResumeOutcome({
      checkpoint,
      timing: { checkpointId: 'cp-1', shownAt: T0, acceptedAt },
      events: [
        ev('e-done', 'TASK_COMPLETED', '2026-01-01T00:02:00.000Z', { taskId: 't1' }),
        ev('e-done', 'TASK_COMPLETED', '2026-01-01T00:02:10.000Z', { taskId: 't1' }),
        {
          ...ev('e-other', 'TASK_COMPLETED', '2026-01-01T00:02:20.000Z', { taskId: 't1' }),
          sessionId: 'session-other',
        },
      ],
      now: '2026-01-01T00:03:00.000Z',
    });
    expect(result.reengageEventIds).toEqual(['e-done']);
    expect(result.reengaged).toBe(true);
    expect(result.progressed).toBe(true);
  });

  it('accepts a custom window and invalid window falls back to the default', () => {
    const short = evaluateResumeOutcome({
      checkpoint,
      timing: { checkpointId: 'cp-1', shownAt: T0, acceptedAt },
      events: [],
      now: '2026-01-01T00:02:30.000Z',
      windowMs: 60_000,
    });
    expect(short.status).toBe('expired');

    const invalid = evaluateResumeOutcome({
      checkpoint,
      timing: { checkpointId: 'cp-1', shownAt: T0, acceptedAt },
      events: [],
      now: '2026-01-01T00:02:30.000Z',
      windowMs: Number.NaN,
    });
    expect(invalid.status).toBe('pending');
    expect(invalid.windowEndsAt).toBe('2026-01-01T00:06:00.000Z');
  });

  it('keeps a dismissed card without acceptedAt well-formed', () => {
    const result = evaluateResumeOutcome({
      checkpoint,
      timing: { checkpointId: 'cp-1', shownAt: T0, dismissedAt: T1 },
      events: [],
      now: T1,
    });
    expect(result.status).toBe('dismissed');
    expect(result.acceptedAt).toBeNull();
    expect(result.windowEndsAt).toBeNull();
  });
});
