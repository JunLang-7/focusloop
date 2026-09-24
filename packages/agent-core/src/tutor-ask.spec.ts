import { describe, expect, it } from 'vitest';
import {
  TUTOR_LIMITS,
  type AgentContext,
  type MaterialExcerpt,
  type TutorPart,
} from '@focusloop/shared-types';
import { readTutorReply } from './tutor';
import {
  TutorTranscript,
  composeRetryPrompt,
  fallbackFor,
  formatAnswer,
  providerInfo,
  unsentReport,
} from './tutor-ask';

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

function exchange(index: number): { question: string; answer: string } {
  return { question: `question ${index}`, answer: `[hint]\nanswer ${index}` };
}

describe('TutorTranscript', () => {
  it('keeps at most the number of turns the contract names, dropping the oldest', () => {
    const transcript = new TutorTranscript();
    for (let index = 1; index <= TUTOR_LIMITS.turns / 2; index += 1) {
      expect(
        transcript.record('s1', exchange(index)),
        `before the window is full: ${index}`,
      ).toEqual([]);
    }
    expect(transcript.list('s1')).toHaveLength(TUTOR_LIMITS.turns);

    const omitted = transcript.record('s1', exchange(5));

    const turns = transcript.list('s1');
    expect(turns).toHaveLength(TUTOR_LIMITS.turns);
    // The window moved by exactly one exchange, and it opens on a learner turn rather than on the tail
    // of an answer whose question has been dropped.
    expect(turns[0]).toEqual({ role: 'learner', text: 'question 2' });
    expect(turns.at(-1)).toEqual({ role: 'tutor', text: '[hint]\nanswer 5' });
    expect(omitted).toHaveLength(1);
    expect(omitted[0]?.detail).toContain('2 older turns');
  });

  it('reports a clipped question and stores exactly the bound', () => {
    const transcript = new TutorTranscript();
    const omitted = transcript.record('s1', { question: 'q'.repeat(2001), answer: 'a' });

    expect(omitted.some((entry) => entry.detail.includes('question was longer'))).toBe(true);
    expect(transcript.list('s1')[0]?.text).toHaveLength(TUTOR_LIMITS.questionCharacters);
  });

  it('reports a clipped answer and stores exactly the bound', () => {
    const transcript = new TutorTranscript();
    const omitted = transcript.record('s1', { question: 'q', answer: 'a'.repeat(601) });

    expect(omitted.some((entry) => entry.detail.includes('answer was longer'))).toBe(true);
    expect(transcript.list('s1')[1]?.text).toHaveLength(TUTOR_LIMITS.answerCharacters);
  });

  it('counts code points rather than code units, so a clip cannot halve a surrogate pair', () => {
    const transcript = new TutorTranscript();
    // Every astral character is two UTF-16 units, so a code-unit clip would leave 1000 of them plus a
    // lone surrogate — half a character, which renders as a replacement box and reaches the model.
    transcript.record('s1', { question: '😀'.repeat(2001), answer: 'a' });

    const stored = transcript.list('s1')[0]?.text ?? '';
    expect(stored).toBe('😀'.repeat(TUTOR_LIMITS.questionCharacters));
  });

  it('keeps sessions apart, and forgets one without touching the other', () => {
    const transcript = new TutorTranscript();
    transcript.record('s1', exchange(1));
    transcript.record('s2', exchange(2));

    expect(transcript.list('s1')).toHaveLength(2);
    expect(transcript.list('s2')).toHaveLength(2);
    expect(transcript.size()).toBe(2);

    transcript.forget('s1');

    expect(transcript.list('s1')).toEqual([]);
    expect(transcript.list('s2')).toHaveLength(2);
    expect(transcript.size()).toBe(1);
  });

  it('returns only the learner turns, oldest first, from what is still retained', () => {
    const transcript = new TutorTranscript();
    for (let index = 1; index <= 5; index += 1) transcript.record('s1', exchange(index));

    // Turn 1 is out of the window, so it is not offered to the quote check — a confirmation quoting a
    // turn the model can no longer see would otherwise be accepted against text that is not sent.
    expect(transcript.learnerText('s1')).toEqual([
      'question 2',
      'question 3',
      'question 4',
      'question 5',
    ]);
  });
});

describe('formatAnswer', () => {
  it('writes an answer the reader accepts back, which is what makes it usable as a transcript turn', () => {
    const parts: readonly TutorPart[] = [
      { kind: 'confirmed', text: 'You wrote "the order does not change"' },
      { kind: 'question', text: 'What happens to the parent pointer when it does?' },
    ];
    const learnerText = ['I think the order does not change when you rotate'];

    const reading = readTutorReply({
      mode: 'CHECK_MY_ANSWER',
      text: formatAnswer(parts),
      excerpt: EXCERPT,
      learnerText,
    });

    expect(reading.status).toBe('answered');
    if (reading.status !== 'answered') return;
    expect(reading.reply.parts).toEqual(parts);
  });

  it('omits nothing between parts, so a two-part answer does not read as one', () => {
    const text = formatAnswer([
      { kind: 'missing', text: 'a' },
      { kind: 'question', text: 'b' },
    ]);

    expect(text).toBe('[missing]\na\n\n[question]\nb');
  });
});

