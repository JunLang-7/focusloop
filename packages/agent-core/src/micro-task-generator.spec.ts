import { describe, expect, it } from 'vitest';
import type { MaterialDocument } from '@focusloop/shared-types';
import { generateCourse, generateMicroTasks, generatedCourseId } from './micro-task-generator';

function material(overrides: Partial<MaterialDocument> = {}): MaterialDocument {
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
    ],
    ...overrides,
  };
}

describe('generateCourse', () => {
  it('creates one concept per readable section', () => {
    const { course } = generateCourse(material());
    expect(course.concepts.map((concept) => concept.title)).toEqual([
      'Sorting basics',
      'Merge sort',
      'Quick sort',
    ]);
  });

  it('creates a read task for every concept', () => {
    const { course } = generateCourse(material());
    for (const concept of course.concepts) {
      expect(
        course.microTasks.some((task) => task.conceptId === concept.id && task.kind === 'read'),
      ).toBe(true);
    }
  });

  it('adds a practice task for substantial sections', () => {
    const { course } = generateCourse(material());
    expect(course.microTasks.filter((task) => task.kind === 'practice').length).toBeGreaterThan(0);
  });

  it('skips practice tasks for very short sections', () => {
    const thin = material({
      sections: [
        { id: 's1', heading: 'A', body: 'Short.', order: 0, depth: 1 },
        { id: 's2', heading: 'B', body: 'Also short.', order: 1, depth: 1 },
      ],
    });
    const { course } = generateCourse(thin);
    expect(course.microTasks.every((task) => task.kind === 'read')).toBe(true);
  });

  it('numbers tasks sequentially from zero', () => {
    const { course } = generateCourse(material());
    expect(course.microTasks.map((task) => task.order)).toEqual(
      course.microTasks.map((_, index) => index),
    );
  });

  it('gives every task a unique id prefixed by the course id', () => {
    const { course } = generateCourse(material());
    const ids = course.microTasks.map((task) => task.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => id.startsWith(course.id))).toBe(true);
  });

  it('generates quizzes whose answer index points at the correct concept summary', () => {
    const { course } = generateCourse(material());
    expect(course.quizzes.length).toBeGreaterThan(0);
    for (const quiz of course.quizzes) {
      const concept = course.concepts.find((item) => item.id === quiz.conceptId);
      expect(concept).toBeDefined();
      expect(quiz.options[quiz.answerIndex]).toBe(concept?.summary);
      expect(quiz.options.length).toBeGreaterThanOrEqual(3);
    }
  });

  it('attaches each quiz to a real task', () => {
    const { course } = generateCourse(material());
    for (const quiz of course.quizzes) {
      expect(course.microTasks.some((task) => task.id === quiz.taskId)).toBe(true);
    }
  });

  it('is deterministic — the same material produces the same course', () => {
    expect(generateCourse(material())).toEqual(generateCourse(material()));
  });

  it('derives the course id from the content hash', () => {
    const { course } = generateCourse(material());
    expect(course.id).toBe(generatedCourseId(material()));
    expect(course.id.startsWith('course-')).toBe(true);
  });

  it('honours an explicit course id', () => {
    const { course } = generateCourse(material(), { courseId: 'course-custom' });
    expect(course.id).toBe('course-custom');
    expect(course.microTasks[0]?.id.startsWith('course-custom')).toBe(true);
  });

  it('limits the number of concepts and warns', () => {
    const { course, warnings } = generateCourse(material(), { maxConcepts: 2 });
    expect(course.concepts).toHaveLength(2);
    expect(warnings.join(' ')).toContain('first 2 sections');
  });

  it('warns when there is nothing to generate', () => {
    const empty = material({ sections: [] });
    const { course, warnings } = generateCourse(empty);
    expect(course.microTasks).toEqual([]);
    expect(warnings.join(' ')).toContain('No readable sections');
  });

  it('ignores sections with empty bodies', () => {
    const withEmpty = material({
      sections: [
        { id: 's1', heading: 'Real', body: 'Some body text here.', order: 0, depth: 1 },
        { id: 's2', heading: 'Empty', body: '   ', order: 1, depth: 1 },
      ],
    });
    const { course } = generateCourse(withEmpty);
    expect(course.concepts.map((concept) => concept.title)).toEqual(['Real']);
  });

  it('keeps concept ids unique when headings collide', () => {
    const duplicate = material({
      sections: [
        { id: 's1', heading: 'Same', body: 'First body.', order: 0, depth: 1 },
        { id: 's2', heading: 'Same', body: 'Second body.', order: 1, depth: 1 },
      ],
    });
    const ids = generateCourse(duplicate).course.concepts.map((concept) => concept.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('produces no quiz when there are too few concepts to build distractors', () => {
    const single = material({
      sections: [{ id: 's1', heading: 'Only', body: 'Body text.', order: 0, depth: 1 }],
    });
    expect(generateCourse(single).course.quizzes).toEqual([]);
  });
});

describe('generateMicroTasks', () => {
  it('returns the tasks of the generated course', () => {
    expect(generateMicroTasks(material())).toEqual(generateCourse(material()).course.microTasks);
  });
});
