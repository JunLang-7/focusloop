import {
  TUTOR_LIMITS,
  TUTOR_MODE_PARTS,
  TUTOR_PART_KINDS,
  TUTOR_QUOTE_MARKS,
  type AgentContext,
  type AgentContextOmission,
  type MaterialExcerpt,
  type TutorContextReport,
  type TutorMode,
  type TutorPart,
  type TutorPartKind,
  type TutorRejection,
  type TutorReply,
  type TutorTurn,
} from '@focusloop/shared-types';

/**
 * The contextual tutor's rules (AG3): what it sends, and what it will accept back.
 *
 * Pure, and therefore testable without a session, a database, a provider or Electron — the same shape
 * as `agent-context.ts`, `dashboard.ts` and `insights.ts`. The one thing it deliberately cannot do is
 * decide whether an answer is *true*; it decides whether the answer is the shape the mode promises,
 * and it refuses the ones that are not rather than passing them off as help.
 */

/**
 * Normalises text for the two comparisons that have to be forgiving.
 *
 * Used for the quotation check and for resolving a named section. Deliberately aggressive, because
 * the two errors are not symmetric: a normalisation that is too lenient lets a fabricated quote
 * through only if it happens to be a substring of something the learner really wrote, while one that
 * is too strict rejects an honest learner silently — they cannot even see what went wrong.
 *
 * NFKC folds full-width to half-width, which matters because this is a bilingual product: a Chinese
 * learner's words can differ from the model's copy by `，` versus `,` alone. Case, whitespace,
 * punctuation and symbols then go, so quoted words survive being re-punctuated by the model.
 */
export function normaliseForComparison(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, '');
}

/**
 * The labels the parser reads. `section` is reply-level rather than a part: every mode has to be able
 * to name where an answer came from, and a mode whose only allowed part is `hint` has no other channel
 * through which to do it.
 */
