import { describe, expect, it } from 'vitest';
import type { LearningEvent, LearningEventSource } from '@focusloop/shared-types';
import {
  createInitialState,
  evaluateTimeBasedState,
  reduceState,
  type StateEngineState,
} from './state-machine';
import { DEFAULT_STATE_ENGINE_CONFIG, resolveStateEngineConfig } from './config';

const SESSION = 'session-1';
const T0 = '2026-01-01T00:00:00.000Z';

function at(offsetMs: number): string {
  return new Date(Date.parse(T0) + offsetMs).toISOString();
}

let counter = 0;

function event(
  type: LearningEvent['type'],
  payload: Record<string, unknown> = {},
  offsetMs = 0,
  source: LearningEventSource = 'user',
): LearningEvent {
  counter += 1;
  return {
    id: `evt-${counter}`,
    sessionId: SESSION,
    at: at(offsetMs),
    type,
    source,
    payload,
  } as LearningEvent;
}

function run(state: StateEngineState, events: readonly LearningEvent[]): StateEngineState {
  return events.reduce((acc, current) => reduceState(acc, current).state, state);
}

describe('state engine — initial state', () => {
  it('starts in READY with no task and no transitions', () => {
    const state = createInitialState(T0);
    expect(state.state).toBe('READY');
    expect(state.currentTaskId).toBeNull();
    expect(state.transitionCount).toBe(0);
  });
});

describe('state engine — task lifecycle', () => {
  it('moves READY -> FOCUSED on TASK_STARTED and records the task', () => {
    const result = reduceState(
      createInitialState(T0),
      event('TASK_STARTED', { taskId: 't1' }, 1000),
    );
    expect(result.state.state).toBe('FOCUSED');
    expect(result.state.currentTaskId).toBe('t1');
    expect(result.transition).toMatchObject({ from: 'READY', to: 'FOCUSED' });
  });

  it('clears the current task on TASK_COMPLETED and keeps it in completedTaskIds', () => {
    const state = run(createInitialState(T0), [
      event('TASK_STARTED', { taskId: 't1' }, 1_000),
      event('TASK_COMPLETED', { taskId: 't1' }, 2_000),
    ]);
    expect(state.currentTaskId).toBeNull();
    expect(state.completedTaskIds).toEqual(['t1']);
    expect(state.state).toBe('FOCUSED');
  });

  it('does not add the same task twice', () => {
    const state = run(createInitialState(T0), [
      event('TASK_COMPLETED', { taskId: 't1' }, 1_000),
      event('TASK_COMPLETED', { taskId: 't1' }, 2_000),
    ]);
    expect(state.completedTaskIds).toEqual(['t1']);
  });

  it('ignores a task event whose payload carries no taskId', () => {
    const before = createInitialState(T0);
    const result = reduceState(before, event('TASK_STARTED', {}, 1_000));
    expect(result.transition).toBeNull();
    expect(result.state.currentTaskId).toBeNull();
    expect(result.state.state).toBe('READY');
  });
});

