import { describe, expect, it } from 'vitest';
import type {
  AgentContext,
  Course,
  LearningSession,
  MicroTask,
  TaskRewrite,
} from '@focusloop/shared-types';
import { buildAgentContext } from './agent-context';
import { applyTaskRewrite, buildTaskRewrite, rewriteIdempotencyKey } from './task-rewrite';

const FIRST = 'in-order traversal is sorted';
const SECOND = 'a rotation preserves the in-order sequence';
const THIRD = 'a recoloured node never moves';

function task(overrides: Partial<MicroTask> = {}): MicroTask {
  return {
    id: 't1',
    courseId: 'c1',
    conceptId: 'k1',
    title: 'Read rotations',
    instructions: 'Read the whole section and take notes',
    kind: 'read',
    estimatedMinutes: 7,
    order: 0,
    ...overrides,
  };
}

function course(overrides: Partial<Course> = {}): Course {
  return {
    id: 'c1',
    title: 'Data structures',
    description: '',
    concepts: [
      {
        id: 'k1',
        title: 'Rotations',
        summary: 'A rotation restructures three nodes.',
        order: 0,
        keyPoints: [FIRST, SECOND, THIRD],
      },
    ],
    microTasks: [
      task(),
      {
        id: 't2',
        courseId: 'c1',
        conceptId: 'k1',
        title: 'Try an insert',
        instructions: 'Do one by hand',
        kind: 'practice',
        estimatedMinutes: 5,
        order: 1,
      },
    ],
    quizzes: [],
    ...overrides,
  };
}

function session(overrides: Partial<LearningSession> = {}): LearningSession {
  return {
    id: 's1',
    courseId: 'c1',
    startedAt: '2026-10-05T00:00:00.000Z',
    state: 'FOCUSED',
    currentTaskId: 't1',
    completedTaskIds: [],
    updatedAt: '2026-10-05T00:00:00.000Z',
    ...overrides,
  };
}

function context(
  courseValue: Course = course(),
  sessionValue: LearningSession = session(),
): AgentContext | null {
  return buildAgentContext({
    session: sessionValue,
    progress: null,
    course: courseValue,
    courseCount: 1,
    material: null,
    events: [],
    checkpoint: null,
    learningState: sessionValue.state,
  }).context;
}

const rewrite = (): TaskRewrite => ({
  action: 'MICRO_START',
  taskId: 't1',
  steps: [{ text: FIRST, estimatedMinutes: 2 }],
  estimatedMinutes: 2,
  sourceEstimatedMinutes: 7,
});

describe('MICRO_START narrows a task to its first grounded step', () => {
  it('turns a seven-minute task into one step of two minutes', () => {
    expect(buildTaskRewrite('MICRO_START', context())).toEqual({
      status: 'suggested',
      rewrite: rewrite(),
    });
  });

  it('refuses without a context rather than inventing a step', () => {
    expect(buildTaskRewrite('MICRO_START', null)).toEqual({
      status: 'unavailable',
      reason: 'missing-context',
    });
  });

  it.each([
    [
      'a task that is already small',
      course({ microTasks: [task({ estimatedMinutes: 1 })] }),
      'already-small',
    ],
    [
      'a two-minute task, which the promise does not fit',
      course({ microTasks: [task({ estimatedMinutes: 2 })] }),
      'not-two-minutes',
    ],
    [
      'a quiz, which narrowing would stop measuring',
      course({ microTasks: [task({ kind: 'quiz' })] }),
      'unsupported-task-kind',
    ],
    [
      'a concept with no key point',
      course({
        concepts: [{ id: 'k1', title: 'Rotations', summary: '', order: 0, keyPoints: [] }],
      }),
      'no-grounded-focus',
    ],
  ])('refuses %s', (_name, courseValue, reason) => {
    expect(buildTaskRewrite('MICRO_START', context(courseValue))).toEqual({
      status: 'unavailable',
      reason,
    });
  });

  it('refuses when the learner is on no task at all', () => {
    expect(
      buildTaskRewrite('MICRO_START', context(course(), session({ currentTaskId: undefined }))),
    ).toEqual({ status: 'unavailable', reason: 'missing-task' });
  });
});

