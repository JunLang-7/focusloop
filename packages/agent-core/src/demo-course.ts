import type { Course, InterruptionFixture, MicroTask, Quiz } from '@focusloop/shared-types';
import { DEFAULT_DEMO_COPY, type DemoCopy } from './course-copy';

export const DEMO_COURSE_ID = 'course-red-black-trees';

/** The title in the default language. The copy in force carries what is actually displayed. */
export const DEMO_COURSE_TITLE = DEFAULT_DEMO_COPY.title;

/** Ids and shape, in the order the copy's arrays are written in. */
const CONCEPT_IDS = ['c-bst', 'c-invariants', 'c-rotations', 'c-fixup'] as const;

const TASK_ROWS = [
  { id: 'rbt-t1', conceptId: 'c-bst', kind: 'read', estimatedMinutes: 3 },
  { id: 'rbt-t2', conceptId: 'c-invariants', kind: 'read', estimatedMinutes: 4 },
  { id: 'rbt-t3', conceptId: 'c-rotations', kind: 'practice', estimatedMinutes: 6 },
  { id: 'rbt-t4', conceptId: 'c-invariants', kind: 'quiz', estimatedMinutes: 4 },
  { id: 'rbt-t5', conceptId: 'c-fixup', kind: 'practice', estimatedMinutes: 8 },
] as const;

const QUIZ_ROWS = [
  { id: 'rbt-q1', taskId: 'rbt-t4', conceptId: 'c-invariants', answerIndex: 1 },
  { id: 'rbt-q2', taskId: 'rbt-t3', conceptId: 'c-rotations', answerIndex: 0 },
] as const;

/**
 * Built-in demo course. Written from scratch for this project so it can be
 * shipped and redistributed without any third-party attribution.
 *
 * Shape: 4 concepts, 5 micro tasks, 2 quizzes, 1 interruption fixture.
 *
 * Every word of it is the app's own, so it is written in whatever language the copy carries; the ids
 * and the shape below are language-free and stay here. `course-copy.spec.ts` holds the two together,
 * because a translation that lost a task would otherwise shift every later title by one.
 */
export function demoCourse(copy: DemoCopy = DEFAULT_DEMO_COPY): Course {
  const concepts = CONCEPT_IDS.map((id, index) => {
    const text = copy.concepts[index]!;
    return {
      id,
      title: text.title,
      summary: text.summary,
      order: index,
      keyPoints: [...text.keyPoints],
    };
  });

  const microTasks: MicroTask[] = TASK_ROWS.map((row, index) => ({
    id: row.id,
    courseId: DEMO_COURSE_ID,
    conceptId: row.conceptId,
    title: copy.tasks[index]!.title,
    instructions: copy.tasks[index]!.instructions,
    kind: row.kind,
    estimatedMinutes: row.estimatedMinutes,
    order: index,
  }));

  const quizzes: Quiz[] = QUIZ_ROWS.map((row, index) => {
    const text = copy.quizzes[index]!;
    return {
      id: row.id,
      taskId: row.taskId,
      conceptId: row.conceptId,
      question: text.question,
      options: [...text.options],
      answerIndex: row.answerIndex,
      explanation: text.explanation,
    };
  });

  return {
    id: DEMO_COURSE_ID,
    title: copy.title,
    description: copy.description,
    concepts,
    microTasks,
    quizzes,
  };
}

/** Scripted interruption used by the golden-path demo and E2E test. */
export function demoInterruption(copy: DemoCopy = DEFAULT_DEMO_COPY): InterruptionFixture {
  return {
    id: 'rbt-int-1',
    courseId: DEMO_COURSE_ID,
    afterTaskId: 'rbt-t1',
    kind: 'distraction',
    durationMs: 30_000,
    description: copy.interruption,
  };
}