const SECTION_LABEL = 'section';
const PART_KINDS = new Set<string>(TUTOR_PART_KINDS);
/** ``` or ~~~ fences, which a model adds around structured output out of habit. */
const FENCE = /^(?:```|~~~)/;

/**
 * A label is a line whose entire content is `[name]`.
 *
 * The whole line, not "a line that starts with a bracketed word". The parser briefly accepted a label
 * sharing its line with the first line of its block, to be tolerant of how models write; that was
 * worse than it looked, because a *body* line beginning with a bracketed word then became a phantom
 * part and refused a well-formed reply. The format is specified in the prompt and deviations are
 * repaired by the retry, which is a more honest way to be tolerant than guessing.
 */
const LABEL_LINE = /^\[([a-z][a-z-]*)\]$/;

interface ParsedLabel {
  readonly label: string;
  readonly text: string;
  /** Lines dropped from this block, so a lossy parse is visible rather than silent. */
  readonly dropped: number;
}

/**
 * Splits the model's text on lines that are a label and nothing else.
 *
 * Tolerant on purpose: prose before the first label is ignored rather than fatal, and a fence line is
 * dropped rather than becoming part of the text. This is the same reasoning as the IPC boundary
 * returning a value instead of throwing — a model that wraps its answer in a sentence has not failed
 * the learner, and a parser that throws on it would take the whole feature down.
 */
function readLabels(text: string): readonly ParsedLabel[] {
  const labels: ParsedLabel[] = [];
  let current: { label: string; lines: string[] } | null = null;

  const flush = (heading: boolean): void => {
    if (current === null) return;
    const block = current.lines.join('\n').trim();
    /*
     * A heading is one line.
     *
     * A model that signs off after its last block — "Hope that helps!" — would otherwise have that
     * sentence glue onto the heading, so a correctly cited answer would be refused for citing a
     * section nobody has. The cost is the other direction: a heading the model wrapped across two
     * lines is read as its first line. That is the better failure of the two, and what keeps it honest
     * is `dropped` — the discarded lines are counted and reported rather than thrown away silently.
     */
    const kept = heading ? (block.split('\n')[0] ?? '') : block;
    const dropped = heading ? Math.max(0, block.split('\n').length - 1) : 0;
    labels.push({ label: current.label, text: kept.trim(), dropped });
  };

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (FENCE.test(line)) continue;

    const match = LABEL_LINE.exec(line);
    if (match?.[1] !== undefined) {
      flush(current?.label === SECTION_LABEL);
      current = { label: match[1], lines: [] };
      continue;
    }

    if (current !== null) current.lines.push(rawLine);
  }

  flush(current?.label === SECTION_LABEL);
  return labels;
}

/** The quoted spans inside a part, without their quote marks. */
function quotedSpans(text: string): readonly string[] {
  const spans: string[] = [];
  for (const [open, close] of TUTOR_QUOTE_MARKS) {
    let index = 0;
    for (;;) {
      const start = text.indexOf(open, index);
      if (start === -1) break;
      const end = text.indexOf(close, start + open.length);
      if (end === -1) break;
      spans.push(text.slice(start + open.length, end));
      index = end + close.length;
    }
  }
  return spans;
}

export interface ReadTutorReplyInput {
  readonly mode: TutorMode;
  readonly text: string;
  /** The excerpt the model was given, or null when there was nothing to ground an answer in. */
  readonly excerpt: MaterialExcerpt | null;
  /**
   * Every recorded learner turn, oldest first, **plus the question this reply answers**.
   *
   * The current question is part of the conversation and the transcript does not hold it yet — the engine
   * records a turn when an answer comes back — so a caller that passes only the recorded turns leaves
   * `CHECK_MY_ANSWER` unable to confirm anything the learner just said. See the note on the quotation check.
   */
  readonly learnerText: readonly string[];
}

export type TutorReading =
  | {
      readonly status: 'answered';
      readonly reply: TutorReply;
    }
  | {
      readonly status: 'rejected';
      readonly reason: TutorRejection;
      /** Parts that were usable, so a caller can decide whether a format retry is worth it. */
      readonly recovered: readonly TutorPart[];
      readonly omissions: readonly AgentContextOmission[];
    };

/**
 * Whether a rejection is worth asking the model again about, once.
 *
 * **Format failures are repairable; content failures are not**, and the reason is the one the whole
 * split exists for: retrying a *grounding* failure teaches the model to satisfy the checker. Told that
 * its quote was not in the learner's message, a model produces a quote that is, whether or not it
 * belongs to the claim. `unparseable` is about labels and not about truth — a retry cannot be satisfied
 * by fabricating anything in particular, only by emitting the format — so the hazard is absent and it
 * belongs here. This is wider than the design note's wording, which enumerated two reasons rather than
 * arguing for them.
 */
export type RetryableRejection = Exclude<
  TutorRejection,
  'unquoted-confirmation' | 'not-from-the-material'
>;

export function isRetryable(reason: TutorRejection): reason is RetryableRejection {
  return reason === 'unparseable' || reason === 'missing-part' || reason === 'unexpected-part';
}

/**
 * Reads a reply, and decides whether it is the answer the mode promises.
 *
 * The order matters. Whether there is anything to read comes first, because prose is not a near-miss —
 * it is the wrong thing entirely. Parts this mode does not allow come next: they are the failures a
 * single retry can fix, and they have to be caught before a required part is reported missing, or a
 * model that returned two parts gets told about the wrong one.
 */
export function readTutorReply(input: ReadTutorReplyInput): TutorReading {
  const labels = readLabels(input.text);
  const omissions: AgentContextOmission[] = [];
  const parts: TutorPart[] = [];
  let sourceHeading: string | null = null;
  let unknown = false;

  for (const label of labels) {
    if (label.dropped > 0) {
      omissions.push({
        field: 'material',
        detail: `${label.dropped} line(s) after the heading were left out`,
      });
    }

    if (label.label === SECTION_LABEL) {
      sourceHeading = label.text;
      continue;
    }
    if (!PART_KINDS.has(label.label)) {
      unknown = true;
      continue;
    }
    /*
     * A label with no text is not a part. Without this a reply of bare labels satisfies every
     * required-part check and the learner gets an empty box — the one outcome the design says must
     * never happen.
     */
    if (label.text.length === 0) {
      omissions.push({ field: 'conversation', detail: `the ${label.label} was empty` });
      continue;
    }
    parts.push({ kind: label.label as TutorPartKind, text: label.text });
  }

  const { required, allowed } = TUTOR_MODE_PARTS[input.mode];
  const allowedSet = new Set<string>(allowed);

  // Nothing labelled at all is prose, not a malformed answer — and prose is what the format retry is
  // for, so it is a repairable failure rather than a final one.
  if (labels.length === 0) {
    return { status: 'rejected', reason: 'unparseable', recovered: [], omissions };
  }

  if (unknown || parts.some((part) => !allowedSet.has(part.kind))) {
    return { status: 'rejected', reason: 'unexpected-part', recovered: parts, omissions };
  }

  const present = new Set(parts.map((part) => part.kind));
  if (required.some((kind) => !present.has(kind))) {
    return { status: 'rejected', reason: 'missing-part', recovered: parts, omissions };
  }

  if (input.mode === 'CHECK_MY_ANSWER') {
    const confirmed = parts.find((part) => part.kind === 'confirmed');
    if (confirmed === undefined || !quotesTheLearner(confirmed.text, input.learnerText)) {
      return { status: 'rejected', reason: 'unquoted-confirmation', recovered: parts, omissions };
    }
  }

  const source = resolveSource(sourceHeading, input.excerpt);
  if (source === undefined) {
    return { status: 'rejected', reason: 'not-from-the-material', recovered: parts, omissions };
  }

  /*
   * The clip runs before the reply is built, and its omissions go **into** the reply: they are about
   * the answer the learner is shown, and a caller that receives them beside the reply has nowhere to
   * put them that the renderer can reach.
   */
  const clipped = clipParts(parts, omissions);
  return {
    status: 'answered',
    reply: { mode: input.mode, parts: clipped, source, omissions },
  };
}

/**
 * Whether the confirmation quotes words the learner actually wrote.
 *
 * This is the whole of what the schema can say about honesty, and it is worth being exact about what
 * it does and does not catch:
 *
 * - it catches a confirmation with no referent (`"You're right."` normalises to `youareright`, which
 *   is not something the learner wrote), and it catches a quote that was invented;
 * - it does **not** catch a correctly quoted sentence being called correct when it is not. No string
 *   comparison can, and this is a named limitation rather than a solved problem;
 * - it also rejects a model that **paraphrases** the learner rather than quoting them. That follows
 *   directly from requiring a literal quotation and is the predictable failure of this check rather
 *   than an edge case: a learner who wrote "I think the order doesn't change" and is told "you said
 *   the ordering is preserved" gets the fallback instead of an answer.
 *
 * What it buys is that the learner can see exactly which of their own words was endorsed, and a
 * confirmation that has to point at something is harder to produce by reflex than one that does not.
 *
 * The check runs against **every learner turn including the one just asked** — conversations run to several
 * turns and a learner quoting "the bit I said before about the invariant" is quoting themselves, but the
 * message in front of the tutor is the first thing it should be able to confirm. A caller that passes only
 * the recorded transcript makes that impossible, and the far side of the doc on `ReadTutorReplyInput` says
 * so. A false rejection of an honest learner is worse than a missed fabrication, because the learner cannot
 * see that anything went wrong.
 */
function quotesTheLearner(confirmed: string, learnerText: readonly string[]): boolean {
  const said = learnerText.map(normaliseForComparison);
  // Joined with a NUL, which no normalisation removes: the point is that a quote cannot span two turns
  // and match something the learner never wrote as one unit. (An earlier comment claimed the separator
  // was removed by the normalisation — it is not, and it is not meant to be.)
  const joined = said.join('\u0000');

  const spans = quotedSpans(confirmed).map(normaliseForComparison);
  if (spans.length === 0) return false;

  return spans.every((span) => {
    if (span.length >= TUTOR_LIMITS.quoteCharacters) return joined.includes(span);
    /*
     * A quote below the floor is still a referent when it is the learner's *whole* message: somebody
     * who answered "yes" has nothing longer to quote, and rejecting them would be rejecting an honest
     * learner for being brief.
     */
    return said.some((turn) => turn.length > 0 && turn === span);
  });
}

/**
 * Resolves the section the model named against the one it was given.
 *
 * `undefined` means "rejected", `null` means "it named none". The comparison goes through the same
 * normalisation the quote check uses and is not a fuzzy match, because the fuzzy version fails in the
 * wrong direction: a model writing "from the Red-Black Trees section" against a heading of `Red-Black
 * Trees` is *grounded and confident*, and a fuzzy rule would throw that answer away.
 *
 * So this catches a citation of a section that does not exist, and what actually keeps an answer
 * grounded is the excerpt being in front of it. Describing it as a hallucination check would be
 * overclaiming.
 */
function resolveSource(
  heading: string | null,
  excerpt: MaterialExcerpt | null,
): MaterialExcerpt | null | undefined {
  if (heading === null || heading.length === 0) return null;
  if (excerpt === null || excerpt.heading === null) return undefined;

  return normaliseForComparison(heading) === normaliseForComparison(excerpt.heading)
    ? excerpt
    : undefined;
}

/**
 * Clips over-long parts. Reported rather than refused: a long part is still an answer, and a clip the
 * caller cannot see is prose that stops mid-sentence for no stated reason.
 *
 * Sliced by code point, not by UTF-16 unit, so a clip cannot end between the halves of a surrogate
 * pair and render as a replacement character.
 */
function clipParts(
  parts: readonly TutorPart[],
  omissions: AgentContextOmission[],
): readonly TutorPart[] {
  return parts.map((part) => {
    const points = [...part.text];
    if (points.length <= TUTOR_LIMITS.partCharacters) return part;
    omissions.push({
      field: 'conversation',
      detail: `the ${part.kind} was longer than is shown, so its end was left out`,
    });
    return { kind: part.kind, text: points.slice(0, TUTOR_LIMITS.partCharacters).join('') };
  });
}

// ------------------------------------------------------------------- the prompt

export interface BuildTutorPromptInput {
  readonly mode: TutorMode;
  readonly context: AgentContext;
  readonly question: string;
  readonly turns: readonly TutorTurn[];
}

/**
 * Either a prompt to send, or a refusal.
 *
 * A discriminated result rather than a prompt that is sometimes empty, because the refusal has to be
 * impossible to ignore: the caller sends `prompt`, and a caller that has to handle `refused` cannot
 * accidentally send a labelled format with no question in it.
 *
 * Two reasons share the variant, and neither substitutes for the other: `no-question` means there was
 * nothing to ask, and `request-too-long` means the question did not fit beside the context.
 */
export type TutorPromptResult =
  | {
      readonly status: 'built';
      readonly system: string;
      readonly prompt: string;
      readonly report: TutorContextReport;
      /**
       * The learner's question **as it was sent**: clipped to whichever of `questionCharacters` and the
       * room left by the context is smaller, and with the format's own labels stripped.
       *
       * Returned rather than left for the caller to reconstruct, because the two things a caller does
       * with it are both wrong under reconstruction. The transcript stores it, and storing the raw
       * question would put a `[hint]` the learner typed into the next prompt as though the model had
       * written it — the sanitiser exists for exactly that. And a retry re-sanitises what it is handed,
       * so handing it the raw text is a second pass over text the first pass already changed.
       */
      readonly question: string;
      /**
       * Everything before the question, assembled exactly as it was sent: the context block and the
       * included transcript turns.
       *
       * Exists for the retry, and exists because composing `prompt + the model's answer + the complaint`
       * carries the question **twice**: the prompt ends with the `[question]` block and
       * `buildTutorRetryPrompt` restates the question as part of the follow-up turn. On a budget where the
       * prompt is already near the ceiling, that duplicated block is what made the retry unaffordable for
       * exactly the learner who wrote a long question — the one whose model is most likely to have ignored
       * the format. `[preamble, answer, retry]` says the same thing once.
       */
      readonly preamble: string;
      /**
       * The excerpt that is in the prompt, or `null` when it was dropped for space.
       *
       * `null` is not "there was no material" — that is an empty excerpt with a null heading, and it is
       * still here as an object. This is "the model was not shown it", which is what a reader needs to
       * know before it resolves a `[section]` citation: a citation of a section the model was not given
       * is `not-from-the-material`, and it cannot be told from a real one after the fact.
       */
      readonly excerpt: MaterialExcerpt | null;
    }
  | {
      readonly status: 'refused';
      readonly reason: 'no-question' | 'request-too-long';
      readonly report: TutorContextReport;
    };

