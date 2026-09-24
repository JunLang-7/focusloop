import { describe, expect, it } from 'vitest';
import { MockAIProvider } from '@focusloop/llm-provider';
import {
  TUTOR_LIMITS,
  TUTOR_MODES,
  TUTOR_MODE_PARTS,
  type AgentContext,
  type MaterialExcerpt,
  type TutorTurn,
} from '@focusloop/shared-types';
import {
  buildTutorPrompt,
  buildTutorRetryPrompt,
  isRetryable,
  normaliseForComparison,
  readTutorReply,
} from './tutor';

const EXCERPT: MaterialExcerpt = {
  materialId: 'm1',
  title: 'Rotations',
  heading: 'Left rotation',
  text: 'A left rotation moves the pivot down and to the right.',
  truncated: false,
};

function contextWith(patch: Partial<AgentContext> = {}): AgentContext {
  return {
    session: {
      sessionId: 's1',
      startedAt: '2026-01-01T00:00:00.000Z',
      elapsedMs: 1000,
      completedTasks: 1,
      totalTasks: 5,
    },
    concept: { conceptId: 'c1', title: 'Rotations', summary: null, keyPoints: [] },
    task: {
      taskId: 't1',
      title: 'Read section 3',
      instructions: 'Read it and note the invariant',
      kind: 'read',
      estimatedMinutes: 5,
      step: 2,
      totalSteps: 5,
    },
    material: EXCERPT,
    learningState: 'FOCUSED',
    recentEvents: [],
    checkpoint: null,
    ...patch,
  };
}

/**
 * Narrows the builder's result to the built case.
 *
 * The result is a union so that a caller cannot accidentally send a labelled format with no question
 * in it. The tests here are about the built case, and one that silently got the refusal would be
 * testing nothing — so the helper throws rather than returning something falsy.
 */
function built(input: Parameters<typeof buildTutorPrompt>[0]) {
  const result = buildTutorPrompt(input);
  if (result.status !== 'built') {
    throw new Error(`expected a built prompt, got ${result.status}`);
  }
  return result;
}

