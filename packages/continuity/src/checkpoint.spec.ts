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
    expect(checkpoint.courseStep).toBe(1);
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
    expect(checkpoint.courseStep).toBe(2);
    expect(checkpoint.nextBestAction).toEqual({
      key: 'action.practice.example',
      params: { title: 'Practise one' },
    });
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
    expect(checkpoint.nextBestAction).toEqual({
      key: 'action.quiz.answer',
      params: { title: 'Quiz two' },
    });
  });

  it('suggests finishing the session when every task is done', () => {
    const checkpoint = buildCheckpoint({
      session: tinySession(),
      course: tinyCourse(),
      engineState: engineWith({ completedTaskIds: ['t1', 't2', 't3'], currentTaskId: null }),
      now: T1,
    });
    expect(checkpoint.nextBestAction).toEqual({ key: 'action.session.finish', params: {} });
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

/*
 * Two questions, two answers, and the test is here so neither answer can quietly become the other
 * (#194).
 *
 * The number answers "where does this task sit in the material" and counts the course's order, which
 * is the same list the denominator (7) counts — the learner's plan cannot answer it, because the plan
 * deliberately excludes the running task, so it has nowhere to put the task the checkpoint is about.
 * The focus task answers "which task comes next" and follows the learner's plan, because that is the
 * task the focus screen offers as the next small step.
 */
describe('whose order the checkpoint counts (#194)', () => {
  it('counts the course order even when the learner reordered the plan', () => {
    // On t2 (the course's second task) with t3 moved ahead of t1 in the plan. Following the plan would
    // put t2 third; the course puts it second, and it is the course's seven that the "of 7" counts.
    const checkpoint = buildCheckpoint({
      session: tinySession({ taskOrder: ['t3', 't1'] }),
      course: tinyCourse(),
      engineState: started('t2'),
      now: T1,
    });

    expect(checkpoint.courseStep).toBe(2);
    expect(checkpoint.currentTaskId).toBe('t2');
  });

  it('offers the next task the way the plan offers it, and counts it in the course', () => {
    // Nothing is running, so the checkpoint falls through to the first unfinished task — which is the
    // same list the focus screen's "Next small step" card is built from.
    const checkpoint = buildCheckpoint({
      session: tinySession({ taskOrder: ['t3', 't1'] }),
      course: tinyCourse(),
      engineState: engineWith({}),
      now: T1,
    });

    expect(checkpoint.currentTaskId).toBe('t3');
    expect(checkpoint.courseStep).toBe(3);
    expect(checkpoint.goal).toBe('Quiz two');
    expect(checkpoint.nextBestAction).toEqual({
      key: 'action.quiz.answer',
      params: { title: 'Quiz two' },
    });
  });

  it('still falls back to the course order when the learner has not reordered anything', () => {
    expect(firstIncompleteTask(tinyCourse(), ['t1'])?.id).toBe('t2');
  });
});
