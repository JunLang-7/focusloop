import type { Course, InterruptionFixture, MicroTask, Quiz } from '@focusloop/shared-types';

export const DEMO_COURSE_ID = 'course-red-black-trees';
export const DEMO_COURSE_TITLE = 'Red-black trees: the basics';

/**
 * Built-in demo course. Written from scratch for this project so it can be
 * shipped and redistributed without any third-party attribution.
 *
 * Shape: 4 concepts, 5 micro tasks, 2 quizzes, 1 interruption fixture.
 */
export function demoCourse(): Course {
  const concepts = [
    {
      id: 'c-bst',
      title: 'Binary search tree recap',
      summary: 'A BST keeps every left descendant smaller and every right descendant larger.',
      order: 0,
      keyPoints: ['in-order traversal is sorted', 'search cost depends on height'],
    },
    {
      id: 'c-invariants',
      title: 'Red-black invariants',
      summary: 'Five colour and height rules keep a red-black tree balanced.',
      order: 1,
      keyPoints: ['the root is black', 'no red node has a red child', 'equal black height'],
    },
    {
      id: 'c-rotations',
      title: 'Rotations',
      summary: 'A rotation restructures three nodes while preserving in-order order.',
      order: 2,
      keyPoints: ['left rotation moves the pivot down-right', 'rotations are O(1)'],
    },
    {
      id: 'c-fixup',
      title: 'Insertion fix-up',
      summary: 'After inserting a red node, recolour and rotate upward until the tree is valid.',
      order: 3,
      keyPoints: ['recolour when the uncle is red', 'rotate when the uncle is black'],
    },
  ];

  const microTasks: MicroTask[] = [
    {
      id: 'rbt-t1',
      courseId: DEMO_COURSE_ID,
      conceptId: 'c-bst',
      title: 'Recall the ordering invariant',
      instructions:
        'Close your notes and write the ordering invariant of a binary search tree in one sentence.',
      kind: 'read',
      estimatedMinutes: 3,
      order: 0,
    },
    {
      id: 'rbt-t2',
      courseId: DEMO_COURSE_ID,
      conceptId: 'c-invariants',
      title: 'State the five red-black properties',
      instructions:
        'List the five properties from memory. Mark the one you find hardest to recall.',
      kind: 'read',
      estimatedMinutes: 4,
      order: 1,
    },
    {
      id: 'rbt-t3',
      courseId: DEMO_COURSE_ID,
      conceptId: 'c-rotations',
      title: 'Trace a left rotation by hand',
      instructions:
        'Draw a three-node tree, rotate it left, and check that the in-order sequence is unchanged.',
      kind: 'practice',
      estimatedMinutes: 6,
      order: 2,
    },
    {
      id: 'rbt-t4',
      courseId: DEMO_COURSE_ID,
      conceptId: 'c-invariants',
      title: 'Check the colour invariant',
      instructions: 'Decide whether the given tree obeys the red-red rule.',
      kind: 'quiz',
      estimatedMinutes: 4,
      order: 3,
    },
    {
      id: 'rbt-t5',
      courseId: DEMO_COURSE_ID,
      conceptId: 'c-fixup',
      title: 'Fix up one insertion',
      instructions:
        'Insert 7 into a small red-black tree and apply recolour/rotate until it is valid again.',
      kind: 'practice',
      estimatedMinutes: 8,
      order: 4,
    },
  ];

  const quizzes: Quiz[] = [
    {
      id: 'rbt-q1',
      taskId: 'rbt-t4',
      conceptId: 'c-invariants',
      question: 'Can a red node have a red child?',
      options: ['Yes, if the tree is small', 'No, never', 'Only in the root position'],
      answerIndex: 1,
      explanation: 'The red-red rule is one of the five invariants and admits no exceptions.',
    },
    {
      id: 'rbt-q2',
      taskId: 'rbt-t3',
      conceptId: 'c-rotations',
      question: 'What does a rotation preserve?',
      options: ['The in-order sequence', 'The tree height', 'The colour of every node'],
      answerIndex: 0,
      explanation: 'Rotations only restructure; the sorted in-order sequence stays identical.',
    },
  ];

  return {
    id: DEMO_COURSE_ID,
    title: DEMO_COURSE_TITLE,
    description:
      'A five-step walk through balanced trees: invariants, rotations and insertion fix-up.',
    concepts,
    microTasks,
    quizzes,
  };
}

/** Scripted interruption used by the golden-path demo and E2E test. */
export function demoInterruption(): InterruptionFixture {
  return {
    id: 'rbt-int-1',
    courseId: DEMO_COURSE_ID,
    afterTaskId: 'rbt-t1',
    kind: 'distraction',
    durationMs: 30_000,
    description: 'Learner switches to another tab and comes back after 30 seconds.',
  };
}
