import {
  TUTOR_LIMITS,
  type AgentContext,
  type AgentContextOmission,
  type MaterialExcerpt,
  type ProviderFailure,
  type TutorContextReport,
  type TutorFallback,
  type TutorFallbackReason,
  type TutorPart,
  type TutorProviderInfo,
  type TutorTurn,
} from '@focusloop/shared-types';

/**
 * The rules the ask adds to the tutor's two halves (AG3 step two).
 *
 * `tutor.ts` decides what to send and whether what came back is an answer. This decides the three
 * things that are about the *conversation* rather than one exchange: where the transcript lives and
 * what it keeps, what the learner is told when there is no answer, and what the inspector is told
 * about a prompt that was built and never sent. Kept pure and out of `engine.ts` for the reason every
 * other rule in this package is: the engine wires, and the wiring is not testable without a database.
 *
 * The transcript is the reason this module exists at all. It becomes text the model reads as its own
 * prior output, so it is the largest untrusted string in the feature, and the renderer must neither
 * supply it nor be able to read it back into a prompt. It is kept here, in the main process, keyed by
 * session, and the only thing that ever crosses the bridge is the learner's current question.
 *
 * **Its length is the caller's bound, not this module's.** `record` clips on write — a question to
 * `questionCharacters` and an answer to `answerCharacters` — but nothing here stops a caller handing
 * `list()` straight to `buildTutorPrompt`, which clips every turn to `answerCharacters` again and is
 * where the bound that reaches the model is enforced. For a learner turn that is a real reduction (2,000
 * down to 600); for a tutor turn, already stored at the same bound, it is a no-op. Said because the two
 * are easy to read as one guarantee, and only the second one is kept.
 */

/** One stored exchange, as the transcript keeps it. */
export interface TranscriptRecord {
  /** The learner's question, clipped to `TUTOR_LIMITS.questionCharacters`. */
  readonly question: string;
  /** The tutor's answer, in the labelled format, clipped to `TUTOR_LIMITS.answerCharacters`. */
  readonly answer: string;
}

/**
 * The conversation, in memory, keyed by session.
 *
 * In memory and not in the store, deliberately: the transcript is a working aid for the exchange in
 * progress and nothing recovers value from it after the session ends, whereas persisting model prose
 * means a table that grows with every question and a deletion path that has to be right. The AG7
 * memory work is where "what the learner asked" becomes durable, and it will be a decision with a
 * schema rather than a side effect of the tutor.
 */
export class TutorTranscript {
  private readonly bySession = new Map<string, TutorTurn[]>();

  /**
   * Adds an exchange, and reports what had to be given up to keep it.
   *
   * Trimming happens on write rather than on read, so the bound holds whether or not anybody asks
   * again — a session where the learner asked fifty questions and stopped would otherwise keep all of
   * it. The oldest turn goes first, which can leave a tutor turn at the head of the transcript; that
   * is what a window over a conversation looks like, and the alternative (dropping pairs) loses twice
   * as much for the same bound.
   */
  record(sessionId: string, exchange: TranscriptRecord): readonly AgentContextOmission[] {
    const turns = this.bySession.get(sessionId) ?? [];
    const omissions: AgentContextOmission[] = [];

    const question = clipTo(exchange.question, TUTOR_LIMITS.questionCharacters);
    if (question.clipped) {
      omissions.push({
        field: 'conversation',
        detail: 'your question was longer than the transcript keeps, so the rest is not kept',
      });
    }

    const answer = clipTo(exchange.answer, TUTOR_LIMITS.answerCharacters);
    if (answer.clipped) {
      omissions.push({
        field: 'conversation',
        detail: 'the tutor answer was longer than the transcript keeps, so the rest is not kept',
      });
    }

    turns.push({ role: 'learner', text: question.value });
    turns.push({ role: 'tutor', text: answer.value });

