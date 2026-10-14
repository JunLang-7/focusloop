import {
  LEARNER_ANSWER_CHARACTERS,
  quizViewFor,
  type AnswerSourceRefusalReason,
  type AnswerSourceResponse,
  type Course,
  type MicroTask,
  type MicroTaskKind,
  type QuizAnswerResult,
  type QuizView,
} from '@focusloop/shared-types';
import type { MessageKey } from './i18n/messages.en';

/**
 * What a running step asks the learner to produce, and when their answer can be sent.
 *
 * The step used to ask for nothing: `完成任务` recorded a task id and the learner moved on, which is
 * how the checkpoint's "mastered" list and everything an agent could see about the session ended up
 * resting on a click. This is the missing half — the box, the options, and the two rules about when
 * what the learner wrote may leave the screen.
 *
 * Pure data and three predicates, here rather than in the page for the reason the tutor's view is:
 * this app's tests run without a window, so a decision that lives in a template is a decision nothing
 * checks. The page below is markup and clicks; every "may they send this" is falsifiable here.
 */

/** The answer box and, for a quiz step, the question it replaces. */
export interface StepAnswerView {
  /**
   * The quiz this step asks, when it asks one.
   *
   * Non-null only for a `quiz` task with a quiz row: the demo course attaches a quiz to a practice step
   * as well, and offering that one would ask a question the step's own instructions never mention. When
   * a quiz step has no row — an imported course whose sections were too short to make one — the step
   * falls back to the box like any other, rather than showing an empty quiz.
   */
  readonly quiz: QuizView | null;
  /** What the box asks for, which depends on what kind of step this is. */
  readonly placeholderKey: MessageKey;
  readonly maxCharacters: number;
}

const PLACEHOLDER_KEYS: Record<MicroTaskKind, MessageKey> = {
  read: 'focus.answer.placeholder.read',
  practice: 'focus.answer.placeholder.practice',
  quiz: 'focus.answer.placeholder.quiz',
};

export function stepAnswerView(
  course: Course | null,
  task: MicroTask | null,
): StepAnswerView | null {
  if (task === null) return null;
  return {
    quiz: task.kind === 'quiz' && course !== null ? quizViewFor(course, task.id) : null,
    placeholderKey: PLACEHOLDER_KEYS[task.kind],
    maxCharacters: LEARNER_ANSWER_CHARACTERS,
  };
}

/**
 * Whether the answer may go to the tutor.
 *
 * Empty is not "nothing to check", it is a question with no subject: `CHECK_MY_ANSWER` has to quote the
 * learner's own words back at them, and there is nothing to quote. The engine would refuse it and the
 * panel would render that refusal, which is a worse way to say "write something first".
 */
export function canCheckAnswer(answer: string): boolean {
  return answer.trim() !== '';
}

/** Whether a choice may be submitted: something must actually be chosen. */
export function canCheckQuiz(choiceIndex: number | null): boolean {
  return choiceIndex !== null && Number.isInteger(choiceIndex) && choiceIndex >= 0;
}

/**
 * Whether the answer is past the bound the record keeps.
 *
 * The input carries `maxlength`, so this is the second line rather than the first — and it exists
 * because `maxlength` is not a contract: a paste into a field that was already at the limit, or a
 * value set by anything other than typing, goes through it. Sending an over-long answer would be
 * refused by the IPC boundary, which means the learner's own paragraph would vanish silently.
 */
export function answerTooLong(answer: string, maxCharacters: number): boolean {
  return answer.length > maxCharacters;
}

/** How a verdict reads, as the key the page translates. */
export function quizVerdictKey(correct: boolean): MessageKey {
  return correct ? 'focus.quiz.correct' : 'focus.quiz.incorrect';
}

/**
 * Which mark an option carries once there is a verdict: the one that was right, or the one chosen.
 *
 * The two are separate marks because the learner's own choice has to stay visible when it was the wrong
 * one — and the correct option is marked *whether or not they picked it*, which is the difference
 * between a correction and a confirmation: "Not this one. The right answer is marked." is a sentence the
 * screen has to have made true.
 *
 * Both surfaces that ask a question share this, because two implementations of "which mark" is one more
 * than can be kept in step — and the copy is shared too, so the sentence and the marks have to agree.
 */
export function quizOptionMark(
  result: QuizAnswerResult | null,
  chosen: number | null,
  index: number,
): 'right' | 'wrong' | 'none' {
  if (result === null) return 'none';
  if (index === result.answerIndex) return 'right';
  return index === chosen ? 'wrong' : 'none';
}

/**
 * What an attached file becomes in the box.
 *
 * Appended rather than replacing, on its own line, because the learner's own sentence is the thing they
 * wrote and a file is something they brought: the two are both about this step, and silently discarding
 * one of them to make room for the other would be the app deciding which of their work matters. Anything
 * that does not fit is left out here — the box cannot hold it, and the caller has already been told the
 * text was cut (`truncated`).
 */
export function insertAnswerText(current: string, text: string, limit: number): string {
  const existing = current.trim();
  const room = limit - existing.length - (existing === '' ? 0 : 1);
  const addition = text.trim();
  if (room <= 0 || addition === '') return current;
  const inserted = addition.slice(0, room);
  return existing === '' ? inserted : `${existing}\n${inserted}`;
}

/**
 * What to say about an attachment, as a key and the file it names.
 *
 * `null` for a cancelled dialog: the learner pressed Cancel, which is not news. A refusal and a
 * mis-recognition are news, and they are different sentences — OCR is the one that gets the words wrong,
 * so the line that says the text came from a picture also says to check it.
 */
export function answerSourceNote(
  response: AnswerSourceResponse,
): { readonly key: MessageKey; readonly params: { readonly name: string } } | null {
  if (response.refusal !== null) {
    return { key: REFUSAL_KEYS[response.refusal.reason], params: { name: response.refusal.name } };
  }
  const source = response.source;
  if (source === null) return null;
  const key: MessageKey = source.truncated
    ? 'focus.answer.source.cut'
    : source.method === 'ocr'
      ? 'focus.answer.source.ocr'
      : 'focus.answer.source.read';
  return { key, params: { name: source.name } };
}

const REFUSAL_KEYS: Record<AnswerSourceRefusalReason, MessageKey> = {
  unsupported: 'focus.answer.source.unsupported',
  'too-big': 'focus.answer.source.tooBig',
  unreadable: 'focus.answer.source.unreadable',
  'no-text': 'focus.answer.source.empty',
};
