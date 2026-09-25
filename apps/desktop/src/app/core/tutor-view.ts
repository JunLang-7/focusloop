import {
  TUTOR_MODES,
  type MaterialExcerpt,
  type SessionSnapshot,
  type TutorAnswer,
  type TutorMode,
  type TutorPartKind,
} from '@focusloop/shared-types';
import type { MessageKey } from './i18n/messages.en';
import { TUTOR_FALLBACK_KEYS } from './i18n/labels';

export { TUTOR_FALLBACK_KEYS };

/**
 * What the tutor panel shows, as plain data.
 *
 * Here rather than in the component for the reason `stuck-picker.ts` is: this app runs its tests in a
 * `node` environment with no TestBed, so a page's methods are only reachable by launching Electron. The
 * decisions below — which of the six modes is offered, what a reply looks like once it is labelled, what
 * the learner is told when there is no answer, and above all **which parts of the result are worth
 * showing at all** — are the whole of step three's logic, and every one of them is falsifiable here.
 * The component that calls them is covered by the end-to-end suite, where the buttons are really pressed.
 */

/**
 * The modes, in the order they are offered.
 *
 * Straight from the contract's list rather than a second one written here: a seventh mode should appear on
 * the panel because the contract gained it, not because somebody remembered this file.
 */
export const TUTOR_MODE_ORDER: readonly TutorMode[] = TUTOR_MODES;

/**
 * How each mode reads on its button.
 *
 * Namespaced `tutor.mode.*` rather than reusing `agent.action.*`, which is the *policy's* vocabulary: an
 * intervention **action** the agent chose for the learner against a **mode** the learner chose for
 * themselves. Two of the six modes do have a word in common with it (`HINT`, `EXAMPLE`), and two of the
 * eight actions have no counterpart at all (`SIMPLIFY`, `BREAK`), but the decisive point is the other
 * direction: four of the six modes — `EXPLAIN`, `SOCRATIC`, `CHECK_MY_ANSWER`, `SUMMARIZE` — have no
 * `agent.action.*` key to share, so there was never a set to reuse. Sharing the two that overlap would
 * tie the agent's copy to the tutor's for no benefit, and the two have to be free to diverge: the agent's
 * hint is a suggestion about the step, the tutor's is an answer the learner asked for.
 */
export const TUTOR_MODE_KEYS: Record<TutorMode, MessageKey> = {
  EXPLAIN: 'tutor.mode.EXPLAIN',
  HINT: 'tutor.mode.HINT',
  EXAMPLE: 'tutor.mode.EXAMPLE',
  SOCRATIC: 'tutor.mode.SOCRATIC',
  CHECK_MY_ANSWER: 'tutor.mode.CHECK_MY_ANSWER',
  SUMMARIZE: 'tutor.mode.SUMMARIZE',
};

/**
 * How each part of an answer is labelled.
 *
 * Every part gets a heading rather than being run together, because the labels are the answer's structure:
 * a `confirmed` above a `question` is a different thing from an `explanation`, and the learner reading it
 * has to be able to tell which is which. `confirmed` and `missing` are the two that carry the epic's
 * central claim — an answer names what was right and what was left out — so they are worded as statements
 * about the learner rather than as grammar terms.
 */
export const TUTOR_PART_KEYS: Record<TutorPartKind, MessageKey> = {
  explanation: 'tutor.part.explanation',
  hint: 'tutor.part.hint',
  example: 'tutor.part.example',
  question: 'tutor.part.question',
  summary: 'tutor.part.summary',
  confirmed: 'tutor.part.confirmed',
  missing: 'tutor.part.missing',
};

/**
 * The words in the question box, which differ for the one mode that is not asking a question.
 *
 * `CHECK_MY_ANSWER` exists to have the learner's *answer* in front of the tutor — the `confirmed` part has
 * to quote their own words (the contract's `TUTOR_MODE_PARTS` says which parts each mode requires, and
 * this is the only mode that requires a quotation). Asking them to put it in a box labelled "what do you
 * want to ask about this step" is a prompt for the wrong thing, and a learner who types a question there
 * is rejected for having no answer to check. Two keys rather than six: the other five all want a question.
 */
export function tutorPlaceholderKey(mode: TutorMode | null): MessageKey {
  return mode === 'CHECK_MY_ANSWER' ? 'tutor.placeholder.answer' : 'tutor.placeholder';
}

/**
 * Whether a stored answer is still about the step on screen.
 *
 * The answer is cleared when the session ends, and this is the other half of the same rule: an answer about
 * step 3 must not be shown over step 4. The panel is drawn inside the running-task branch, so the *view* is
 * unmounted on a step change and remounted with a fresh open state — but the service holds the signal, so
 * without this the first time the learner opens the panel on the next step they read the previous step's
 * answer. The sibling control was fixed for exactly this and has an end-to-end test for it.
 *
 * The comparison is against the task the ask was made on, not against a timestamp: two steps can share a
 * title, and the id is the thing the transcript and the context are keyed by.
 */
export function tutorAnswerApplies(
  answeredTaskId: string | null,
  currentTaskId: string | null,
): boolean {
  return answeredTaskId !== null && answeredTaskId === currentTaskId;
}

