import { describe, expect, it } from 'vitest';
import type { LearningEvent } from '@focusloop/shared-types';
import { createInitialState, type StateEngineState } from '@focusloop/learning-state';
import { buildCheckpoint } from './checkpoint';
import { buildResumeCard, computeResumeLatencyMs, sessionTitle } from './resume';
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

    expect(card.title).toBe('Continue: Practise one');
    expect(card.completed).toEqual(['Read one']);
    expect(card.unresolved).toEqual(['Concept one']);
    expect(card.nextAction).toContain('Practise');
    expect(card.estimatedMinutes).toBe(6);
    expect(card.lastContext).toContain('Concept one');
    expect(card.lastContext).toContain('30s');
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
    expect(card.lastContext).toContain('3 min');
  });

  it('works when no interruption event is present', () => {
    const card = buildResumeCard({
      checkpoint: checkpointFor(createInitialState(T0)),
      session: tinySession(),
      course: tinyCourse(),
      recentEvents: [],
      now: T1,
    });
    expect(card.lastContext).toContain('goal:');
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
