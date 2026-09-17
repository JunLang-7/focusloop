import { describe, expect, it } from 'vitest';
import { createInitialState, reduceState, type StateEngineState } from '@focusloop/learning-state';
import { buildCheckpoint, describeProgress, firstIncompleteTask } from './checkpoint';
import { tinyCourse, tinySession } from './fixtures';

const T0 = '2026-01-01T00:00:00.000Z';
const T1 = '2026-01-01T00:01:00.000Z';

function engineWith(patch: Partial<StateEngineState>): StateEngineState {
  return { ...createInitialState(T0), ...patch };
}

function started(taskId: string): StateEngineState {
  return reduceState(createInitialState(T0), {
    id: `e-${taskId}`,
    sessionId: 'session-tiny',
    at: T1,
    type: 'TASK_STARTED',
    source: 'user',
    payload: { taskId },
  }).state;
}

describe('describeProgress', () => {
  it('reports nothing mastered and the current concept unresolved', () => {
    const view = describeProgress(tinyCourse(), [], 't1');
    expect(view.mastered).toEqual([]);
    expect(view.unresolved).toEqual(['Concept one']);
    expect(view.currentTask?.id).toBe('t1');
    expect(view.currentIndex).toBe(0);
  });

  it('marks a concept mastered once all of its tasks are done', () => {
    const view = describeProgress(tinyCourse(), ['t1', 't2'], 't3');
    expect(view.mastered).toEqual(['Concept one']);
    expect(view.unresolved).toEqual(['Concept two']);
  });

  it('does not list a not-yet-started concept as unresolved', () => {
    const view = describeProgress(tinyCourse(), ['t1'], 't1');
    expect(view.unresolved).toEqual(['Concept one']);
  });

  it('handles a null current task', () => {
    const view = describeProgress(tinyCourse(), [], null);
    expect(view.currentTask).toBeNull();
    expect(view.currentIndex).toBe(-1);
  });
});

describe('firstIncompleteTask', () => {
  it('returns the earliest unfinished task', () => {
    expect(firstIncompleteTask(tinyCourse(), ['t1'])?.id).toBe('t2');
  });

  it('returns null when everything is done', () => {
    expect(firstIncompleteTask(tinyCourse(), ['t1', 't2', 't3'])).toBeNull();
  });
});

describe('buildCheckpoint', () => {
  it('points at the first task for a fresh session', () => {
    const checkpoint = buildCheckpoint({
      session: tinySession(),
      course: tinyCourse(),
      engineState: createInitialState(T0),
      now: T0,
    });
    expect(checkpoint.currentTaskId).toBe('t1');
    expect(checkpoint.currentStep).toBe(1);
    expect(checkpoint.conceptTitle).toBe('Concept one');
    expect(checkpoint.goal).toBe('Read one');
  });

  it('keeps the learner on the task they were actually on', () => {
    const checkpoint = buildCheckpoint({
      session: tinySession(),
      course: tinyCourse(),
      engineState: started('t2'),
      now: T1,
    });
    expect(checkpoint.currentTaskId).toBe('t2');
    expect(checkpoint.currentStep).toBe(2);
    expect(checkpoint.nextBestAction).toContain('Practise');
  });

  it('preserves the friction state so resume knows why we stopped', () => {
    const checkpoint = buildCheckpoint({
      session: tinySession({ state: 'INTERRUPTED' }),
      course: tinyCourse(),
      engineState: engineWith({ state: 'INTERRUPTED', currentTaskId: 't2' }),
      now: T1,
    });
    expect(checkpoint.frictionState).toBe('INTERRUPTED');
  });

  it('suggests the upcoming action for a quiz task', () => {
    const checkpoint = buildCheckpoint({
      session: tinySession(),
      course: tinyCourse(),
      engineState: engineWith({ completedTaskIds: ['t1', 't2'], currentTaskId: 't3' }),
      now: T1,
    });
    expect(checkpoint.nextBestAction).toContain('Answer the check question');
  });

  it('suggests finishing the session when every task is done', () => {
    const checkpoint = buildCheckpoint({
      session: tinySession(),
      course: tinyCourse(),
      engineState: engineWith({ completedTaskIds: ['t1', 't2', 't3'], currentTaskId: null }),
      now: T1,
    });
    expect(checkpoint.nextBestAction).toBe('End the session and review what you finished.');
  });

  it('is deterministic and derives a stable id', () => {
    const args = {
      session: tinySession(),
      course: tinyCourse(),
      engineState: started('t1'),
      now: T1,
    };
    const a = buildCheckpoint(args);
    const b = buildCheckpoint(args);
    expect(a).toEqual(b);
    expect(a.id).toBe('session-tiny:2026-01-01T00:01:00.000Z');
  });

  it('honours an explicit checkpoint id and goal', () => {
    const checkpoint = buildCheckpoint({
      session: tinySession(),
      course: tinyCourse(),
      engineState: createInitialState(T0),
      now: T0,
      checkpointId: 'cp-1',
      goal: 'Custom goal',
    });
    expect(checkpoint.id).toBe('cp-1');
    expect(checkpoint.goal).toBe('Custom goal');
  });
});