const QUESTION_HEAD = '[question]\n';

/**
 * What `assemble` puts between blocks, and therefore what the budget has to charge for.
 *
 * The **string**, not its length, and used by both: `assemble` joins with it and the room is charged
 * `ASSEMBLY_JOIN.length`, so the two cannot disagree. As a number it was a second independent
 * transcription of one fact — change the join in `assemble` and the arithmetic would have gone on
 * charging two characters for a separator that was now three. Two characters between the context and
 * the question were already the difference between the ceiling the comments described and the one the
 * code enforced, which is why the constant exists; writing it as a length would have reproduced the
 * same defect one layer up, under a comment promising it was impossible.
 */
const ASSEMBLY_JOIN = '\n\n';

/**
 * Titles are clipped even in the reduced context.
 *
 * `concept.title` and `task.title` are the same class of unbounded imported string as the two detail
 * fields, and the reduced branch has to be able to get under the ceiling on its own — a title of a few
 * thousand characters would otherwise leave no room for the question, which is the state that returns
 * `request-too-long`.
 */
const TITLE_CHARACTERS = 120;

/**
 * Builds what the model is sent, and the account of what it was not.
 *
 * Bounded at every level, **including the aggregate**: `inputCharacters` is the total of the system
 * prompt, the context, the excerpt, the transcript and the question. An earlier version counted only
 * the last three and described itself as "everything", which is how a documented 4,000-character
 * ceiling would have sent roughly 5,400 while the inspector showed 3,800 — the failure AG1's report
 * exists to prevent, one layer up.
 *
 * The bound is enforced on the **assembled string**, built by the same function that produces the
 * result, so the number compared to the limit is the number sent.
 *
 * Three ways it gives way, in order, each reported: the excerpt and the context detail go; the question
 * is clipped to what is left; and if the question does not fit at all, nothing is sent.
 *
 * There is also a fourth, in front of all of them: a question with nothing in it is refused rather than
 * sent, because a labelled block with no question under it is a paid call asking the model to explain
 * nothing.
 */