export interface TutorPartView {
  readonly kind: TutorPartKind;
  readonly key: MessageKey;
  readonly text: string;
}

export type TutorView =
  | {
      readonly status: 'answered';
      /**
       * The mode the answer was produced for.
       *
       * Carried because the learner can change the mode after an answer arrives — `choose()` does not clear
       * it — so without this the panel would label a hint as an explanation, or show a hint under a
       * highlighted "Explain it". The reply knows which mode it answered; discarding it was the panel's
       * choice and it was the wrong one.
       */
      readonly mode: TutorMode;
      readonly parts: readonly TutorPartView[];
      /**
       * The section the answer was drawn from, or `null` when it named none.
       *
       * AG3.9: the learner sees where it came from or sees that it came from nowhere in particular. Both
       * states are shown, because an answer with no source and an answer whose source was left off the
       * screen look identical to the person reading it.
       */
      readonly source: MaterialExcerpt | null;
      readonly leftOut: readonly string[];
    }
  | {
      readonly status: 'no-answer';
      /** Localized explanation for the closed domain fallback code. */
      readonly reasonKey: MessageKey;
      readonly excerpt: MaterialExcerpt;
      readonly conceptTitle: string | null;
      readonly taskTitle: string | null;
      readonly instructions: string | null;
      readonly leftOut: readonly string[];
    };

/**
 * Whether the panel is offered at all.
 *
 * Refused on a session that has ended, and that is a decision the main process also makes: `askTutor`
 * throws `EngineError('session-ended')`. **This screen cannot branch on that error**, because
 * `EngineError.code` does not survive the bridge — `ipcMain.handle` serialises the rejection into a plain
 * `Error` and the code is gone. So the rule is enforced on both sides with the renderer's copy being the
 * one that matters for what is shown, and the throw behind it is a backstop for a race rather than
 * something the panel reads.
 *
 * A task is required as well as a session: "ask about this step" needs a step, and with no current task the
 * context the tutor would be given has no title, no instructions and no concept — it would answer about
 * nothing and say so in every sentence.
 */
export function tutorEntryVisible(
  snapshot: SessionSnapshot | null,
  currentTaskId: string | null,
): boolean {
  if (snapshot === null) return false;
  if (snapshot.session.endedAt !== undefined) return false;
  return currentTaskId !== null;
}

/**
 * The line under an answer that says where it came from.
 *
 * Both states are worded, and that is the point of AG3.9 rather than an accident of the implementation: an
 * answer with no section behind it and an answer whose section was not rendered look identical to the
 * person reading it, and only one of them means "this came from nowhere in particular".
 *
 * Takes `t` rather than importing it, so the rule stays pure and testable in a `node` environment with no
 * service container. A source that is non-null has a heading — `resolveSource` returns `undefined` when the
 * excerpt has none, which is a rejection — so the title is only a fallback for a caller that built an
 * excerpt by hand.
 */
export function tutorSourceLine(
  source: MaterialExcerpt | null,
  t: (key: MessageKey) => string,
): string {
  if (source === null) return t('tutor.sourceNone');
  const name = source.heading ?? source.title;
  return name === null ? t('tutor.sourceNone') : `${t('tutor.source')}: ${name}`;
}

/**
 * The result, as the panel renders it.
 *
 * Two things are folded together here and both are deliberate.
 *
 * **`rejected` and `unavailable` become one shape.** Two of the five rejections and all four
 * unavailabilities are states the learner does nothing different about, and both carry the same fallback
 * object — the reason, the excerpt, the step, the instructions. The panel shows one screen for both, so the
 * view has one arm for both.
 *
 * **`leftOut` comes from `context.omitted` on every outcome.** The engine puts the reader's answer-level
 * omissions there as well as the prompt's, on both branches (`engine.ts`: `omitted: [...omissions,
 * ...reply.omissions]` on the answered path, and `[...omissions, ...reading.omissions]` on the rejected
 * one), so one source is complete and the screen does not change meaning depending on which arm of the
 * union it is rendering. `reply.omissions` is still there and still right for a caller that wants only the
 * answer's — it is the subset — but reading both here would show each of them twice.
 */
export function buildTutorView(answer: TutorAnswer): TutorView {
  const leftOut = answer.context.omitted.map((omission) => omission.detail);

  if (answer.outcome.status === 'answered') {
    return {
      status: 'answered',
      mode: answer.outcome.reply.mode,
      parts: answer.outcome.reply.parts.map((part) => ({
        kind: part.kind,
        key: TUTOR_PART_KEYS[part.kind],
        text: part.text,
      })),
      source: answer.outcome.reply.source,
      leftOut,
    };
  }

  const fallback = answer.outcome.fallback;
  return {
    status: 'no-answer',
    reasonKey: TUTOR_FALLBACK_KEYS[fallback.reason],
    excerpt: fallback.excerpt,
    conceptTitle: fallback.conceptTitle,
    taskTitle: fallback.taskTitle,
    instructions: fallback.instructions,
    leftOut,
  };
}
