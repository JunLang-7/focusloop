/**
 * The wording a generated course and the built-in course are written in.
 *
 * Neither is the learner's material and neither can be left to the model: the sentences below are
 * the app's own, so they are the app's to translate. The domain stays out of the decision —
 * `generateCourse` and `demoCourse` take the wording as an argument — which keeps the rule that a
 * domain package emits structure and never sentences it invented. The bundles themselves live with
 * the interface that speaks the learner's language, in the shell.
 *
 * The defaults are the English wording the app had before it was configurable, so a caller that
 * passes nothing gets exactly what it used to.
 */

/** The chrome around material the app generated itself: a course built from an imported document. */
export interface TaskCopy {
  readonly readTitle: (heading: string) => string;
  readonly readInstructions: (sentence: string) => string;
  readonly practiseTitle: (heading: string) => string;
  readonly practiseInstructions: (heading: string) => string;
  readonly quizQuestion: (conceptTitle: string) => string;
  readonly courseDescription: (title: string, format: string) => string;
  readonly emptyWarning: string;
  readonly truncationWarning: (maxConcepts: number) => string;
}

/** One concept of the built-in course, in the learner's language. */
export interface DemoConceptCopy {
  readonly title: string;
  readonly summary: string;
  readonly keyPoints: readonly string[];
}

/** One micro task of the built-in course, in the learner's language. */
export interface DemoTaskCopy {
  readonly title: string;
  readonly instructions: string;
}

/** One quiz of the built-in course, in the learner's language. */
export interface DemoQuizCopy {
  readonly question: string;
  readonly options: readonly string[];
  readonly explanation: string;
}

/**
 * The built-in course, in the learner's language.
 *
 * Index-aligned with the structure in `demo-course.ts` rather than keyed by id: the arrays are fixed
 * data, and a spec asserts the lengths agree, which is what stops a translation from silently
 * shifting a task's title onto its neighbour.
 */
export interface DemoCopy {
  readonly title: string;
  readonly description: string;
  readonly concepts: readonly DemoConceptCopy[];
  readonly tasks: readonly DemoTaskCopy[];
  readonly quizzes: readonly DemoQuizCopy[];
  readonly interruption: string;
}

/** The wording a language bundle supplies, resolved by locale. */
export interface CourseCopy {
  readonly task: TaskCopy;
  readonly demo: DemoCopy;
}

export const DEFAULT_TASK_COPY: TaskCopy = {
  readTitle: (heading) => `Read: ${heading}`,
  readInstructions: (sentence) =>
    `Read this section and summarise it in one sentence: "${sentence}"`,
  practiseTitle: (heading) => `Practise: ${heading}`,
  practiseInstructions: (heading) =>
    `Explain "${heading}" using a concrete example you invent yourself.`,
  quizQuestion: (conceptTitle) => `Which statement belongs to "${conceptTitle}"?`,
  courseDescription: (title, format) => `Generated from ${title} (${format}).`,
  emptyWarning: 'No readable sections were found, so no micro tasks were generated.',
  truncationWarning: (maxConcepts) =>
    `Only the first ${maxConcepts} sections were used; the rest stays in the material.`,
};

export const DEFAULT_DEMO_COPY: DemoCopy = {
  title: 'Red-black trees: the basics',
  description:
    'A five-step walk through balanced trees: invariants, rotations and insertion fix-up.',
  concepts: [
    {
      title: 'Binary search tree recap',
      summary: 'A BST keeps every left descendant smaller and every right descendant larger.',
      keyPoints: ['in-order traversal is sorted', 'search cost depends on height'],
    },
    {
      title: 'Red-black invariants',
      summary: 'Five colour and height rules keep a red-black tree balanced.',
      keyPoints: ['the root is black', 'no red node has a red child', 'equal black height'],
    },
    {
      title: 'Rotations',
      summary: 'A rotation restructures three nodes while preserving in-order order.',
      keyPoints: ['left rotation moves the pivot down-right', 'rotations are O(1)'],
    },
    {
      title: 'Insertion fix-up',
      summary: 'After inserting a red node, recolour and rotate upward until the tree is valid.',
      keyPoints: ['recolour when the uncle is red', 'rotate when the uncle is black'],
    },
  ],
  tasks: [
    {
      title: 'Recall the ordering invariant',
      instructions:
        'Close your notes and write the ordering invariant of a binary search tree in one sentence.',
    },
    {
      title: 'State the five red-black properties',
      instructions:
        'List the five properties from memory. Mark the one you find hardest to recall.',
    },
    {
      title: 'Trace a left rotation by hand',
      instructions:
        'Draw a three-node tree, rotate it left, and check that the in-order sequence is unchanged.',
    },
    {
      title: 'Check the colour invariant',
      instructions: 'Decide whether the given tree obeys the red-red rule.',
    },
    {
      title: 'Fix up one insertion',
      instructions:
        'Insert 7 into a small red-black tree and apply recolour/rotate until it is valid again.',
    },
  ],
  quizzes: [
    {
      question: 'Can a red node have a red child?',
      options: ['Yes, if the tree is small', 'No, never', 'Only in the root position'],
      explanation: 'The red-red rule is one of the five invariants and admits no exceptions.',
    },
    {
      question: 'What does a rotation preserve?',
      options: ['The in-order sequence', 'The tree height', 'The colour of every node'],
      explanation: 'Rotations only restructure; the sorted in-order sequence stays identical.',
    },
  ],
  interruption: 'Learner switches to another tab and comes back after 30 seconds.',
};

/** What a caller that names no language gets: the English wording, unchanged. */
export const DEFAULT_COURSE_COPY: CourseCopy = {
  task: DEFAULT_TASK_COPY,
  demo: DEFAULT_DEMO_COPY,
};
