import { describe, expect, it } from 'vitest';
import type { MaterialDocument } from '@focusloop/shared-types';
import { DEFAULT_DEMO_COPY, DEFAULT_TASK_COPY, type DemoCopy, type TaskCopy } from './course-copy';
import { demoCourse, demoInterruption } from './demo-course';
import { generateCourse } from './micro-task-generator';

/** A stand-in for a translated bundle: the words are obviously not the default's. */
const OTHER_TASK_COPY: TaskCopy = {
  readTitle: (heading) => `[read] ${heading}`,
  readInstructions: (sentence) => `[summarise] ${sentence}`,
  practiseTitle: (heading) => `[practise] ${heading}`,
  practiseInstructions: (heading) => `[explain] ${heading}`,
  quizQuestion: (conceptTitle) => `[which] ${conceptTitle}`,
  courseDescription: (title, format) => `[generated] ${title} ${format}`,
  emptyWarning: '[nothing to read]',
  truncationWarning: (maxConcepts) => `[first ${maxConcepts} only]`,
};

const OTHER_DEMO_COPY: DemoCopy = {
  title: '[course]',
  description: '[description]',
  concepts: [
    { title: '[concept 1]', summary: '[summary 1]', keyPoints: ['[point 1]'] },
    { title: '[concept 2]', summary: '[summary 2]', keyPoints: [] },
    { title: '[concept 3]', summary: '[summary 3]', keyPoints: ['[point 3a]', '[point 3b]'] },
    { title: '[concept 4]', summary: '[summary 4]', keyPoints: [] },
  ],
  tasks: [
    { title: '[task 1]', instructions: '[do 1]' },
    { title: '[task 2]', instructions: '[do 2]' },
    { title: '[task 3]', instructions: '[do 3]' },
    { title: '[task 4]', instructions: '[do 4]' },
    { title: '[task 5]', instructions: '[do 5]' },
  ],
  quizzes: [
    { question: '[q1]', options: ['[a]', '[b]', '[c]'], explanation: '[why 1]' },
    { question: '[q2]', options: ['[a]', '[b]', '[c]'], explanation: '[why 2]' },
  ],
  interruption: '[interruption]',
};

function material(): MaterialDocument {
  return {
    id: 'material-1',
    title: 'Imported notes',
    format: 'markdown',
    source: 'imported',
    contentHash: 'a'.repeat(64),
    importedAt: '2026-01-01T00:00:00.000Z',
    warnings: [],
    sections: [
      {
        id: 'sec-1',
        heading: 'Sorting basics',
        body: 'Sorting puts elements in order. '.repeat(8),
        order: 0,
        depth: 1,
      },
      {
        id: 'sec-2',
        heading: 'Merge sort',
        body: 'Merge sort splits then merges. '.repeat(8),
        order: 1,
        depth: 2,
      },
      {
        id: 'sec-3',
        heading: 'Quick sort',
        body: 'Quick sort partitions around a pivot. '.repeat(8),
        order: 2,
        depth: 2,
      },
      {
        id: 'sec-4',
        heading: 'Heap sort',
        body: 'Heap sort keeps a heap and pops it. '.repeat(8),
        order: 3,
        depth: 2,
      },
    ],
  };
}

describe('the default copy', () => {
  /*
   * The wording the app shipped before any of it was configurable. Every existing spec asserts against
   * these sentences, so this is the test that says the default did not move — a translation added later
   * must not be a translation of something else.
   */
  it('is the English wording the generator used to hard-code', () => {
    expect(DEFAULT_TASK_COPY.readTitle('Sorting')).toBe('Read: Sorting');
    expect(DEFAULT_TASK_COPY.readInstructions('It sorts.')).toBe(
      'Read this section and summarise it in one sentence: "It sorts."',
    );
    expect(DEFAULT_TASK_COPY.practiseTitle('Sorting')).toBe('Practise: Sorting');
    expect(DEFAULT_TASK_COPY.practiseInstructions('Sorting')).toBe(
      'Explain "Sorting" using a concrete example you invent yourself.',
    );
    expect(DEFAULT_TASK_COPY.quizQuestion('Sorting')).toBe('Which statement belongs to "Sorting"?');
    expect(DEFAULT_TASK_COPY.courseDescription('Notes', 'markdown')).toBe(
      'Generated from Notes (markdown).',
    );
    expect(DEFAULT_TASK_COPY.truncationWarning(2)).toBe(
      'Only the first 2 sections were used; the rest stays in the material.',
    );
  });

  it('has exactly as many demo rows as the demo course has slots', () => {
    /*
     * The copy is aligned by index rather than keyed, so this is the assertion that keeps a bundle from
     * shifting every title onto its neighbour — or from being one task short and leaving the last one.
     */
    const course = demoCourse(DEFAULT_DEMO_COPY);
    expect(DEFAULT_DEMO_COPY.concepts).toHaveLength(course.concepts.length);
    expect(DEFAULT_DEMO_COPY.tasks).toHaveLength(course.microTasks.length);
    expect(DEFAULT_DEMO_COPY.quizzes).toHaveLength(course.quizzes.length);
  });

  it('gives every demo quiz the three options the quiz screen expects', () => {
    for (const quiz of DEFAULT_DEMO_COPY.quizzes) {
      expect(quiz.options).toHaveLength(3);
    }
  });
});

describe('a copy that is not the default', () => {
  it('does not move a single id in the built-in course', () => {
    const english = demoCourse();
    const other = demoCourse(OTHER_DEMO_COPY);

    expect(other.concepts.map((concept) => concept.id)).toEqual(
      english.concepts.map((concept) => concept.id),
    );
    expect(other.microTasks.map((task) => task.id)).toEqual(
      english.microTasks.map((task) => task.id),
    );
    expect(other.quizzes.map((quiz) => quiz.id)).toEqual(english.quizzes.map((quiz) => quiz.id));
    expect(other.microTasks.map((task) => task.conceptId)).toEqual(
      english.microTasks.map((task) => task.conceptId),
    );
  });

  it('replaces every word of the built-in course', () => {
    const course = demoCourse(OTHER_DEMO_COPY);

    expect(course.title).toBe('[course]');
    expect(course.description).toBe('[description]');
    expect(course.concepts[0]!.title).toBe('[concept 1]');
    expect(course.microTasks[4]!.instructions).toBe('[do 5]');
    expect(course.quizzes[1]!.question).toBe('[q2]');
    expect(course.quizzes[1]!.explanation).toBe('[why 2]');
    expect(demoInterruption(OTHER_DEMO_COPY).description).toBe('[interruption]');
  });

  it('writes a generated course in that copy', () => {
    const { course, warnings } = generateCourse(material(), {
      copy: OTHER_TASK_COPY,
      maxConcepts: 3,
    });

    expect(course.microTasks[0]!.title).toBe('[read] Sorting basics');
    expect(course.microTasks[1]!.title).toBe('[practise] Sorting basics');
    expect(course.microTasks[1]!.instructions).toBe('[explain] Sorting basics');
    expect(course.quizzes[0]!.question).toBe('[which] Sorting basics');
    expect(course.description).toBe('[generated] Imported notes markdown');
    expect(warnings).toEqual(['[first 3 only]']);
  });

  it('writes the warning for material with nothing to read in that copy', () => {
    const empty: MaterialDocument = { ...material(), sections: [] };
    expect(generateCourse(empty, { copy: OTHER_TASK_COPY }).warnings).toEqual([
      '[nothing to read]',
    ]);
  });
});