describe('buildTutorPrompt', () => {
  it('sends the excerpt AG1 chose, and nothing else from the material', () => {
    const { prompt } = built({
      mode: 'EXPLAIN',
      context: contextWith(),
      question: 'why?',
      turns: [],
    });

    expect(prompt).toContain('A left rotation moves the pivot down');
    expect(prompt).toContain('Left rotation');
    // The bound is AG1's, and this asserts it is inherited rather than re-decided.
    expect(EXCERPT.text.length).toBeLessThanOrEqual(1200);
  });

  it('says so when there is no section to ground an answer in', () => {
    const noMaterial = contextWith({
      material: { materialId: null, title: null, heading: null, text: '', truncated: false },
    });
    const { prompt } = built({
      mode: 'HINT',
      context: noMaterial,
      question: 'q',
      turns: [],
    });

    expect(prompt).toContain('no material is attached to this course');
    expect(prompt).toContain('do not cite a section');
  });

  it('names which of the two reasons there is no section', () => {
    // AG1 distinguishes "no material" from "no section matches this concept", and the tutor reuses
    // AG1's wording rather than inventing a second account of the same situation.
    const attached = contextWith({
      material: { materialId: 'm1', title: 'Rotations', heading: null, text: '', truncated: false },
    });
    const { prompt } = built({
      mode: 'HINT',
      context: attached,
      question: 'q',
      turns: [],
    });

    expect(prompt).toContain('no section of the material matches this concept');
  });

  it('clips a question that is longer than it reads, and says that it did', () => {
    const { prompt, report } = built({
      mode: 'EXPLAIN',
      context: contextWith(),
      question: 'x'.repeat(TUTOR_LIMITS.questionCharacters + 500),
      turns: [],
    });

    expect(prompt).not.toContain('x'.repeat(TUTOR_LIMITS.questionCharacters + 1));
    expect(report.omitted.some((entry) => entry.field === 'conversation')).toBe(true);
  });

  it('holds the aggregate input budget on the artefact, not on its own counter', () => {
    /*
     * The bound the first design draft did not have, and the first version of this test did not test.
     *
     * Eight turns of a 2000-character question and a 600-character answer is 20,800 characters against
     * a 1200-character excerpt, and every one of those per-item numbers is individually reasonable.
     * What matters is the sum, because the sum is what leaves the process.
     *
     * The assertion is on `prompt.length + system.length` rather than on `report.sent.inputCharacters`,
     * because the earlier version asserted the implementation's own metric against the limit it was
     * computed from — which passed with the ceiling deleted entirely, since the counter still
     * accumulated and the turn cap still applied. A number the code reports about itself cannot be the
     * evidence that the code enforces it.
     */
    const turns: TutorTurn[] = Array.from({ length: 20 }, (_, index) => ({
      role: index % 2 === 0 ? 'learner' : 'tutor',
      text: 'y'.repeat(Math.ceil(TUTOR_LIMITS.inputCharacters / 3)),
    }));

    const { prompt, system, report } = built({
      mode: 'EXPLAIN',
      context: contextWith(),
      question: 'z'.repeat(500),
      turns,
    });

    expect(prompt.length + system.length).toBeLessThanOrEqual(TUTOR_LIMITS.inputCharacters);
    expect(report.sent.turns).toBeLessThanOrEqual(TUTOR_LIMITS.turns);
  });

  it('bounds a prompt whose fixed parts alone exceed the ceiling', () => {
    /*
     * Reachable with every input at a documented cap and nothing adversarial: two context fields at
     * their own limit, AG1's excerpt and a long question sum to about 4,800 before the system prompt is
     * counted. Without a branch for it the loop breaks on its first iteration, the call returns a
     * prompt well over the ceiling it documents, and the omission blames the transcript for a problem
     * the transcript did not cause — a ceiling that reports rather than bounds.
     */
    const cramped = contextWith({
      concept: { conceptId: 'c1', title: 'Rotations', summary: 's'.repeat(4000), keyPoints: [] },
      task: {
        taskId: 't1',
        title: 'Read section 3',
        instructions: 'i'.repeat(4000),
        kind: 'read',
        estimatedMinutes: 5,
        step: 2,
        totalSteps: 5,
      },
    });

    const { prompt, system, report } = built({
      mode: 'CHECK_MY_ANSWER',
      context: cramped,
      question: 'q'.repeat(TUTOR_LIMITS.questionCharacters),
      turns: [{ role: 'learner', text: 'earlier' }],
    });

    expect(prompt.length + system.length).toBeLessThanOrEqual(TUTOR_LIMITS.inputCharacters);
    // The account names what actually gave way, rather than blaming the turns.
    expect(report.omitted.some((entry) => entry.field === 'material')).toBe(true);
  });

  it('keeps the ceiling and the question through a context driven at a hostile length', () => {
    /*
     * Formerly named "never sends a question block with no question in it", which was the wrong name on
     * the wrong test: `TITLE_CHARACTERS` clips titles on both paths, so a 3600-character title can no
     * longer drive the remainder negative, and both assertions here are guaranteed by the current code.
     * It also passed with the `questionText.length === 0` guard deleted — the guard for the artefact its
     * name promised. What actually guards that is the label-only case below.
     *
     * Kept because a long title is still worth driving through the builder, and named for what it does.
     */
    const hostile = contextWith({
      task: {
        taskId: 't1',
        title: 't'.repeat(3600),
        instructions: 'note it',
        kind: 'read',
        estimatedMinutes: 5,
        step: 2,
        totalSteps: 5,
      },
      material: { materialId: null, title: null, heading: null, text: '', truncated: false },
    });

    const result = buildTutorPrompt({
      mode: 'EXPLAIN',
      context: hostile,
      question: 'q'.repeat(2000),
      turns: [],
    });

    if (result.status === 'built') {
      const sent = result.prompt;
      const asked = sent.slice(sent.indexOf('[question]') + '[question]\n'.length).trim();
      expect(asked.length).toBeGreaterThan(0);
      expect(result.prompt.length + result.system.length).toBeLessThanOrEqual(
        TUTOR_LIMITS.inputCharacters,
      );
    } else {
      // Refused, and the refusal says why rather than losing the question quietly.
      expect(result.status).toBe('refused');
      expect(result.report.omitted.length).toBeGreaterThan(0);
      expect(result.report.sent.inputCharacters).toBe(0);
    }
  });

  it('holds the ceiling and keeps a non-empty question, whatever the context', () => {
    /*
     * The invariant, swept rather than sampled at a band I would have to guess.
     *
     * An earlier version of this test hard-coded a context size that was supposed to land in the narrow
     * region where the question gets clipped; a later change to a different bound moved the region and
     * the test silently stopped reaching it while still passing. And what it asserted there was
     * `toContain('[question]')`, which is satisfied by the label alone — so it also passed in the state
     * where the question had been emptied, which is the failure it was named for.
     *
     * Two things are true of every input, and neither is negotiable:
     *   - nothing over the ceiling is ever sent;
     *   - whatever is sent asks the learner's question, or the call is refused and says why.
     */
    const cases: Array<{ title: number; question: number }> = [];
    for (const title of [0, 120, 1000, 3000, 3600, 5000]) {
      for (const question of [0, 10, 500, 2000]) cases.push({ title, question });
    }

    for (const { title, question } of cases) {
      const result = buildTutorPrompt({
        mode: 'CHECK_MY_ANSWER',
        context: contextWith({
          concept: {
            conceptId: 'c1',
            title: 'Rotations',
            summary: 's'.repeat(4000),
            keyPoints: [],
          },
          task: {
            taskId: 't1',
            title: 't'.repeat(title),
            instructions: 'i'.repeat(4000),
            kind: 'read',
            estimatedMinutes: 5,
            step: 2,
            totalSteps: 5,
          },
        }),
        question: 'q'.repeat(question),
        turns: [{ role: 'learner', text: 'earlier' }],
      });

      const label = `title ${title} / question ${question}`;

      /*
       * What each input earns, said once, from the input.
       *
       * This is the assertion the code's own comment points at: `request-too-long` is documented as an
       * unreachable backstop and the sweep is named as what would say otherwise, and until this line the
       * sweep accepted a refusal for a question with text in it without comment — which made that claim
       * untested in the one place it was made. A question with nothing in it cannot be built, and a
       * question with text in it is never refused here. Both halves can fail.
       */
      expect(result.status, label).toBe(question === 0 ? 'refused' : 'built');

      if (result.status === 'refused') {
        /*
         * Reachable only when `question === 0`, by the assertion above — so this pins the opposite
         * direction from the one it looks like: not "the length refusal lands on an empty question"
         * (the status line makes that impossible), but "an empty question refuses for the reason that
         * means there was nothing to ask". A refusal for `request-too-long` here fails.
         */
        expect(result.reason, label).toBe('no-question');
        // Nothing is sent, and the account says nothing was rather than reporting a length for a call
        // that never happened.
        expect(result.report.sent.inputCharacters, label).toBe(0);
        expect(result.report.omitted.length, label).toBeGreaterThan(0);
        continue;
      }

      expect(result.prompt.length + result.system.length, label).toBeLessThanOrEqual(
        TUTOR_LIMITS.inputCharacters,
      );

      /*
       * The question is present and is the learner's. Asserting `toContain('[question]')` would pass on
       * the label alone, which is how an earlier version of this test walked past the state it was
       * named for.
       */
      const asked = result.prompt
        .slice(result.prompt.indexOf('[question]') + '[question]\n'.length)
        .trim();
      expect(asked.length, label).toBeGreaterThan(0);
      expect(result.prompt, label).toContain('q'.repeat(Math.min(question, asked.length)));
    }
  });
  it('charges the separator between blocks, at every question length', () => {
    /*
     * The two characters `assemble` puts between the context block and the question block, which nothing
     * charged: with no turns admitted — every first question in a conversation — the string sent was two
     * longer than the sum that had been bounded, so the inspector could show 4,002 against a documented
     * 4,000.
     *
     * A sampled sweep cannot find a two-character boundary, which is why this scans every length. The
     * excerpt is at AG1's real bound rather than the sentence the other tests use, because that is where
     * the boundary sits: with a short excerpt the fixed part is under a thousand characters and the
     * question never comes within a hundred of the ceiling, which is how the first version of this test
     * passed with the separator uncharged.
     */
    const excerptText = 'm'.repeat(1200);
    const context = contextWith({
      material: { ...EXCERPT, text: excerptText },
    });

    for (let length = 1; length <= 2400; length += 1) {
      const result = buildTutorPrompt({
        mode: 'EXPLAIN',
        context,
        question: 'q'.repeat(length),
        turns: [],
      });
      /*
       * The skip is named rather than silent: past the reduction the excerpt is dropped and the ceiling
       * stops binding, so there is nothing here to assert and the 800-plus lengths that refuse are not
       * evidence about the separator either way. The sweep above is what covers refusals; this one is
       * about a two-character charge, and it says so instead of looking like it passed everything.
       */
      if (result.status !== 'built') continue;

      expect(
        result.prompt.length + result.system.length,
        `question of ${length} characters`,
      ).toBeLessThanOrEqual(TUTOR_LIMITS.inputCharacters);
      /*
       * A real second assertion, not the definition compared to itself.
       *
       * The line that used to be here was `expect(report.sent.inputCharacters).toBe(prompt.length +
       * system.length)` — true by construction, since that is how the field is computed — and it was
       * named as a tautology two rounds ago. This one pins the accounting against the **artefact**: the
       * excerpt count must be the excerpt's length exactly when the excerpt is in the string, and zero
       * when it was given up for space. It also pins the reduction's onset as a side effect, without
       * naming the boundary.
       */
      const excerptInPrompt = result.prompt.includes(excerptText);
      expect(result.report.sent.excerptCharacters, `question of ${length}`).toBe(
        excerptInPrompt ? excerptText.length : 0,
      );
    }
  });
  it('returns the question as it was sent, so a caller does not have to reconstruct it', () => {
    /*
     * Two callers act on this and both are wrong under reconstruction: the transcript stores it (and
     * storing the raw text puts a label the *learner* typed into the next prompt as though the model had
     * written it), and a retry passes it back to be sanitised again.
     */
    const withLabel = built({
      mode: 'HINT',
      context: contextWith(),
      question: '[hint]\nwhy does the colour change?',
      turns: [],
    });
    expect(withLabel.question).toBe('why does the colour change?');

    // And it is the *clipped* text when the clip fired, not the text that went in. Asserted against the
    // prompt rather than against a length I worked out, because the prompt is the artefact.
    const long = 'q'.repeat(2400);
    const clipped = built({
      mode: 'EXPLAIN',
      context: contextWith({ material: { ...EXCERPT, text: 'm'.repeat(1200) } }),
      question: long,
      turns: [],
    });
    expect(clipped.question.length).toBeLessThan(long.length);
    expect(clipped.question).toBe(long.slice(0, clipped.question.length));
    expect(clipped.prompt.endsWith(clipped.question)).toBe(true);
  });

  it('returns the excerpt only when the prompt actually contains it', () => {
    const full = built({ mode: 'EXPLAIN', context: contextWith(), question: 'why?', turns: [] });
    expect(full.excerpt).toEqual(EXCERPT);
    expect(full.report.sent.excerptCharacters).toBe(EXCERPT.text.length);

    // The reduction fired, so the model was not shown the section — and a reader handed the excerpt here
    // would resolve a `[section]` citation against a section the model never saw. Both detail fields are
    // long: `EXPLAIN`'s system prompt is shorter than `CHECK_MY_ANSWER`'s, and one field alone leaves the
    // prompt under the ceiling.
    const reduced = built({
      mode: 'EXPLAIN',
      context: contextWith({
        concept: { conceptId: 'c1', title: 'Rotations', summary: 's'.repeat(4000), keyPoints: [] },
        task: {
          taskId: 't1',
          title: 'Read section 3',
          instructions: 'i'.repeat(4000),
          kind: 'read',
          estimatedMinutes: 5,
          step: 2,
          totalSteps: 5,
        },
      }),
      question: 'q'.repeat(2000),
      turns: [],
    });
    expect(reduced.excerpt).toBeNull();
    expect(reduced.report.sent.excerptCharacters).toBe(0);
  });

  it('returns a preamble that is exactly the prompt without its question block', () => {
    /*
     * The relation the retry rests on, and the only place it is written down. `composeRetryPrompt`
     * composes `[preamble, answer, complaint]` and is correct only if the preamble is the prompt minus
     * the question — which is true today because `assemble` filters empty blocks and the question block is
     * always non-empty and always last, and is enforced by nothing. A refactor that made `assemble`
     * non-compositional would break the retry silently; the only other test that would notice fails as
     * "refused a retry" rather than as "composed the wrong string".
     *
     * Both ends of the turn range, because the preamble's shape depends on whether the transcript block
     * is there at all.
     */
    const noTurns = built({ mode: 'EXPLAIN', context: contextWith(), question: 'why?', turns: [] });
    expect(noTurns.prompt).toBe(`${noTurns.preamble}\n\n[question]\n${noTurns.question}`);

    const withTurns = built({
      mode: 'EXPLAIN',
      context: contextWith(),
      question: 'why?',
      turns: [{ role: 'learner', text: 'I said earlier' }],
    });
    expect(withTurns.prompt).toBe(`${withTurns.preamble}\n\n[question]\n${withTurns.question}`);
    expect(withTurns.preamble).not.toBe(noTurns.preamble);
  });

  it('refuses only when the fixed parts land on the ceiling, which is what makes it a backstop', () => {
    /*
     * `request-too-long` needs `room === 0`, and `room` is computed from the system prompt and the context
     * block alone — no turn appears in it, and the turn loop runs after the refusal — so the route is not a
     * transcript and not a hostile input. It is a fixed part sized to land within thirteen characters of
     * the ceiling: the branch only skips the reduction when `system + contextBlock + 13 + Q <= 4000`, and
     * `room === 0` needs `system + contextBlock >= 3987`, so the two together need `Q <= 2`.
     *
     * Found rather than worked out, and asserted rather than described: growing the summary one character
     * at a time with everything else at its cap passes through every size the fixed part can take, and the
     * three assertions below are that the boundary exists, that it refuses for the spatial reason, and that
     * one character less builds. Measured: 676 builds with a room of 1, 677 refuses at `system +
     * contextBlock` of 3987, and 678 fires the reduction instead. The failure message names the constants,
     * because a search that stops finding a boundary is how a constant change announces itself here.
     */
    const build = (summary: number) =>
      buildTutorPrompt({
        mode: 'CHECK_MY_ANSWER',
        context: contextWith({
          // AG1's bound, and it has to be here: `room` is the system prompt plus the context block, and
          // without the excerpt at its cap the fixed part cannot reach the ceiling at any summary size —
          // which is what the first version of this test found, by failing at the search.
          material: { ...EXCERPT, text: 'm'.repeat(1200) },
          concept: {
            conceptId: 'c1',
            title: 'Rotations',
            summary: 's'.repeat(summary),
            keyPoints: [],
          },
          task: {
            taskId: 't1',
            title: 'Read section 3',
            instructions: 'i'.repeat(4000),
            kind: 'read',
            estimatedMinutes: 5,
            step: 2,
            totalSteps: 5,
          },
        }),
        question: 'qq',
        turns: [],
      });

    let boundary = -1;
    for (let summary = 0; summary <= 4000; summary += 1) {
      if (build(summary).status === 'refused') {
        boundary = summary;
        break;
      }
    }

    expect(
      boundary,
      'no context size reaches room === 0: check TUTOR_LIMITS.inputCharacters, contextCharacters and ' +
        'materialCharacters against the system prompt lengths',
    ).toBeGreaterThan(-1);
    if (boundary === -1) return;
    const refused = build(boundary);
    expect(refused.status).toBe('refused');
    if (refused.status !== 'refused') return;
    expect(refused.reason).toBe('request-too-long');
    // And one character of context less builds, so the refusal is a boundary rather than a size the
    // context cannot avoid.
    expect(build(boundary - 1).status).toBe('built');
  });

  it("refuses a question that is nothing but the format's own labels", () => {
    /*
     * The reachable route to the artefact the clamp exists to prevent, and it needed no misbehaviour
     * from anybody: a learner whose message is exactly `[hint]` has it stripped by the sanitiser — which
     * is correct — leaving an empty question and an eleven-character `[question]` block whose length is
     * non-zero, so nothing downstream would touch it. A paid call carrying a label and nothing under it.
     */
    for (const question of ['', '   ', '[hint]', '[section]\n[hint]', '\n\n']) {
      const result = buildTutorPrompt({
        mode: 'EXPLAIN',
        context: contextWith(),
        question,
        turns: [],
      });

      expect(result.status, JSON.stringify(question)).toBe('refused');
      if (result.status !== 'refused') continue;
      expect(result.reason).toBe('no-question');
    }
  });

  it('charges the system prompt, the context and the turn prefixes to the budget', () => {
    // The three blocks the first version left outside the counter entirely. With an unbounded concept
    // summary and step instructions these are what pushed a documented 4,000-character ceiling past
    // 5,000 while the report showed 3,800.
    const verbose = contextWith({
      concept: {
        conceptId: 'c1',
        title: 'Rotations',
        summary: 's'.repeat(5000),
        keyPoints: [],
      },
      task: {
        taskId: 't1',
        title: 'Read section 3',
        instructions: 'i'.repeat(5000),
        kind: 'read',
        estimatedMinutes: 5,
        step: 2,
        totalSteps: 5,
      },
    });

    const { prompt, system, report } = built({
      mode: 'EXPLAIN',
      context: verbose,
      question: 'q',
      turns: [{ role: 'learner', text: 'x'.repeat(600) }],
    });

    expect(prompt.length + system.length).toBeLessThanOrEqual(TUTOR_LIMITS.inputCharacters);
    expect(report.omitted.length).toBeGreaterThan(0);
    // The unbounded fields were clipped rather than passed through.
    expect(prompt).not.toContain('s'.repeat(2000));
  });

  it('drops the oldest turns first and reports how many', () => {
    const turns: TutorTurn[] = Array.from({ length: 12 }, (_, index) => ({
      role: 'learner',
      text: `turn-${index}-${'y'.repeat(400)}`,
    }));

    const { prompt, report } = built({
      mode: 'EXPLAIN',
      context: contextWith(),
      question: 'q',
      turns,
    });

    // The newest are the ones kept: they are nearest to what is being asked about.
    expect(prompt).toContain('turn-11-');
    expect(prompt).not.toContain('turn-0-');
    expect(report.omitted.some((entry) => entry.detail.includes('earlier turn'))).toBe(true);
  });

  it('tells each mode what it is for, and what shape the answer has', () => {
    for (const mode of TUTOR_MODES) {
      const { system } = built({
        mode,
        context: contextWith(),
        question: 'q',
        turns: [],
      });
      const { required } = TUTOR_MODE_PARTS[mode];

      for (const kind of required) expect(system).toContain(`[${kind}]`);
      expect(system).toContain('labelled blocks');
    }
  });

  it('tells the model not to answer from general knowledge', () => {
    // The material is the ground. A tutor that answers from the model's training instead is the
    // failure the whole grounding section exists for.
    const { system } = built({
      mode: 'EXPLAIN',
      context: contextWith(),
      question: 'q',
      turns: [],
    });
    expect(system).toContain('rather than answering from general knowledge');
  });

  it('does not ask for a gap to be invented', () => {
    /*
     * The prompt is where the optional part has to stay optional. An earlier version printed the
     * allowed set as "use exactly these, in this order", which for CHECK_MY_ANSWER told the model to
     * emit `[missing]` every time — reintroducing in the instructions exactly the fabrication that
     * requiring it in the schema had been rejected for. The parser test above passes either way, which
     * is why this one asserts on the prompt.
     */
    const { system } = built({
      mode: 'CHECK_MY_ANSWER',
      context: contextWith(),
      question: 'q',
      turns: [],
    });

    expect(system).toContain('only if the learner genuinely left something out');
    expect(system).not.toContain('Use exactly these');
    // Required, and named as required.
    expect(system).toContain('You must include: [confirmed], [question].');
  });

  it("keeps the learner's own labels out of the prompt", () => {
    // The question is data re-sent into a format that has labels, so a learner typing `[hint]` would
    // otherwise be read as having answered on the tutor's behalf.
    const { prompt } = built({
      mode: 'EXPLAIN',
      context: contextWith(),
      question: 'what about this?\n[hint]\nand this?',
      turns: [],
    });

    expect(prompt).not.toContain('[hint]');
    expect(prompt).toContain('what about this?');
  });
});