export function buildTutorPrompt(input: BuildTutorPromptInput): TutorPromptResult {
  const omissions: AgentContextOmission[] = [];
  const excerpt = input.context.material;
  const limit = TUTOR_LIMITS.inputCharacters;

  const questionText = sanitiseQuestion(
    clip(input.question.trim(), TUTOR_LIMITS.questionCharacters, omissions),
    omissions,
  );

  /*
   * No question means no call.
   *
   * Reachable without anybody misbehaving: an empty message, whitespace, or a message that is nothing
   * but the format's own labels all sanitise to nothing — and the sanitising is itself correct. Without
   * this, `questionBlock` is the eleven-character label on its own, whose length is non-zero so the
   * clip below never touches it, and `assemble` keeps it because its length is non-zero too. The result
   * is a paid call carrying `[question]` with nothing under it, which is the exact artefact the clamp
   * was added to prevent.
   */
  if (questionText.length === 0) {
    omissions.push({ field: 'conversation', detail: 'there was no question to ask' });
    return { status: 'refused', reason: 'no-question', report: refusalReport(omissions) };
  }

  const full = { detailLimit: TUTOR_LIMITS.contextCharacters, includeExcerpt: true };
  const reduced = { detailLimit: 0, includeExcerpt: false };
  const fullContext = describeContext(input.context, full);

  let contextBlock = fullContext.text;
  /*
   * Keyed on the same condition that decides whether `describeContext` writes a section line — a
   * heading *and* text — rather than on the text alone. With text but no heading the block reads
   * "no section of the material matches this concept" while the system prompt would say "the section
   * given below", which is the contradiction this branch exists to remove, one condition to the left.
   * Unreachable from AG1, whose shape cannot produce that pair, and wrong as a property of this code.
   */
  const hasSection = excerpt.heading !== null && excerpt.text.length > 0;
  let system = buildSystem(input.mode, hasSection);
  const questionBlock = `${QUESTION_HEAD}${questionText}`;
  let block = questionBlock;
  /*
   * The question as it will be sent, tracked rather than recomputed.
   *
   * `block` carries the label and `asked` does not, and the clip has to land in both — a caller that
   * reconstructed the question by stripping the label would get the unclipped text back, which is the
   * bug the old `questionText` read produced. `clip` is called once so the omission is reported once.
   */
  let asked = questionText;

  /*
   * The fixed parts can exceed the whole budget on their own.
   *
   * Two context fields at their own per-field cap, AG1's excerpt and a long question sum to about 4,800
   * before the system prompt is counted at all — every input at a documented limit, nothing
   * adversarial. Without this the loop simply breaks on its first iteration and the call returns a
   * prompt well over the ceiling it documents, with the one omission blaming the transcript for a
   * problem the transcript did not cause. **A ceiling with no branch for "the fixed part alone is over"
   * reports a number above itself rather than bounding anything.**
   *
   * The excerpt and the two long detail fields go first: the step's own words still ground the answer,
   * and AG1 already has a "this section was clipped" concept.
   *
   * The system prompt is **rebuilt** here rather than computed before, because one of its sentences
   * depends on whether an excerpt survived — and the variant sent after the reduction is the *longer*
   * one, by ten code units (measured: 1157 against 1167 for `CHECK_MY_ANSWER`, 774 against 784 for
   * `EXPLAIN`). `room` therefore has to be computed after the rebuild: computing it from the
   * pre-branch sentence charges the shorter of the two and then sends the longer, which puts every
   * reduced prompt whose sentence changes exactly those ten units over the ceiling the comments claim.
   * (With no section in the full context the two sentences are identical and the ten units are not
   * there to lose — which is the case where "it is longer in the state where one did" is meaningless,
   * and why the count is stated rather than the adjective.) Building it before the branch at all meant
   * the reduced prompt still said "use the material section given below" over a block with no section in
   * it, which is the contradiction this branch exists to remove.
   */
  if (system.length + contextBlock.length + block.length > limit) {
    const removed = describeContext(input.context, reduced);
    contextBlock = removed.text;
    system = buildSystem(input.mode, false);
    omissions.push(...removed.omissions);
  } else {
    // Only on the path that keeps the full block: reporting a summary's clip alongside "the longer
    // context was left out" would describe two prompts, one of which was never built.
    omissions.push(...fullContext.omissions);
  }

  /*
   * A length, not a bail-out, and zero means exactly one thing.
   *
   * The earlier version skipped the clip whenever the remainder went negative and left the full question
   * in, so a prompt could sit up to fourteen characters over the ceiling. Clamping makes the remainder a
   * length.
   *
   * `- ASSEMBLY_JOIN` because `assemble` puts two characters between the context block and the
   * question block, and nothing was charging them: with no turns admitted — every first question in a
   * conversation — the string sent was two characters longer than the sum that had been bounded, so the
   * inspector could show 4,002 against a documented 4,000.
   *
   * The refusal below is **reachable, and only on an exact size**. `room` is computed from the system
   * prompt and the context block, and nothing else: no turn appears in it, and the turn loop runs after
   * this point, so a transcript cannot cause it and neither can a hostile length on its own. It needs the
   * fixed part to land within thirteen characters of the ceiling, and measured, that is the whole of the
   * reachable region — the branch only skips the reduction when `system + contextBlock + 13 + question <=
   * 4000`, and `room === 0` needs `system + contextBlock >= 3987`, so a question of one or two characters
   * with the context sized to the character is all of it. With the concept summary grown one character at
   * a time and everything else at its cap, the summary size of 676 builds (room of 1) and 677 refuses
   * (room of 0, `system + contextBlock` of 3987); 678 fires the reduction instead, which rebuilds a
   * 75-character block and leaves a room of thousands.
   *
   * Asserted rather than described: `tutor.spec.ts` runs that search, asserts the refusal at the boundary,
   * asserts that one character less builds, and names the constants in the failure message if no size ever
   * reaches it. That search is what found the previous version of this paragraph to be wrong — it claimed a
   * transcript could bring the refusal back, and a transcript cannot reach `room` at all.
   *
   * The largest total the built path can produce is a different number and worth having here, because it
   * is what the ceiling is actually doing: `CHECK_MY_ANSWER` with a 4000-character summary, a
   * 4000-character instruction block, a title of 3600 and a question at the 2000-character cap sends 3415,
   * and the largest over both the spec's 2400-length scan and a probe of every question length from 1 to
   * 4000 is 3637 — against a ceiling of 4000.
   */
  const room = Math.max(
    0,
    limit - system.length - contextBlock.length - QUESTION_HEAD.length - ASSEMBLY_JOIN.length,
  );

  if (room === 0) {
    omissions.push({
      field: 'conversation',
      detail:
        'there was no room left for your question once the step and its context were included',
    });
    return { status: 'refused', reason: 'request-too-long', report: refusalReport(omissions) };
  }

  if (questionText.length > room) {
    asked = clip(questionText, room, omissions);
    block = `${QUESTION_HEAD}${asked}`;
  }

  /*
   * The loop tests the **assembled** prompt, not a running total of its parts.
   *
   * The first version summed the system prompt, the context, the question and each turn block and then
   * joined them with separators and a transcript header that nothing had charged, so the artefact could
   * sit about fifty characters over the ceiling and the loop admitted turns a check on the real thing
   * would have refused.
   */
  const included: TutorTurn[] = [];
  let cappedByCount = false;
  for (let index = input.turns.length - 1; index >= 0; index -= 1) {
    const turn = input.turns[index];
    if (turn === undefined) continue;
    if (included.length >= TUTOR_LIMITS.turns) {
      cappedByCount = true;
      break;
    }

    // Clipped after the budget test, not before: clipping a turn and then dropping it reports a
    // truncation the learner never saw.
    const candidate = [...included, turn];
    if (system.length + assemble(contextBlock, candidate, block).length > limit) break;

    included.push({
      role: turn.role,
      text: clip(turn.text, TUTOR_LIMITS.answerCharacters, omissions),
    });
  }

  const dropped = input.turns.length - included.length;
  if (dropped > 0) {
    // Two causes, named separately: the cap on how many turns are kept, and the room left for them.
    omissions.push({
      field: 'conversation',
      detail: cappedByCount
        ? `${dropped} earlier ${dropped === 1 ? 'turn is' : 'turns are'} not included (one conversation keeps the last ${TUTOR_LIMITS.turns})`
        : `${dropped} earlier ${dropped === 1 ? 'turn is' : 'turns are'} not included (no room left for them)`,
    });
  }

  const prompt = assemble(contextBlock, included, block);
  const preamble = assemble(contextBlock, included, '');
  /*
   * The same condition drives the count and the object, in one place.
   *
   * `excerptCharacters` and `excerpt` answer different questions about the same fact — how much was
   * shown, and what it was — and computing them from two copies of `prompt.includes(...)` is how a
   * report comes to say 54 characters were shown beside a null excerpt.
   */
  const shownExcerpt = excerpt.text.length > 0 && prompt.includes(excerpt.text) ? excerpt : null;
  return {
    status: 'built',
    system,
    prompt,
    preamble,
    question: asked,
    excerpt: shownExcerpt,
    report: {
      sent: {
        turns: included.length,
        inputCharacters: system.length + prompt.length,
        // Zero when the excerpt did not make it in, so the inspector cannot show a passage the prompt
        // does not contain.
        excerptCharacters: shownExcerpt === null ? 0 : excerpt.text.length,
      },
      omitted: [...omissions],
    },
  };
}

