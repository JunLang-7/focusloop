import { describe, expect, it } from 'vitest';
import { DEFAULT_COURSE_COPY, demoCourse, generateCourse } from '@focusloop/agent-core';
import type { MaterialDocument } from '@focusloop/shared-types';
import { courseCopyFor } from './course-copy';

/** Any Han character at all: the assertion that a bundle is Chinese and not a copy of the English one. */
const HAN = /[\u4e00-\u9fff]/;

function chineseMaterial(): MaterialDocument {
  const body =
    '模拟调制把基带信号的频谱搬移到较高的载频上，以便在信道中有效辐射并实现多路复用。' +
    '最基本的两种方式是让载波的幅度或频率随基带信号变化。';
  return {
    id: 'material-zh',
    title: '通信原理概论',
    format: 'markdown',
    source: 'imported',
    contentHash: 'b'.repeat(64),
    importedAt: '2026-01-01T00:00:00.000Z',
    warnings: [],
    sections: [{ id: 'sec-1', heading: '模拟调制', body, order: 0, depth: 1 }],
  };
}

describe('courseCopyFor', () => {
  /*
   * The bug this exists for: a Chinese window around an English course — `Practise: 模拟调制`, an
   * instruction the learner never asked to read in another language, and the built-in course entirely in
   * English. The copy is the app's own wording, so it follows the language the learner chose.
   */
  it('writes a generated course in Chinese', () => {
    const { course } = generateCourse(chineseMaterial(), { copy: courseCopyFor('zh').task });

    const task = course.microTasks[0]!;
    expect(task.title).toBe('阅读：模拟调制');
    expect(task.title).toMatch(HAN);
    expect(task.instructions).toMatch(HAN);
    expect(course.description).toBe('由「通信原理概论」生成（markdown）。');
    expect(course.quizzes).toEqual([]);
  });

  it('writes the built-in course in Chinese, id for id', () => {
    const chinese = demoCourse(courseCopyFor('zh').demo);
    const english = demoCourse();

    expect(chinese.title).toBe('红黑树：入门');
    expect(chinese.concepts).toHaveLength(4);
    expect(chinese.microTasks).toHaveLength(5);
    expect(chinese.quizzes).toHaveLength(2);
    expect(chinese.concepts.map((concept) => concept.id)).toEqual(
      english.concepts.map((concept) => concept.id),
    );
    expect(chinese.microTasks.map((task) => task.id)).toEqual(
      english.microTasks.map((task) => task.id),
    );

    for (const concept of chinese.concepts) {
      expect(concept.title).toMatch(HAN);
      expect(concept.summary).toMatch(HAN);
      expect(concept.keyPoints.every((point) => HAN.test(point))).toBe(true);
    }
    for (const task of chinese.microTasks) {
      expect(task.title).toMatch(HAN);
      expect(task.instructions).toMatch(HAN);
    }
    for (const quiz of chinese.quizzes) {
      expect(quiz.question).toMatch(HAN);
      expect(quiz.options).toHaveLength(3);
      expect(quiz.options.every((option) => HAN.test(option))).toBe(true);
      expect(quiz.explanation).toMatch(HAN);
      // The answer has to survive translation: `answerIndex` is the structure's, but a bundle whose
      // options were reordered would make it point at the wrong sentence.
      expect(quiz.answerIndex).toBeGreaterThanOrEqual(0);
      expect(quiz.answerIndex).toBeLessThan(quiz.options.length);
    }
  });

  it('leaves English to the domain default rather than repeating the wording here', () => {
    expect(courseCopyFor('en')).toBe(DEFAULT_COURSE_COPY);
    expect(demoCourse(courseCopyFor('en').demo).title).toBe('Red-black trees: the basics');
  });
});