describe('SIMPLIFY splits a task into grounded steps of bounded minutes', () => {
  it('splits a seven-minute task into three steps of two minutes', () => {
    expect(buildTaskRewrite('SIMPLIFY', context())).toEqual({
      status: 'suggested',
      rewrite: {
        action: 'SIMPLIFY',
        taskId: 't1',
        steps: [
          { text: FIRST, estimatedMinutes: 2 },
          { text: SECOND, estimatedMinutes: 2 },
          { text: THIRD, estimatedMinutes: 2 },
        ],
        estimatedMinutes: 6,
        sourceEstimatedMinutes: 7,
      },
    });
  });

  it('stops splitting while the steps still fit inside the task', () => {
    // Two steps of two minutes fit a five-minute task; a third would add up to more than the learner
    // was given, which is not a simpler task.
    const result = buildTaskRewrite(
      'SIMPLIFY',
      context(course({ microTasks: [task({ estimatedMinutes: 5 })] })),
    );
    expect(result).toMatchObject({
      status: 'suggested',
      rewrite: { estimatedMinutes: 4, steps: [{ text: FIRST }, { text: SECOND }] },
    });
  });

  it('refuses rather than calling one step a split', () => {
    // A four-minute task holds one two-minute step and nothing more.
    expect(
      buildTaskRewrite(
        'SIMPLIFY',
        context(course({ microTasks: [task({ estimatedMinutes: 4 })] })),
      ),
    ).toEqual({ status: 'unavailable', reason: 'no-split-steps' });
    expect(
      buildTaskRewrite(
        'SIMPLIFY',
        context(
          course({
            concepts: [{ id: 'k1', title: 'Rotations', summary: '', order: 0, keyPoints: [FIRST] }],
          }),
        ),
      ),
    ).toEqual({ status: 'unavailable', reason: 'no-split-steps' });
  });

  it('refuses the same contexts MICRO_START refuses', () => {
    expect(buildTaskRewrite('SIMPLIFY', null)).toEqual({
      status: 'unavailable',
      reason: 'missing-context',
    });
    expect(
      buildTaskRewrite('SIMPLIFY', context(course({ microTasks: [task({ kind: 'quiz' })] }))),
    ).toEqual({ status: 'unavailable', reason: 'unsupported-task-kind' });
  });
});

describe('the rewrite key', () => {
  it('is one key per session, task and action', () => {
    expect(rewriteIdempotencyKey('s1', 't1', 'MICRO_START')).toBe('task-rewrite:MICRO_START:s1:t1');
    expect(rewriteIdempotencyKey('s1', 't1', 'SIMPLIFY')).not.toBe(
      rewriteIdempotencyKey('s1', 't1', 'MICRO_START'),
    );
    expect(rewriteIdempotencyKey('s2', 't1', 'MICRO_START')).not.toBe(
      rewriteIdempotencyKey('s1', 't1', 'MICRO_START'),
    );
  });
});

describe('applying a rewrite to the course the learner sees', () => {
  it('narrows the named task and leaves the course handed in untouched', () => {
    const original = course();
    const narrowed = applyTaskRewrite(original, rewrite());
    expect(narrowed.microTasks[0]).toMatchObject({
      id: 't1',
      instructions: FIRST,
      estimatedMinutes: 2,
    });
    expect(narrowed.microTasks[1]).toEqual(original.microTasks[1]);
    // The task itself never changed: the full instruction and its minutes are still the stored ones.
    expect(original.microTasks[0]?.instructions).toBe('Read the whole section and take notes');
    expect(original.microTasks[0]?.estimatedMinutes).toBe(7);
  });

  it('writes a split plan as one step per line, at the steps own total', () => {
    const narrowed = applyTaskRewrite(course(), {
      ...rewrite(),
      action: 'SIMPLIFY',
      steps: [
        { text: 'first', estimatedMinutes: 2 },
        { text: 'second', estimatedMinutes: 3 },
      ],
      estimatedMinutes: 5,
    });
    expect(narrowed.microTasks[0]?.instructions).toBe('first\n\nsecond');
    expect(narrowed.microTasks[0]?.estimatedMinutes).toBe(5);
  });

  it('returns the same course when the rewrite names a task that is not there', () => {
    const original = course();
    expect(applyTaskRewrite(original, { ...rewrite(), taskId: 'gone' })).toBe(original);
  });
});