/**
 * The account for a request nothing was sent for.
 *
 * Every field is zero because nothing was sent — the type says `sent` describes what the model was
 * given, and reporting the system prompt's length for a call that never happened is the kind of number
 * an inspector will be believed about.
 */
function refusalReport(omitted: readonly AgentContextOmission[]): TutorContextReport {
  return {
    sent: { turns: 0, inputCharacters: 0, excerptCharacters: 0 },
    omitted: [...omitted],
  };
}

/**
 * The prompt, assembled exactly the way it is sent.
 *
 * A function rather than an inline join because the budget test and the result have to agree: the
 * earlier version computed the length one way and built the string another, and the difference was the
 * `\n\n` separators and the transcript header.
 */
function assemble(
  contextBlock: string,
  turns: readonly TutorTurn[],
  questionBlock: string,
): string {
  return [contextBlock, turnsBlock(turns), questionBlock]
    .filter((block) => block.length > 0)
    .join(ASSEMBLY_JOIN);
}
const MODE_INSTRUCTIONS: Record<TutorMode, string> = {
  EXPLAIN: 'Explain the idea this step depends on, in terms of the material section provided.',
  HINT:
    'Give one nudge that moves the learner forward without telling them the answer. A hint is not an ' +
    'explanation: do not explain the idea, do not work an example.',
  EXAMPLE: 'Work one small concrete example from the material section, all the way through.',
  SOCRATIC:
    'Ask one question that makes the learner do the next piece of thinking themselves. Do not answer ' +
    'it for them.',
  CHECK_MY_ANSWER:
    'The learner has offered their own understanding. Quote the words of theirs that are right inside ' +
    'double quotes, say what is missing if anything genuinely is, and ask one question that moves ' +
    'them forward. Never answer just "yes" or "no", and never invent a gap that is not there.',
  SUMMARIZE:
    'Summarise what this material section says, in the terms of the task the learner is doing now. ' +
    'This is not a summary of the session or of their progress.',
};

