import { describe, expect, it } from 'vitest';
import type { Course, Quiz } from '@focusloop/shared-types';
import { QUIZ_LIMITS } from '@focusloop/shared-types';
import { gradeQuiz, quizForTask, taskForQuiz } from './quiz';

function quiz(overrides: Partial<Quiz> = {}): Quiz {
  return {
    id: 'q1',
    taskId: 't1',
    conceptId: 'c1',
    question: 'Can a red node have a red child?',
    options: ['Yes, if the tree is small', 'No, never', 'Only in the root position'],
    answerIndex: 1,
    explanation: 'The red-red rule admits no exceptions.',
    ...overrides,
  };
}

function course(quizzes: readonly Quiz[]): Course {
  return {
    id: 'course-1',
    title: 'Trees',
    description: '',
    concepts: [],
    microTasks: [],
    quizzes,
  };
}

describe('quizForTask', () => {
  it('finds the quiz a step asks', () => {
    expect(quizForTask(course([quiz()]), 't1')?.id).toBe('q1');
  });

  it('has nothing for a step that asks none', () => {
    expect(quizForTask(course([quiz()]), 't2')).toBeNull();
    expect(quizForTask(course([]), 't1')).toBeNull();
  });
});

describe('taskForQuiz', () => {
  it('is the step the quiz belongs to', () => {
    expect(taskForQuiz(course([quiz()]), 'q1')).toBe('t1');
  });

  it('is null for a quiz that is not in this course', () => {
    expect(taskForQuiz(course([]), 'q1')).toBeNull();
  });
});

describe('gradeQuiz', () => {
  it('accepts the answer the course states', () => {
    expect(gradeQuiz(quiz(), 1)).toEqual({
      quizId: 'q1',
      correct: true,
      answerIndex: 1,
      explanation: 'The red-red rule admits no exceptions.',
    });
  });

  /*
   * The two halves of "wrong" are separate assertions on purpose: the verdict has to say the learner was
   * wrong *and* where the right option was, because the screen marks that option and a result that only
   * carried `correct: false` would leave the learner staring at the one they picked.
   */
  it('marks the other options wrong and still says which one was right', () => {
    expect(gradeQuiz(quiz(), 0)).toMatchObject({ correct: false, answerIndex: 1 });
    expect(gradeQuiz(quiz(), 2)).toMatchObject({ correct: false, answerIndex: 1 });
  });

  it('refuses a choice that is not one of the options', () => {
    expect(gradeQuiz(quiz(), 3)).toBeNull();
    expect(gradeQuiz(quiz(), -1)).toBeNull();
    expect(gradeQuiz(quiz(), 1.5)).toBeNull();
    expect(gradeQuiz(quiz(), Number.NaN)).toBeNull();
  });

  it('refuses everything when the quiz has no options at all', () => {
    expect(gradeQuiz(quiz({ options: [], answerIndex: 0 }), 0)).toBeNull();
  });

  it('bounds the explanation it hands the screen', () => {
    const long = quiz({ explanation: 'x'.repeat(QUIZ_LIMITS.explanationCharacters + 50) });
    expect(gradeQuiz(long, 1)?.explanation).toHaveLength(QUIZ_LIMITS.explanationCharacters);
  });
});
