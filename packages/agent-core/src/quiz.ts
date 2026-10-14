import type { Course, Quiz, QuizAnswerResult } from '@focusloop/shared-types';
import { QUIZ_LIMITS } from '@focusloop/shared-types';

/**
 * Answering the quiz a step asks, and what the verdict is.
 *
 * Pure and here rather than in the engine, for the reason every other rule in this package is: the
 * interesting cases — the choice that is not an option, the option that is the answer, the explanation
 * that is longer than the budget — are all falsifiable without a database or a window.
 *
 * What is deliberately *not* here is any notion of trying again, or of a score. The product asks one
 * question at a time and the answer to it is right or wrong; a running total would turn a micro task
 * into a test, which is the thing this app exists to not be.
 */

/** The quiz a step asks, if it asks one. The row, not the view: grading needs the answer. */
export function quizForTask(course: Course, taskId: string): Quiz | null {
  return course.quizzes.find((quiz) => quiz.taskId === taskId) ?? null;
}

/** The task a quiz belongs to, read the other way round — the engine's side of `quizForTask`. */
export function taskForQuiz(course: Course, quizId: string): string | null {
  return course.quizzes.find((quiz) => quiz.id === quizId)?.taskId ?? null;
}

/**
 * The verdict for a choice, or `null` when the choice is not one of the options.
 *
 * `null` rather than an "incorrect" verdict on purpose. A choice that is out of range did not come from
 * the screen — the screen only draws the options it was given — and answering it "incorrect" would put a
 * wrong answer in the learner's record for a question they were never asked. The caller refuses.
 */
export function gradeQuiz(quiz: Quiz, choiceIndex: number): QuizAnswerResult | null {
  if (!Number.isInteger(choiceIndex) || choiceIndex < 0 || choiceIndex >= quiz.options.length) {
    return null;
  }
  return {
    quizId: quiz.id,
    correct: choiceIndex === quiz.answerIndex,
    answerIndex: quiz.answerIndex,
    explanation: bound(quiz.explanation, QUIZ_LIMITS.explanationCharacters),
  };
}

/**
 * One bound, in one place, for the prose a verdict carries.
 *
 * The generator writes these strings, so in practice none of them is near the limit. The limit is here
 * because a course can also be *imported*, and the screen renders what this returns without measuring
 * it — a question that was ten thousand characters long would be a wall of text in a panel sized for a
 * sentence.
 */
function bound(value: string, characters: number): string {
  return value.length > characters ? value.slice(0, characters) : value;
}