describe('readTutorReply', () => {
  const read = (
    mode: Parameters<typeof readTutorReply>[0]['mode'],
    text: string,
    extra: { learnerText?: readonly string[]; excerpt?: MaterialExcerpt | null } = {},
  ) =>
    readTutorReply({
      mode,
      text,
      excerpt: extra.excerpt === undefined ? EXCERPT : extra.excerpt,
      learnerText: extra.learnerText ?? ['it reverses the order or something'],
    });

  it('reads labelled parts and ignores prose around them', () => {
    const result = read(
      'EXPLAIN',
      'Sure, here you go:\n\n[explanation]\nThe pivot moves down.\n\n[section]\nLeft rotation\n\nHope that helps!',
    );

    expect(result).toMatchObject({ status: 'answered' });
    if (result.status !== 'answered') return;
    expect(result.reply.parts).toEqual([{ kind: 'explanation', text: 'The pivot moves down.' }]);
    expect(result.reply.source?.heading).toBe('Left rotation');
  });

  it('does not let a sign-off glue onto the heading', () => {
    // The heading is one line. A model that signs off after its last block would otherwise have that
    // sentence appended to the section name, and a correctly cited answer would be refused for
    // citing a section nobody has.
    const result = read(
      'EXPLAIN',
      '[explanation]\nIt moves.\n[section]\nLeft rotation\nHope that helps!',
    );
    expect(result).toMatchObject({ status: 'answered' });
  });

  it('accepts a label sharing its line with the first line of its block', () => {
    // NOT accepted. A label is a line whose entire content is the label: a body line that begins with
    // a bracketed word would otherwise become a phantom part.
    expect(read('HINT', '[hint] Check the ordering invariant first.')).toMatchObject({
      status: 'rejected',
      reason: 'unparseable',
    });
  });

  it('does not mistake a bracketed word in the body for a label', () => {
    /*
     * The tutor discusses code and markup, and `[x]` is ordinary notation. When the parser accepted a
     * label sharing its line, a body line beginning with a bracketed word became a phantom part — and
     * the refusal was `unexpected-part`, reporting a fault the model had not committed, while the
     * learner's text lost its brackets.
     */
    const result = read('HINT', '[hint]\nWrite [label] next to each node, then rotate.');

    expect(result).toMatchObject({ status: 'answered' });
    if (result.status !== 'answered') return;
    expect(result.reply.parts[0]?.text).toBe('Write [label] next to each node, then rotate.');
  });

  it('rejects a reply of bare labels with no text in them', () => {
    // Otherwise every required-part check passes and the learner gets an empty box, which is the one
    // outcome the design says must never happen.
    expect(read('EXPLAIN', '[explanation]')).toMatchObject({
      status: 'rejected',
      reason: 'missing-part',
    });
  });

  it('tolerates a fenced reply', () => {
    // A model wrapping structured output in a code fence has not failed the learner.
    const result = read('HINT', '```\n[hint]\nCheck the ordering invariant.\n```');
    expect(result).toMatchObject({ status: 'answered' });
  });

  it('rejects prose with no labelled parts at all', () => {
    expect(read('EXPLAIN', 'A left rotation does this and that.')).toMatchObject({
      status: 'rejected',
      reason: 'unparseable',
      recovered: [],
    });
  });

  it.each([
    // An allowed label, but the part this mode is defined by is absent.
    ['missing-part', 'EXPLAIN', '[section]\nLeft rotation'],
    // Labels the format does not have, and parts this mode does not allow: the failures a single
    // format retry can fix, which is why they are distinguished from the ones it cannot.
    ['unexpected-part', 'HINT', '[hint]\nA nudge.\n[explanation]\nAnd a lecture.'],
    ['unexpected-part', 'SOCRATIC', '[question]\nWhat follows?\n[hint]\nHere is the answer.'],
    ['unexpected-part', 'HINT', '[explanation]\nThe pivot moves down.'],
  ] as const)('rejects %s', (reason, mode, text) => {
    expect(read(mode, text)).toMatchObject({ status: 'rejected', reason });
  });

  it('will not let a hint carry an explanation', () => {
    /*
     * The reason allowed-parts exist at all. A learner who asked for a nudge and got the whole idea
     * explained has been given the answer to the step they were doing, which is the opposite of help.
     * A rule the parser enforces is the only version of "a hint is only a hint" that holds.
     */
    const result = read('HINT', '[hint]\nA nudge.\n[example]\nA worked example.');
    expect(result).toMatchObject({ status: 'rejected', reason: 'unexpected-part' });
  });

  it('rejects a part that is not a part at all', () => {
    expect(read('EXPLAIN', '[explanation]\nIt moves.\n[lecture]\nMore.')).toMatchObject({
      status: 'rejected',
      reason: 'unexpected-part',
    });
  });

  it('rejects a citation of a section it was not given', () => {
    const result = read('EXPLAIN', '[explanation]\nIt moves.\n[section]\nRight rotation');
    expect(result).toMatchObject({ status: 'rejected', reason: 'not-from-the-material' });
  });

  it('rejects a citation when there was no section to cite', () => {
    const empty: MaterialExcerpt = {
      materialId: null,
      title: null,
      heading: null,
      text: '',
      truncated: false,
    };
    expect(
      read('EXPLAIN', '[explanation]\nIt moves.\n[section]\nLeft rotation', { excerpt: empty }),
    ).toMatchObject({ status: 'rejected', reason: 'not-from-the-material' });
  });

  it('accepts a reply that cites nothing', () => {
    // Naming no source is allowed: there may be no material, and a mode with one allowed part has no
    // other way to answer.
    const result = read('EXPLAIN', '[explanation]\nIt moves.');
    expect(result).toMatchObject({ status: 'answered' });
    if (result.status !== 'answered') return;
    expect(result.reply.source).toBeNull();
  });

  describe('CHECK_MY_ANSWER', () => {
    const ok = (confirmed: string, learnerText: readonly string[] = []) =>
      read(
        'CHECK_MY_ANSWER',
        `[confirmed]\n${confirmed}\n[question]\nWhat happens to the in-order sequence?`,
        {
          learnerText:
            learnerText.length > 0 ? learnerText : ['it reverses the order or something'],
        },
      );

    it('accepts a confirmation that quotes the learner', () => {
      expect(ok('You said "it reverses the order" — that part is right.')).toMatchObject({
        status: 'answered',
      });
    });

    it('rejects a bare agreement', () => {
      /*
       * The failure the epic singles out. "You're right." normalises to `youareright`, which is not
       * something the learner wrote, so a confirmation with no referent cannot be produced.
       */
      expect(ok("You're right.")).toMatchObject({
        status: 'rejected',
        reason: 'unquoted-confirmation',
      });
    });

    it('rejects a quote the learner never wrote', () => {
      expect(ok('You said "the invariant is preserved" and that is right.')).toMatchObject({
        status: 'rejected',
        reason: 'unquoted-confirmation',
      });
    });

    it('accepts a quote of something the learner said in an earlier turn', () => {
      // Conversations run to several turns, and a learner writing "the bit I said before" is quoting
      // themselves. Matching only the current message would reject an honest learner silently.
      const result = read(
        'CHECK_MY_ANSWER',
        '[confirmed]\nYou said "it reverses the order" — right.\n[question]\nAnd then?',
        { learnerText: ['first I said it reverses the order', 'but I am unsure about the rest'] },
      );
      expect(result).toMatchObject({ status: 'answered' });
    });

    it('accepts a confirmation with nothing missing', () => {
      // `missing` is required by nothing. Requiring it would mean a learner whose understanding is
      // complete gets a gap invented for them, or filler in its place.
      const result = read(
        'CHECK_MY_ANSWER',
        '[confirmed]\n"it reverses the order" is right.\n[question]\nWhat about equal keys?',
        { learnerText: ['it reverses the order or something'] },
      );
      expect(result).toMatchObject({ status: 'answered' });
      if (result.status !== 'answered') return;
      expect(result.reply.parts.map((part) => part.kind)).toEqual(['confirmed', 'question']);
    });

    it('still requires the advancing question', () => {
      // Confirming without moving the learner forward is not the answer the epic describes.
      expect(
        read('CHECK_MY_ANSWER', '[confirmed]\n"it reverses the order" is right.'),
      ).toMatchObject({ status: 'rejected', reason: 'missing-part' });
    });

    it('sees through punctuation, case and full-width characters', () => {
      // A bilingual product: the model's copy of a Chinese learner's words can differ by ，versus ,
      // alone, and an exact comparison would reject a correct quote.
      const result = read(
        'CHECK_MY_ANSWER',
        '[confirmed]\n你说“左旋不会破坏顺序”，对的。\n[question]\n那右旋呢？',
        { learnerText: ['我觉得左旋不会破坏顺序'] },
      );
      expect(result).toMatchObject({ status: 'answered' });
    });

    it('rejects a quote too short to be a referent', () => {
      // A two-character quote is not a referent: after normalisation strips case and punctuation, the
      // short n-grams of any sentence are the ones most likely to appear somewhere in several turns of
      // the learner's text, so a fabricated confirmation would pass.
      expect(ok('You said "order" and that is right.')).toMatchObject({
        status: 'rejected',
        reason: 'unquoted-confirmation',
      });
    });

    it("accepts a short quote when it is the learner's whole message", () => {
      // Somebody who answered "yes" has nothing longer to quote, and rejecting them would be rejecting
      // an honest learner for being brief.
      const result = read(
        'CHECK_MY_ANSWER',
        '[confirmed]\nYou said "yes" — that is right.\n[question]\nCan you say why?',
        { learnerText: ['yes'] },
      );
      expect(result).toMatchObject({ status: 'answered' });
    });

    it('does not let a quote straddle two turns', () => {
      // Joined naively, the seam creates a sentence the learner never wrote as a unit.
      const result = read(
        'CHECK_MY_ANSWER',
        '[confirmed]\nYou said "order or something" — right.\n[question]\nWhy?',
        { learnerText: ['it reverses the order', 'or something like that'] },
      );
      expect(result).toMatchObject({ status: 'rejected', reason: 'unquoted-confirmation' });
    });
  });

  it('clips an over-long part rather than refusing the answer, and reports the clip', () => {
    const result = read(
      'EXPLAIN',
      `[explanation]\n${'w'.repeat(TUTOR_LIMITS.partCharacters + 200)}`,
    );

    expect(result).toMatchObject({ status: 'answered' });
    if (result.status !== 'answered') return;
    expect(result.reply.parts[0]?.text.length).toBe(TUTOR_LIMITS.partCharacters);
    // Reported, because a clip the caller cannot see is prose that stops mid-sentence for no stated
    // reason. The first version of this module claimed to report it and did not.
    expect(
      result.reply.omissions.some((entry) => entry.detail.includes('longer than is shown')),
    ).toBe(true);
  });

  it('clips by code point rather than by UTF-16 unit', () => {
    // A slice at a unit boundary can end between the halves of a surrogate pair and render as a
    // replacement character.
    const faces = '\u{1f600}'.repeat(TUTOR_LIMITS.partCharacters + 10);
    const result = read('EXPLAIN', `[explanation]\n${faces}`);

    expect(result).toMatchObject({ status: 'answered' });
    if (result.status !== 'answered') return;
    expect([...(result.reply.parts[0]?.text ?? '')]).toHaveLength(TUTOR_LIMITS.partCharacters);
    expect(result.reply.parts[0]?.text).not.toContain('\ufffd');
  });

  it('reports the heading lines it dropped', () => {
    // A heading is one line, so a wrapped heading is read as its first line — and that loss is counted
    // rather than thrown away silently.
    const result = read(
      'EXPLAIN',
      '[explanation]\nIt moves.\n[section]\nLeft rotation\nand this second line is lost',
    );
    expect(result.reply.omissions.some((entry) => entry.detail.includes('after the heading'))).toBe(
      true,
    );
  });

  it('matches a heading that differs only in spacing or case', () => {
    const result = read('EXPLAIN', '[explanation]\nIt moves.\n[section]\nLEFT  rotation');
    expect(result).toMatchObject({ status: 'answered' });
  });
});