describe('composeRetryPrompt', () => {
  it('carries the preamble, the answer being redone and the complaint, in that order', () => {
    const result = composeRetryPrompt({
      system: 'S',
      preamble: 'P',
      answer: 'A',
      retry: 'R',
    });

    expect(result).toMatchObject({ status: 'fits', prompt: 'P\n\nA\n\nR' });
    // And the size it checked comes back with it, so the caller does not recompute the one number this
    // decided on.
    expect(result.status === 'fits' ? result.inputCharacters : null).toBe('P\n\nA\n\nR'.length + 1);
  });

  it('injects nothing of its own between the blocks it is given', () => {
    /*
     * Named for what it can observe. `composeRetryPrompt` takes the preamble as an input, so no unit test
     * of it can see *which* field the caller passed — the engine-level test is where that is pinned. What
     * this pins is that the composition adds no second question block of its own.
     */
    const result = composeRetryPrompt({
      system: 'S',
      preamble: 'the context block',
      answer: 'A',
      retry: '[question]\nwhy?',
    });

    expect(result.status).toBe('fits');
    if (result.status !== 'fits') return;
    expect(result.prompt.split('[question]')).toHaveLength(2);
  });

  it('clips the answer being redone to what the transcript would keep of it', () => {
    const result = composeRetryPrompt({
      system: 'S',
      preamble: 'P',
      answer: 'a'.repeat(1000),
      retry: 'R',
    });

    expect(result.status).toBe('fits');
    if (result.status !== 'fits') return;
    expect(result.prompt).toContain('a'.repeat(TUTOR_LIMITS.answerCharacters));
    expect(result.prompt).not.toContain('a'.repeat(TUTOR_LIMITS.answerCharacters + 1));
  });

  it('refuses rather than sending a second call over the ceiling', () => {
    // The preamble is the context block and the transcript, and it can fill the budget without the
    // question in it. This is the case `buildTutorRetryPrompt` cannot see: it does not know what it is
    // being appended to.
    const system = 's'.repeat(1000);
    const result = composeRetryPrompt({
      system,
      preamble: 'p'.repeat(TUTOR_LIMITS.inputCharacters - system.length - 1),
      answer: 'a',
      retry: 'r',
    });

    expect(result).toEqual({ status: 'does-not-fit' });
  });

  it('fits at exactly the ceiling', () => {
    const system = 's'.repeat(1000);
    const answer = 'a';
    const retry = 'r';
    const room = TUTOR_LIMITS.inputCharacters - system.length - answer.length - retry.length - 4;
    const preamble = 'p'.repeat(room);

    const result = composeRetryPrompt({ system, preamble, answer, retry });

    // `4` is the two `\n\n` joins. Equal is allowed and one character more is not, so the boundary is
    // pinned rather than approached — a `>=` here would silently drop the retry one character early.
    expect(result.status).toBe('fits');
    if (result.status !== 'fits') return;
    expect(result.prompt.length + system.length).toBe(TUTOR_LIMITS.inputCharacters);

    const over = composeRetryPrompt({ system, preamble: `${preamble}p`, answer, retry });
    expect(over.status).toBe('does-not-fit');
  });
});

describe('unsentReport', () => {
  it('zeroes what was sent and keeps what was left out', () => {
    const report = {
      sent: { turns: 3, inputCharacters: 3027, excerptCharacters: 54 },
      omitted: [{ field: 'material' as const, detail: 'the rest of the material' }],
    };

    expect(unsentReport(report)).toEqual({
      sent: { turns: 0, inputCharacters: 0, excerptCharacters: 0 },
      omitted: report.omitted,
    });
  });
});

describe('providerInfo', () => {
  it('reports the provider and whether we fell back', () => {
    const failure = { reason: 'offline' as const, message: 'no network', providerId: 'deepseek' };
    expect(providerInfo({ id: 'deepseek', model: 'deepseek-chat' }, true, failure)).toEqual({
      id: 'deepseek',
      model: 'deepseek-chat',
      degraded: true,
      failure,
    });
  });
});

describe('fallbackFor', () => {
  it('carries a closed reason code, the step and the material the app already knows', () => {
    expect(fallbackFor('no-model', contextWith())).toEqual({
      reason: 'no-model',
      excerpt: EXCERPT,
      conceptTitle: 'Rotations',
      taskTitle: 'Read section 3',
      instructions: 'Read it and note the invariant',
    });
  });

  it('carries an empty excerpt rather than a missing one when there is no context', () => {
    // `excerpt` is non-nullable in the contract on purpose: the states that need a fallback are exactly
    // the ones where there is no section, so a second absent value would be a second thing to branch on
    // in the screen that most needs to be simple.
    const fallback = fallbackFor('no-question', null);

    expect(fallback.excerpt).toEqual({
      materialId: null,
      title: null,
      heading: null,
      text: '',
      truncated: false,
    });
    expect(fallback.conceptTitle).toBeNull();
    expect(fallback.taskTitle).toBeNull();
    expect(fallback.instructions).toBeNull();
    expect(fallback.reason).toBe('no-question');
  });
});