    /*
     * The excess, removed in one step.
     *
     * An earlier version looped `while (excess > 0)` removing two at a time to keep the window opening
     * on a learner turn, with a comment explaining a branch that could not run. The excess is `pairs
     * pushed - the cap`; `record` is the only writer of this array and it pushes a pair, and the cap is
     * even, so the window opens on a learner turn without any of that. It is arithmetic, not control
     * flow — and the invariant it rests on is that this array has one writer, which is what a future
     * mutator should preserve rather than what this function should defend against.
     */
    const excess = turns.length - TUTOR_LIMITS.turns;
    if (excess > 0) {
      turns.splice(0, excess);
      omissions.push({
        field: 'conversation',
        detail: `${excess} older ${
          excess === 1 ? 'turn was' : 'turns were'
        } left out of the transcript`,
      });
    }

    this.bySession.set(sessionId, turns);
    return omissions;
  }

  /** Every retained turn, oldest first. */
  list(sessionId: string): readonly TutorTurn[] {
    return [...(this.bySession.get(sessionId) ?? [])];
  }

  /**
   * Every learner turn, oldest first, for the quotation check.
   *
   * Straight from the transcript rather than from the turns the builder was given, because the two
   * differ once the builder drops a turn for space — and a confirmation that quotes a turn the model
   * can no longer see is still a confirmation of something the learner actually wrote.
   */
  learnerText(sessionId: string): readonly string[] {
    return this.list(sessionId)
      .filter((turn) => turn.role === 'learner')
      .map((turn) => turn.text);
  }

  /**
   * Forgets a session.
   *
   * Called when a session ends, so the next one does not start inside the last one's conversation —
   * which would be the tutor answering the previous session's question in the new session's context
   * and reporting it as this session's transcript.
   */
  forget(sessionId: string): void {
    this.bySession.delete(sessionId);
  }

  /** How many sessions are held. For the leak test rather than for the product. */
  size(): number {
    return this.bySession.size;
  }
}

/**
 * The labelled form of an answer, which is what goes back into the transcript.
 *
 * The same format the model was asked for, because the transcript is presented to it as its own prior
 * output: storing prose would mean the model sees an answer that does not look like the one it was
 * told to produce, and a model shown a shape it was told not to produce will produce that shape. The
 * parts are the ones `readTutorReply` recovered, so nothing reaches the transcript that the mode does
 * not allow.
 *
 * `confirmed` and `missing` are included rather than dropped for being meta: the quotation is the
 * thing the next answer must not contradict, and a learner revisiting a gap should see that it was
 * named.
 */
export function formatAnswer(parts: readonly TutorPart[]): string {
  return parts.map((part) => `[${part.kind}]\n${part.text}`).join('\n\n');
}

/**
 * The same report, with nothing marked as sent.
 *
 * Present tense, and it is about the one state: **the provider was never called.** That is the offline
 * gate in `askTutor`, where the configured provider is the mock and its output is documented never to
 * parse, so no call is made and nothing left the process. The omissions are kept: they are about the
 * prompt, and the prompt exists.
 *
 * A provider that was called and failed is **not** this state. `sent` is what the inspector reads to see
 * a prompt growing, and reporting zero there hides the growth in the one case where the prompt was
 * built, handed over, and answered by nobody. Those paths report the built numbers instead.
 */
export function unsentReport(report: TutorContextReport): TutorContextReport {
  return {
    sent: { turns: 0, inputCharacters: 0, excerptCharacters: 0 },
    omitted: report.omitted,
  };
}