describe('state engine — interruption detection', () => {
  it('moves to DISTRACTED on TAB_LEFT', () => {
    const state = run(createInitialState(T0), [
      event('TASK_STARTED', { taskId: 't1' }, 1_000),
      event('TAB_LEFT', { origin: 'https://example.com' }, 2_000, 'extension'),
    ]);
    expect(state.state).toBe('DISTRACTED');
    expect(state.awaySince).toBe(at(2_000));
  });

  it('moves to INTERRUPTED when the learner returns after the threshold', () => {
    const awayMs = DEFAULT_STATE_ENGINE_CONFIG.tabLeftThresholdMs + 1;
    const state = run(createInitialState(T0), [
      event('TASK_STARTED', { taskId: 't1' }, 1_000),
      event('TAB_LEFT', {}, 2_000, 'extension'),
      event('TAB_RETURNED', { awayMs }, 2_000 + awayMs, 'extension'),
    ]);
    expect(state.state).toBe('INTERRUPTED');
    expect(state.awaitingResume).toBe(true);
    expect(state.awaySince).toBeNull();
  });

  it('restores FOCUSED when the learner returns quickly and a task is active', () => {
    const awayMs = DEFAULT_STATE_ENGINE_CONFIG.tabLeftThresholdMs - 1;
    const state = run(createInitialState(T0), [
      event('TASK_STARTED', { taskId: 't1' }, 1_000),
      event('TAB_LEFT', {}, 2_000, 'extension'),
      event('TAB_RETURNED', { awayMs }, 2_000 + awayMs, 'extension'),
    ]);
    expect(state.state).toBe('FOCUSED');
    expect(state.awaitingResume).toBe(false);
  });

  it('moves to INTERRUPTED after a long idle period ends', () => {
    const idleMs = DEFAULT_STATE_ENGINE_CONFIG.idleThresholdMs + 1;
    const state = run(createInitialState(T0), [
      event('TASK_STARTED', { taskId: 't1' }, 1_000),
      event('IDLE_STARTED', {}, 2_000, 'extension'),
      event('IDLE_ENDED', { idleMs }, 2_000 + idleMs, 'extension'),
    ]);
    expect(state.state).toBe('INTERRUPTED');
    expect(state.awaitingResume).toBe(true);
  });

  it('promotes DISTRACTED to INTERRUPTED on a time tick past the threshold', () => {
    const awayMs = DEFAULT_STATE_ENGINE_CONFIG.tabLeftThresholdMs + 5_000;
    const distracted = run(createInitialState(T0), [
      event('TASK_STARTED', { taskId: 't1' }, 1_000),
      event('TAB_LEFT', {}, 2_000, 'extension'),
    ]);
    const result = evaluateTimeBasedState(distracted, at(2_000 + awayMs));
    expect(result.state.state).toBe('INTERRUPTED');
    expect(result.transition?.reason).toContain('away for');
  });

  it('does not re-transition when already INTERRUPTED', () => {
    const state = run(createInitialState(T0), [
      event('TAB_LEFT', {}, 1_000, 'extension'),
      event('TAB_RETURNED', { awayMs: 30_000 }, 31_000, 'extension'),
    ]);
    const result = evaluateTimeBasedState(state, at(120_000));
    expect(result.transition).toBeNull();
  });

  it('respects custom thresholds', () => {
    const state = run(createInitialState(T0), [
      event('TASK_STARTED', { taskId: 't1' }, 1_000),
      event('TAB_LEFT', {}, 2_000),
      event('TAB_RETURNED', { awayMs: 3_000 }, 5_000),
    ]);
    const result = evaluateTimeBasedState(state, at(5_000), { tabLeftThresholdMs: 1_000 });
    expect(result.state.state).toBe('FOCUSED');
  });
});

describe('state engine — confusion and overload', () => {
  it('becomes CONFUSED after the configured number of consecutive incorrect quizzes', () => {
    const state = run(createInitialState(T0), [
      event('TASK_STARTED', { taskId: 't1' }, 1_000),
      event('QUIZ_INCORRECT', { taskId: 't1', quizId: 'q1' }, 2_000),
      event('QUIZ_INCORRECT', { taskId: 't1', quizId: 'q1' }, 3_000),
    ]);
    expect(state.state).toBe('CONFUSED');
    expect(state.consecutiveIncorrect).toBe(2);
  });

  it('a correct answer resets the incorrect counter and returns to FOCUSED', () => {
    const state = run(createInitialState(T0), [
      event('TASK_STARTED', { taskId: 't1' }, 1_000),
      event('QUIZ_INCORRECT', { taskId: 't1', quizId: 'q1' }, 2_000),
      event('QUIZ_CORRECT', { taskId: 't1', quizId: 'q1' }, 3_000),
    ]);
    expect(state.state).toBe('FOCUSED');
    expect(state.consecutiveIncorrect).toBe(0);
  });

  it('becomes OVERLOADED when help is requested repeatedly inside the window', () => {
    const threshold = DEFAULT_STATE_ENGINE_CONFIG.helpRequestOverloadThreshold;
    const events: LearningEvent[] = [event('TASK_STARTED', { taskId: 't1' }, 1_000)];
    for (let i = 0; i < threshold; i += 1) {
      events.push(event('HELP_REQUESTED', { taskId: 't1' }, 2_000 + i * 1_000));
    }
    const state = run(createInitialState(T0), events);
    expect(state.state).toBe('OVERLOADED');
  });

  it('drops help requests that fall outside the window', () => {
    const state = run(createInitialState(T0), [
      event('TASK_STARTED', { taskId: 't1' }, 1_000),
      event('HELP_REQUESTED', {}, 2_000),
      event('HELP_REQUESTED', {}, 1_000_000),
      event('HELP_REQUESTED', {}, 1_001_000),
    ]);
    expect(state.recentHelpRequests).toHaveLength(2);
    expect(state.state).toBe('CONFUSED');
  });
});