/**
 * The format the model is asked for, described in the same words the parser implements.
 *
 * Labelled parts rather than JSON. `CompletionRequest` is `{ system?, prompt }` and `CompletionResult`
 * is `{ text }` — plain text in, plain text out — and structured output is AG9's job. Depending on it
 * here would make AG3 a dependency of a later epic, and labelled parts are readable, tolerant of
 * surrounding prose, and enough for both the per-mode contract and naming the source.
 */
function formatSpec(mode: TutorMode): string {
  const { required, allowed } = TUTOR_MODE_PARTS[mode];
  const optional = allowed.filter((kind) => !required.includes(kind));

  const lines = [
    'Answer with labelled blocks. A label is a line containing only the label, in square brackets,',
    "with that block's text on the lines after it.",
    `Use only these labels: ${allowed.map((kind) => `[${kind}]`).join(', ')}. Any other label is refused.`,
    `You must include: ${required.map((kind) => `[${kind}]`).join(', ')}.`,
  ];

  /*
   * `missing` is allowed, not required, and the prompt has to say so.
   *
   * The first version printed the allowed set as "use exactly these, in this order", which for
   * CHECK_MY_ANSWER told the model to emit `[missing]` every time — reintroducing, in the
   * instructions, exactly the fabrication that requiring it in the schema was rejected for. The schema
   * permitting a part is not the same as asking for it, and the prompt is where that distinction has
   * to survive.
   */
  for (const kind of optional) {
    if (kind === 'missing') {
      lines.push(
        'Include [missing] only if the learner genuinely left something out. If their understanding ' +
          'is complete, leave it out entirely rather than inventing a gap.',
      );
    } else {
      lines.push(`Include [${kind}] only if it is useful here.`);
    }
  }

  lines.push(
    `To name the section you used, add a line "[${SECTION_LABEL}]" with its heading copied exactly.`,
    "Put the learner's own words that you are confirming inside double quotes.",
  );

  return lines.join('\n');
}