/**
 * The follow-up turn that asks for the answer again, and the bound `tutor.ts` cannot enforce.
 *
 * `buildTutorRetryPrompt` writes the complaint and says, in its own doc, that the caller appends it
 * after the exchange it is correcting and against the same system prompt. It cannot bound the result:
 * it does not see what it is being appended to, and the whole thing together is a prompt that was
 * already budgeted plus a turn that was never budgeted. **A retry is a second call, and a second call
 * over the ceiling is the same defect as a first one over the ceiling** — so the composition, and its
 * bound, live here, where both halves are visible.
 *
 * **It composes from the preamble — everything before the question — and not from the prompt.** The
 * first version took the prompt whole, which carries the `[question]` block, and appended the retry,
 * which restates the question: the question was sent twice, and the duplicate is what the ceiling could
 * not afford. Measured at the constants as they stand, a 2,000-character question, an echoed answer at
 * `answerCharacters` and the complaint together come to more than the ceiling — the preamble and the
 * question each fit on their own, so the duplicate is what tips it — and the repair was therefore
 * available only to learners who wrote *short* questions.
 *
 * The model's own first answer is included, because the doc says the retry has to let the model see the
 * answer it is being asked to redo, and it is clipped to `TUTOR_LIMITS.answerCharacters` for the same
 * reason a stored answer is: it is model prose of unknown length and the budget is not.
 *
 * **Refusing is a real outcome, not an error.** When it does not fit, the retry is not sent and the
 * caller reports why: a second call that would break the ceiling is worse than no second call, and a
 * silent skip would be the reader's `recovered` parts disappearing with no explanation. It is reachable
 * — a full transcript plus both context fields at their caps leaves no room — and it is the honest
 * answer in that state rather than a defect to be designed away.
 *
 * **The size comes back with the prompt.** The caller reports what was sent, and deriving that from
 * `prompt.length + system.length` a second time would be a second transcription of the one number this
 * function already computed to make its own decision — the same defect the `ASSEMBLY_JOIN` doc names, one
 * layer up. The number reported is the number that was checked, by construction.
 */
export function composeRetryPrompt(input: {
  readonly system: string;
  readonly preamble: string;
  readonly answer: string;
  readonly retry: string;
}):
  | { readonly status: 'fits'; readonly prompt: string; readonly inputCharacters: number }
  | { readonly status: 'does-not-fit' } {
  const answer = clipTo(input.answer, TUTOR_LIMITS.answerCharacters).value;
  const prompt = [input.preamble, answer, input.retry]
    .filter((part) => part.length > 0)
    .join('\n\n');
  const inputCharacters = prompt.length + input.system.length;
  if (inputCharacters > TUTOR_LIMITS.inputCharacters) {
    return { status: 'does-not-fit' };
  }
  return { status: 'fits', prompt, inputCharacters };
}

/** What the inspector is told about the provider behind an answer, or the absence of one. */
export function providerInfo(
  provider: { readonly id: string; readonly model: string },
  degraded: boolean,
  failure: ProviderFailure | null,
): TutorProviderInfo {
  return { id: provider.id, model: provider.model, degraded, failure };
}

/**
 * What the learner sees when there is no answer.
 *
 * Carries what the app already knows and says so when that is nothing much: `reason` is the only part
 * that is never absent, and every other field is nullable because the states that need a fallback are
 * exactly the states where the app may know very little. The excerpt is included as the object rather
 * than as a nullable source, so "no section" is an empty excerpt with a heading of `null` rather than a
 * second absent value to branch on.
 */
export function fallbackFor(
  reason: TutorFallbackReason,
  context: AgentContext | null,
): TutorFallback {
  const excerpt: MaterialExcerpt = context?.material ?? {
    materialId: null,
    title: null,
    heading: null,
    text: '',
    truncated: false,
  };

  return {
    reason,
    excerpt,
    conceptTitle: context?.concept.title ?? null,
    taskTitle: context?.task.title ?? null,
    instructions: context?.task.instructions ?? null,
  };
}

/**
 * A string clipped to a number of **code points**, and whether it was.
 *
 * The unit agrees with `tutor.ts`'s `clip` rather than with `TUTOR_LIMITS`' UTF-16 accounting, and the
 * mismatch is the documented one: a transcript of astral characters is charged roughly twice what it
 * holds. Slicing by code unit instead would cut a surrogate pair in half and send a lone surrogate to
 * the model, which is a worse failure than an over-count so the contract already names.
 */
function clipTo(value: string, limit: number): { value: string; clipped: boolean } {
  const points = [...value];
  if (points.length <= limit) return { value, clipped: false };
  return { value: points.slice(0, limit).join(''), clipped: true };
}