describe('state engine — resume', () => {
  it('moves to RESUMING when the resume is accepted', () => {
    const state = run(createInitialState(T0), [
      event('TASK_STARTED', { taskId: 't1' }, 1_000),
      event('TAB_LEFT', {}, 2_000),
      event('TAB_RETURNED', { awayMs: 30_000 }, 32_000),
      event('RESUME_REQUESTED', { checkpointId: 'c1' }, 33_000),
    ]);
    expect(state.state).toBe('RESUMING');
    expect(state.awaitingResume).toBe(false);
  });

  it('returns to FOCUSED when the resume card is dismissed while a task is active', () => {
    const state = run(createInitialState(T0), [
      event('TASK_STARTED', { taskId: 't1' }, 1_000),
      event('TAB_LEFT', {}, 2_000),
      event('TAB_RETURNED', { awayMs: 30_000 }, 32_000),
      event('RESUME_DISMISSED', { checkpointId: 'c1' }, 33_000),
    ]);
    expect(state.state).toBe('FOCUSED');
    expect(state.awaitingResume).toBe(false);
  });
});

describe('state engine — session boundaries', () => {
  it('resets the working set on SESSION_STARTED', () => {
    const dirty = run(createInitialState(T0), [
      event('TASK_STARTED', { taskId: 't1' }, 1_000),
      event('TASK_COMPLETED', { taskId: 't1' }, 2_000),
    ]);
    const state = reduceState(
      dirty,
      event('SESSION_STARTED', { courseId: 'c', sessionId: SESSION }, 3_000),
    ).state;
    expect(state.state).toBe('READY');
    expect(state.completedTaskIds).toEqual([]);
    expect(state.currentTaskId).toBeNull();
  });

  it('returns to READY on SESSION_ENDED', () => {
    const state = run(createInitialState(T0), [
      event('TASK_STARTED', { taskId: 't1' }, 1_000),
      event('SESSION_ENDED', { reason: 'user' }, 2_000),
    ]);
    expect(state.state).toBe('READY');
    expect(state.currentTaskId).toBeNull();
  });
});

describe('state engine — initiation friction', () => {
  it('flags INITIATION_FRICTION when no task starts in time', () => {
    const ready = createInitialState(T0);
    const later = at(DEFAULT_STATE_ENGINE_CONFIG.initiationFrictionThresholdMs + 1_000);
    const result = evaluateTimeBasedState(ready, later);
    expect(result.state.state).toBe('INITIATION_FRICTION');
    expect(result.transition?.reason).toContain('no task started');
  });

  it('does not flag INITIATION_FRICTION while a task is active', () => {
    const focused = reduceState(
      createInitialState(T0),
      event('TASK_STARTED', { taskId: 't1' }, 1_000),
    ).state;
    const result = evaluateTimeBasedState(focused, at(600_000));
    expect(result.transition).toBeNull();
    expect(result.state.state).toBe('FOCUSED');
  });
});

describe('state engine — durability guarantees', () => {
  it('ignores duplicated events (race / reconnect protection)', () => {
    const first = event('TAB_LEFT', {}, 1_000, 'extension');
    const once = reduceState(createInitialState(T0), first);
    const twice = reduceState(once.state, { ...first, at: at(1_500) });
    expect(twice.duplicate).toBe(true);
    expect(twice.transition).toBeNull();
    expect(twice.state.state).toBe('DISTRACTED');
  });

  it('bounds the dedupe ring to the configured window', () => {
    let state = createInitialState(T0);
    for (let i = 0; i < 60; i += 1) {
      state = reduceState(
        state,
        event('QUIZ_CORRECT', { taskId: 't1', quizId: 'q1' }, i * 10),
      ).state;
    }
    expect(state.recentEventIds.length).toBeLessThanOrEqual(
      DEFAULT_STATE_ENGINE_CONFIG.dedupeWindowSize,
    );
  });

  it('never mutates its input state', () => {
    const before = createInitialState(T0);
    const snapshot = JSON.stringify(before);
    reduceState(before, event('TASK_STARTED', { taskId: 't1' }, 1_000));
    expect(JSON.stringify(before)).toBe(snapshot);
  });

  it('is deterministic for the same input', () => {
    const events = [
      event('TASK_STARTED', { taskId: 't1' }, 1_000),
      event('HELP_REQUESTED', {}, 2_000),
      event('QUIZ_INCORRECT', { taskId: 't1', quizId: 'q1' }, 3_000),
    ];
    const a = run(createInitialState(T0), events);
    const b = run(createInitialState(T0), events);
    expect(a).toEqual(b);
  });
});

describe('config', () => {
  it('rejects negative thresholds', () => {
    expect(() => resolveStateEngineConfig({ idleThresholdMs: -1 })).toThrow(RangeError);
  });

  it('rejects non-finite thresholds', () => {
    expect(() => resolveStateEngineConfig({ tabLeftThresholdMs: Number.NaN })).toThrow(RangeError);
  });
});