function buildSystem(mode: TutorMode, hasMaterial: boolean): string {
  return [
    'You are a tutor inside a focus tool. The learner is looking at one step of one task.',
    MODE_INSTRUCTIONS[mode],
    formatSpec(mode),
    hasMaterial
      ? 'Use only the material section given below. If it does not answer the question, say so in the ' +
        'same labelled form rather than answering from general knowledge.'
      : /*
         * The prompt must not point at a section that is not there. The first version said "the section
         * given below" unconditionally, and there is a state where the excerpt was left out to fit the
         * budget — so the model was told to use something absent, and the honest instruction (answer
         * from the step, cite nothing) was never given.
         */
        'No material section is included for this question. Answer from the step and the concept ' +
        'above, cite no section, and say plainly if the step is not enough to answer it.',
    'Be brief. The learner is working, not reading.',
  ].join('\n\n');
}

/**
 * Removes anything from the learner's own words that would read as one of the tutor's labels.
 *
 * A question is data being re-sent into a format that has labels, so a learner who writes `[hint]` is
 * not answering on the tutor's behalf — but the model has no way to tell.
 *
 * **The transcript is deliberately left alone**, and it is worth saying why rather than leaving the
 * impression that it was forgotten. Stripping a label from a previous learner turn would rewrite what
 * the learner said, and the transcript's job is to recall it accurately; each turn is already attributed
 * (`Learner said:` / `You said:`), so a bracketed word inside one is a quoted utterance and not a label
 * the model produced. What actually holds against a hostile transcript is the response contract — the
 * reply has to be the mode's allowed parts, with a grounded section — and that is `readTutorReply`.
 *
 * Narrowed to the labels the format actually has. Removing *every* bracketed word was the first version,
 * and it deleted ordinary notation: a learner asking "what does `[x]` mean here?" lost the line, and a
 * question that was only that line became empty. That is the same argument the parser makes two hundred
 * lines up, and it should not have been reversed here.
 */
function sanitiseQuestion(question: string, omissions: AgentContextOmission[]): string {
  const labels = new Set<string>([...TUTOR_PART_KINDS, SECTION_LABEL]);
  let removed = 0;
  const kept = question.split(/\r?\n/).filter((line) => {
    const match = LABEL_LINE.exec(line.trim());
    if (match?.[1] === undefined || !labels.has(match[1])) return true;
    removed += 1;
    return false;
  });

  // Reported, because this is otherwise the only lossy step in here that says nothing — and the point
  // of the omissions list is that nothing is lost quietly.
  if (removed > 0) {
    omissions.push({
      field: 'conversation',
      detail: `${removed} line(s) of your question looked like the tutor's own labels and were left out`,
    });
  }

  return kept.join('\n').trim();
}

function clip(
  value: string,
  limit: number,
  omissions: AgentContextOmission[],
  what = 'something you wrote',
): string {
  // By code point, so a clip cannot split a surrogate pair.
  const points = [...value];
  if (points.length <= limit) return value;
  omissions.push({
    field: 'conversation',
    detail: `${what} was longer than the tutor reads, so its end was left out`,
  });
  return points.slice(0, limit).join('');
}

function turnBlock(role: TutorTurn['role'], text: string): string {
  return `${role === 'learner' ? 'Learner' : 'You'} said:\n${text}`;
}

function turnsBlock(turns: readonly TutorTurn[]): string {
  if (turns.length === 0) return '';
  return `Earlier in this conversation:\n\n${turns
    .map((turn) => turnBlock(turn.role, turn.text))
    .join('\n\n')}`;
}

/**
 * The current moment, in the words the model can use.
 *
 * Deliberately flat text rather than the JSON of `AgentContext`: the fields are what the mode
 * instructions refer to ("this step", "the section provided"), and a model reading a labelled
 * paragraph uses them more reliably than one re-deriving them from a nested object.
 *
 * Its own bound, because two of these fields are unbounded strings in the domain: `Concept.summary`
 * and `Task.instructions` are whatever the imported material produced. Only `material.text` arrived
 * already bounded, from AG1, and an unbounded field inside a bounded total is not bounded.
 */
