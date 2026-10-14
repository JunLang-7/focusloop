import type { Course } from './course';

/**
 * Answering a step, and being told whether the answer was right.
 *
 * The product's premise is that the learner produces something and the agent knows what it was. Until
 * this existed the only thing a completion carried was a task id: the checkpoint's "mastered" list was
 * derived from which rows had been marked done, the quiz events the state machine listens for had no
 * producer in the app at all, and nothing the learner wrote ever reached a model. This is the shape of
 * the missing half — what a quiz looks like on screen, what answering one is, and how long the
 * learner's own words may be.
 *
 * The key lives on the domain side only. `QuizView` is what the screen is given, and it deliberately
 * cannot say which option is right: grading happens in the main process, where the course row is, so a
 * renderer cannot grade itself into a right answer.
 */

/** A quiz as the screen sees it: the question and the choices, without the answer. */
export interface QuizView {
  readonly quizId: string;
  readonly question: string;
  readonly options: readonly string[];
}

/**
 * How long the learner's own words may be, wherever they are written down.
 *
 * One bound for the whole journey — the input, the event payload, the database row, the model's
 * context — because a limit that only exists at one of those is a limit the other three can pass. It
 * is generous: the longest thing the product ever asks for is a paragraph, and a learner who pastes an
 * essay into the box is better served by the text being cut than by the journal becoming a document
 * store.
 */
export const LEARNER_ANSWER_CHARACTERS = 2000;

/**
 * The learner's words, as they will be stored and shown.
 *
 * Trimmed, and an all-whitespace answer is `null` rather than `''`: "they wrote nothing" and "they
 * wrote spaces" are the same fact, and a model shown an empty string would read it as an answer that
 * happened to be blank. Cut at the bound rather than rejected — the alternative is losing the first
 * two thousand characters because the two thousand and first was pasted.
 */
export function normaliseLearnerAnswer(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed === '') return null;
  return trimmed.length > LEARNER_ANSWER_CHARACTERS
    ? trimmed.slice(0, LEARNER_ANSWER_CHARACTERS)
    : trimmed;
}

/** What the screen asks the main process to do with a chosen option. */
export interface QuizAnswerRequest {
  readonly sessionId: string;
  readonly taskId: string;
  /**
   * Which option the learner picked, counted from zero.
   *
   * An index rather than the option's text: the text is the screen's to render and the course's to
   * hold, and comparing strings would make a stray double space a wrong answer.
   */
  readonly choiceIndex: number;
}

/** The verdict, and what to say about it. */
export interface QuizAnswerResult {
  readonly quizId: string;
  readonly correct: boolean;
  /**
   * Where the right answer was.
   *
   * Disclosed only once the learner has answered — the choice has been made, so hiding the key now
   * would leave them with "wrong" and no way to see why. It is also what lets the screen mark the
   * option they should have picked instead of describing it in words.
   */
  readonly answerIndex: number;
  readonly explanation: string;
}

/** Bounds on the quizzes the product will render, enforced where a course is read. */
export const QUIZ_LIMITS = {
  /** More options than this is a test, not a micro task. */
  options: 8,
  questionCharacters: 400,
  optionCharacters: 200,
  explanationCharacters: 600,
} as const;

/**
 * The quiz attached to a task, as the screen may see it.
 *
 * Here rather than in the renderer because two callers need the same answer and must not drift: the
 * engine, which grades against the row, and the screen, which draws it. A course with several quizzes
 * on one task is not a shape the generator produces; the first is the one that counts.
 */
export function quizViewFor(course: Course, taskId: string): QuizView | null {
  const quiz = course.quizzes.find((candidate) => candidate.taskId === taskId);
  if (quiz === undefined) return null;
  return { quizId: quiz.id, question: quiz.question, options: [...quiz.options] };
}
