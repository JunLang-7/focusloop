import type { Course, LearningSession } from '@focusloop/shared-types';

/** Two concepts, three tasks: c1 -> [t1, t2], c2 -> [t3]. */
export function tinyCourse(): Course {
  return {
    id: 'course-tiny',
    title: 'Tiny course',
    description: 'Fixture',
    concepts: [
      { id: 'c1', title: 'Concept one', summary: 'First idea', order: 0, keyPoints: ['a'] },
      { id: 'c2', title: 'Concept two', summary: 'Second idea', order: 1, keyPoints: ['b'] },
    ],
    microTasks: [
      {
        id: 't1',
        courseId: 'course-tiny',
        conceptId: 'c1',
        title: 'Read one',
        instructions: 'Read it',
        kind: 'read',
        estimatedMinutes: 3,
        order: 0,
      },
      {
        id: 't2',
        courseId: 'course-tiny',
        conceptId: 'c1',
        title: 'Practise one',
        instructions: 'Do it',
        kind: 'practice',
        estimatedMinutes: 6,
        order: 1,
      },
      {
        id: 't3',
        courseId: 'course-tiny',
        conceptId: 'c2',
        title: 'Quiz two',
        instructions: 'Answer it',
        kind: 'quiz',
        estimatedMinutes: 4,
        order: 2,
      },
    ],
    quizzes: [
      {
        id: 'q1',
        taskId: 't3',
        conceptId: 'c2',
        question: '?',
        options: ['yes', 'no'],
        answerIndex: 0,
        explanation: 'because',
      },
    ],
  };
}

export function tinySession(overrides: Partial<LearningSession> = {}): LearningSession {
  return {
    id: 'session-tiny',
    courseId: 'course-tiny',
    startedAt: '2026-01-01T00:00:00.000Z',
    state: 'FOCUSED',
    completedTaskIds: [],
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}