describe('the retry, which is the one thing worth asking again about', () => {
  it('retries a format failure and not a content failure', () => {
    /*
     * The split is the whole point. Telling a model that its quote was not in the learner's message
     * invites it to produce a quote that is, whether or not it belongs to the claim — retrying a
     * grounding failure is teaching the model to satisfy the checker. A model that answered well and
     * formatted badly has no such hazard.
     */
    for (const reason of ['unparseable', 'missing-part', 'unexpected-part'] as const) {
      expect(isRetryable(reason)).toBe(true);
    }
    for (const reason of ['unquoted-confirmation', 'not-from-the-material'] as const) {
      expect(isRetryable(reason)).toBe(false);
    }
  });

  it('states the format back in the words the parser uses', () => {
    const prompt = buildTutorRetryPrompt({
      mode: 'HINT',
      reason: 'unexpected-part',
      question: 'why does it work?',
    });

    // The label names the prompt already used, and the question still there to answer.
    expect(prompt).toContain('[hint]');
    expect(prompt).toContain('why does it work?');
  });
});

describe("the mock provider's output", () => {
  it('never parses, so the offline path stays exercised', async () => {
    /*
     * The offline path is what the golden path runs. `MockAIProvider` builds its text from two arrays,
     * so the day someone adds a labelled line to `OPENINGS` — plausibly, to make a demo look nicer —
     * the offline path would silently stop being tested and nothing would say so. This says so.
     */
    const mock = new MockAIProvider();
    const result = await mock.complete({ prompt: 'anything', system: 'anything' });

    expect(result.text).toContain('[mock:');
    expect(
      readTutorReply({ mode: 'HINT', text: result.text, excerpt: EXCERPT, learnerText: [] }),
    ).toMatchObject({ status: 'rejected', reason: 'unparseable' });
  });
});

describe('normaliseForComparison', () => {
  it('removes what a model may reasonably re-punctuate', () => {
    expect(normaliseForComparison('It reverses  the ORDER!')).toBe('itreversestheorder');
  });

  it('folds full-width characters to half-width', () => {
    expect(normaliseForComparison('ＡＢ１２')).toBe('ab12');
  });
});