function describeContext(
  context: AgentContext,
  options: { readonly detailLimit: number; readonly includeExcerpt: boolean },
): { readonly text: string; readonly omissions: readonly AgentContextOmission[] } {
  const removed: AgentContextOmission[] = [];
  const lines: string[] = [];
  const { task, concept, material } = context;

  if (concept.title !== null) {
    lines.push(`Concept: ${clip(concept.title, TITLE_CHARACTERS, removed)}`);
  }
  if (concept.summary !== null && concept.summary.length > 0 && options.detailLimit > 0) {
    lines.push(`Concept summary: ${clip(concept.summary, options.detailLimit, removed)}`);
  }
  if (task.title !== null) {
    lines.push(
      `Step ${task.step} of ${task.totalSteps}: ${clip(task.title, TITLE_CHARACTERS, removed)}`,
    );
  }
  if (task.instructions !== null && options.detailLimit > 0) {
    lines.push(`What the step asks for: ${clip(task.instructions, options.detailLimit, removed)}`);
  }
  lines.push(`The learner's state: ${context.learningState}`);

  if (options.includeExcerpt) {
    if (material.heading !== null && material.text.length > 0) {
      lines.push(
        `Material section "${material.heading}"${material.truncated ? ' (its beginning)' : ''}:\n${material.text}`,
      );
    } else {
      const reason =
        material.materialId === null
          ? 'no material is attached to this course'
          : 'no section of the material matches this concept';
      lines.push(`Material: ${reason}. Answer from the step above, and do not cite a section.`);
    }
  } else if (material.text.length > 0) {
    /*
     * Only when there was actually something there. The first version pushed this unconditionally,
     * which is false on a course with no material attached — and it named one of the three things the
     * reduced block drops, saying nothing about the summary and the instructions.
     */
    removed.push({
      field: 'material',
      detail:
        'the material excerpt and the longer context were left out to keep the message within its ' +
        'length limit',
    });
  }

  return { text: lines.join('\n'), omissions: removed };
}

/**
 * What the model is told when it is asked again.
 *
 * Format failures only, so the parameter is narrowed to the retryable subset — passing
 * `unquoted-confirmation` is then a type error rather than a function that politely claims the reply
 * was missing a label.
 *
 * **This is a follow-up turn, not a fresh prompt.** It carries the problem, the format and the
 * question, and deliberately no context block or excerpt: it must be appended after the exchange it is
 * correcting, against the same system prompt, so the model can see the answer it is being asked to
 * redo. Sending it on its own would leave nothing to ground an answer in — which is a fact about how
 * step two has to call it, and is therefore written here rather than assumed there.
 *
 * Four things the caller owns, and must not infer from this function:
 *
 * 1. **At most once per exchange.** `isRetryable` is a predicate, not a budget: it answers "is this the
 *    kind of failure worth asking again about", the same way every time. Nothing here counts.
 * 2. **The retry message is transport, not a transcript turn.** If it were recorded as a learner turn,
 *    the transcript would grow a meta-instruction ("Your answer had no labelled blocks at all") and
 *    every later question in that conversation would carry it. The exchange records the learner's
 *    question and the answer that came back; this is how the second one was obtained.
 * 3. **Do not retry an offline provider.** `MockAIProvider`'s output never parses — there is a test
 *    pinning that — so retrying it is two mock calls and no answer, on every offline question, which
 *    is the golden path. The signal is `provider.offline`, and the guard belongs at the **entry** to the
 *    ask rather than here: an offline provider never reaches a retry, so there is nothing to check at
 *    this point. `TutorProviderInfo.degraded` is the other signal and it is a different state — the
 *    provider was reached and failed, where a retry costs a second call for a second failure.
 * 4. **Do not spend the retry on a question that was never asked.** An empty or all-label message
 *    sanitises to nothing, and this function will then emit no `[question]` block at all — the same
 *    artefact the builder refuses to send. Emitting nothing is the right output and it is not a repair:
 *    the retry exists to get a second answer to a question the learner *did* ask, so a caller that
 *    reaches here with nothing asked has already made the mistake, and a refusal is what it wanted.
 *
 * The sanitiser's own removals are **not reported here**, because this returns a string and has nowhere
 * to put them. That is not a loss in the only call site: the question handed in is the text the builder
 * already sanitised and reported, so there is nothing left to strip. A caller that passes raw text is
 * throwing away an omission it should have produced itself.
 */
export function buildTutorRetryPrompt(input: {
  readonly mode: TutorMode;
  readonly reason: RetryableRejection;
  readonly question: string;
}): string {
  const { required, allowed } = TUTOR_MODE_PARTS[input.mode];
  const problem =
    input.reason === 'unparseable'
      ? 'Your answer had no labelled blocks at all.'
      : input.reason === 'unexpected-part'
        ? `Your answer used a label that is not allowed here. Only ${allowed
            .map((kind) => `[${kind}]`)
            .join(', ')} may be used.`
        : `Your answer did not include the labels this mode requires: ${required
            .map((kind) => `[${kind}]`)
            .join(', ')}. Each one needs text under it — a label on its own is not an answer.`;

  const asked = sanitiseQuestion(input.question, []);

  return [
    problem,
    'Answer the same question again, using only the allowed labels, each on a line of its own.',
    ...(asked.length === 0 ? [] : ['', '[question]', asked]),
  ].join('\n');
}
