import { describe, expect, it } from 'vitest';
import {
  TUTOR_MODES,
  TUTOR_PART_KINDS,
  DOMAIN_MESSAGE_KEYS,
  type MaterialExcerpt,
  type SessionSnapshot,
  type TutorAnswer,
  type TutorOutcome,
} from '@focusloop/shared-types';
import en from './i18n/messages.en';
import { zh } from './i18n/messages.zh';
import {
  TUTOR_MODE_KEYS,
  TUTOR_MODE_ORDER,
  TUTOR_PART_KEYS,
  TUTOR_FALLBACK_KEYS,
  buildTutorView,
  tutorAnswerApplies,
  tutorEntryVisible,
  tutorPlaceholderKey,
  tutorSourceLine,
} from './tutor-view';

const EXCERPT: MaterialExcerpt = {
  materialId: 'm1',
  title: 'Rotations',
  heading: 'Left rotation',
  text: 'A left rotation moves the pivot down and to the right.',
  truncated: false,
};

const EMPTY_EXCERPT: MaterialExcerpt = {
  materialId: null,
  title: null,
  heading: null,
  text: '',
  truncated: false,
};

function snapshotWith(patch: Partial<SessionSnapshot['session']> = {}): SessionSnapshot {
  return {
    session: {
      id: 's1',
      courseId: 'c1',
      startedAt: '2026-01-01T00:00:00.000Z',
      state: 'FOCUSED',
      currentTaskId: 't1',
      completedTaskIds: [],
      updatedAt: '2026-01-01T00:00:00.000Z',
      ...patch,
    },
    progress: {
      sessionId: 's1',
      totalTasks: 5,
      completedTasks: 1,
      completionRatio: 0.2,
      elapsedMs: 1000,
    },
    courseTitle: 'Rotations',
    checkpoints: [],
  };
}

function answer(
  outcome: TutorOutcome,
  omitted: TutorAnswer['context']['omitted'] = [],
): TutorAnswer {
  return {
    outcome,
    context: { sent: { turns: 0, inputCharacters: 0, excerptCharacters: 0 }, omitted },
  };
}

describe('the translation keys the tutor owns', () => {
  it('maps every fallback code to a distinct English and Chinese sentence', () => {
    const reasons = Object.keys(TUTOR_FALLBACK_KEYS) as (keyof typeof TUTOR_FALLBACK_KEYS)[];
    const keys = reasons.map((reason) => TUTOR_FALLBACK_KEYS[reason]);

    expect(new Set(keys).size).toBe(reasons.length);
    expect(DOMAIN_MESSAGE_KEYS).toEqual(expect.arrayContaining(keys));
    for (const key of keys) {
      expect(en[key].trim()).not.toBe('');
      expect(zh[key].trim()).not.toBe('');
      expect(zh[key]).not.toBe(en[key]);
    }
  });

  it('names every mode in the contract, exactly once', () => {
    /*
     * Asserted against `TUTOR_MODES` rather than against a list written here, so a seventh mode added to
     * the contract fails this until somebody decides how it reads. The distinctness check is the half that
     * catches a copy-paste: two modes sharing a key is a panel with the same words on two buttons, and
     * `Record<TutorMode, MessageKey>` cannot see it because both values are valid keys.
     */
    expect([...TUTOR_MODE_ORDER].sort()).toEqual([...TUTOR_MODES].sort());
    const keys = TUTOR_MODE_ORDER.map((mode) => TUTOR_MODE_KEYS[mode]);
    expect(new Set(keys).size).toBe(TUTOR_MODES.length);
  });

  it('names every part kind in the contract, exactly once', () => {
    const keys = TUTOR_PART_KINDS.map((kind) => TUTOR_PART_KEYS[kind]);
    expect(new Set(keys).size).toBe(TUTOR_PART_KINDS.length);
  });

  /*
   * There was a third test here asserting `Object.hasOwn(en, key)` for every key above, and it could not
   * fail: `MessageKey` *is* `keyof typeof en`, so a key deleted from the dictionary changes the type in
   * the same edit and every reference stops compiling; and a key that somehow reached the service anyway
   * renders as the key itself (`t` falls through to the key, not to `undefined`) rather than as nothing.
   * The cross-dictionary half is a `Record<MessageKey, string>` on the Chinese dictionary, so a missing
   * translation is a build error too. What the distinctness checks above catch is the failure the type
   * system cannot: two modes pointing at one key.
   */
});

describe('tutorEntryVisible', () => {
  it('is offered while a session is running and a step is open', () => {
    expect(tutorEntryVisible(snapshotWith(), 't1')).toBe(true);
  });

  it('is not offered without a session, or without a step', () => {
    expect(tutorEntryVisible(null, 't1')).toBe(false);
    expect(tutorEntryVisible(snapshotWith(), null)).toBe(false);
  });

  it('is not offered on a session that has ended', () => {
    /*
     * The rule has two copies and this is the one that matters for what is shown: the main process throws
     * `EngineError('session-ended')`, but that code does not survive the bridge, so a panel that branched
     * on it would branch on `undefined`. Both sides refuse; only this side can decide what to render.
     */
    expect(tutorEntryVisible(snapshotWith({ endedAt: '2026-01-01T01:00:00.000Z' }), 't1')).toBe(
      false,
    );
  });
});

describe('buildTutorView', () => {
  it('labels each part of an answer and carries the source', () => {
    const view = buildTutorView(
      answer({
        status: 'answered',
        reply: {
          mode: 'CHECK_MY_ANSWER',
          parts: [
            { kind: 'confirmed', text: 'You wrote "the order does not change"' },
            { kind: 'question', text: 'What happens to the parent pointer?' },
          ],
          source: EXCERPT,
          omissions: [],
        },
      }),
    );

    expect(view.status).toBe('answered');
    if (view.status !== 'answered') return;
    expect(view.parts).toEqual([
      {
        kind: 'confirmed',
        key: TUTOR_PART_KEYS.confirmed,
        text: 'You wrote "the order does not change"',
      },
      {
        kind: 'question',
        key: TUTOR_PART_KEYS.question,
        text: 'What happens to the parent pointer?',
      },
    ]);
    expect(view.source).toEqual(EXCERPT);
    // The mode comes from the reply, not from whatever the panel's buttons currently say: the learner can
    // change the mode after an answer arrives, and the answer is about the mode it was asked in.
    expect(view.mode).toBe('CHECK_MY_ANSWER');
  });

  it('carries the fallback for a rejection, with the step and the instructions attached', () => {
    const view = buildTutorView(
      answer({
        status: 'rejected',
        reason: 'unparseable',
        provider: { id: 'scripted', model: 'm', degraded: false, failure: null },
        fallback: {
          reason: 'unparseable',
          excerpt: EXCERPT,
          conceptTitle: 'Rotations',
          taskTitle: 'Read section 3',
          instructions: 'Read it and note the invariant',
        },
      }),
    );

    expect(view.status).toBe('no-answer');
    if (view.status !== 'no-answer') return;
    expect(view.reasonKey).toBe('tutor.rejection.unparseable');
    expect(view.conceptTitle).toBe('Rotations');
    expect(view.taskTitle).toBe('Read section 3');
    expect(view.instructions).toBe('Read it and note the invariant');
    expect(view.excerpt).toEqual(EXCERPT);
  });

  it('gives an unavailable model the same shape as a rejection', () => {
    const view = buildTutorView(
      answer({
        status: 'unavailable',
        reason: 'no-model',
        provider: { id: 'mock', model: 'mock', degraded: false, failure: null },
        fallback: {
          reason: 'no-model',
          excerpt: EMPTY_EXCERPT,
          conceptTitle: null,
          taskTitle: null,
          instructions: null,
        },
      }),
    );

    expect(view.status).toBe('no-answer');
    if (view.status !== 'no-answer') return;
    expect(view.reasonKey).toBe('tutor.unavailable.no-model');
    expect(view.excerpt).toEqual(EMPTY_EXCERPT);
    expect(view.conceptTitle).toBeNull();
  });

  it('reads what was left out from one place, on every outcome', () => {
    /*
     * The pin for the decision: `context.omitted` is where the engine puts *both* the prompt's omissions and
     * the reply's (`omitted: [...omissions, ...reply.omissions]` on the answered path), so reading
     * `reply.omissions` here as well would show each of them twice, and reading only `reply.omissions` would
     * show nothing at all on the two branches that have no reply. This asserts the source is the context,
     * by giving the reply an omission the context does not have and asserting it is *not* shown.
     */
    const view = buildTutorView(
      answer(
        {
          status: 'answered',
          reply: {
            mode: 'HINT',
            parts: [{ kind: 'hint', text: 'Look at the parent pointer.' }],
            source: null,
            omissions: [{ field: 'conversation', detail: 'the hint was cut short' }],
          },
        },
        [{ field: 'material', detail: 'the rest of the material was left out' }],
      ),
    );

    expect(view.status).toBe('answered');
    if (view.status !== 'answered') return;
    expect(view.leftOut).toEqual(['the rest of the material was left out']);
  });

  it('shows the omissions on a rejection too, which is the branch with no reply to read them from', () => {
    const view = buildTutorView(
      answer(
        {
          status: 'rejected',
          reason: 'missing-part',
          provider: { id: 'scripted', model: 'm', degraded: false, failure: null },
          fallback: {
            reason: 'missing-part',
            excerpt: EMPTY_EXCERPT,
            conceptTitle: null,
            taskTitle: null,
            instructions: null,
          },
        },
        [{ field: 'conversation', detail: '3 older turns were left out of the transcript' }],
      ),
    );

    expect(view.status).toBe('no-answer');
    if (view.status !== 'no-answer') return;
    expect(view.leftOut).toEqual(['3 older turns were left out of the transcript']);
  });
});

describe('tutorAnswerApplies', () => {
  it('keeps an answer while the step is the same', () => {
    expect(tutorAnswerApplies('t1', 't1')).toBe(true);
  });

  it('drops it when the step changes, and when there is no step any more', () => {
    // The panel is unmounted when the step changes, so this is the rule that stops the previous step's
    // answer appearing the first time the panel is opened on the next one.
    expect(tutorAnswerApplies('t1', 't2')).toBe(false);
    expect(tutorAnswerApplies('t1', null)).toBe(false);
    expect(tutorAnswerApplies(null, 't1')).toBe(false);
    expect(tutorAnswerApplies(null, null)).toBe(false);
  });
});

describe('tutorPlaceholderKey', () => {
  it('asks for an answer in the one mode that is not asking a question', () => {
    // `CHECK_MY_ANSWER` is the only mode whose required parts include a quotation of the learner, so it is
    // the only one where a box labelled "what do you want to ask" is prompting for the wrong thing.
    expect(tutorPlaceholderKey('CHECK_MY_ANSWER')).toBe('tutor.placeholder.answer');
  });

  it('asks for a question in every other mode, and before a mode is chosen', () => {
    for (const mode of TUTOR_MODE_ORDER) {
      if (mode === 'CHECK_MY_ANSWER') continue;
      expect(tutorPlaceholderKey(mode), mode).toBe('tutor.placeholder');
    }
    expect(tutorPlaceholderKey(null)).toBe('tutor.placeholder');
  });
});

describe('tutorSourceLine', () => {
  const t = (key: keyof typeof en): string => en[key];

  it('names the section an answer came from', () => {
    expect(tutorSourceLine(EXCERPT, t)).toBe(`${en['tutor.source']}: Left rotation`);
  });

  it('says so when an answer used no section, rather than showing nothing', () => {
    // The two states look identical on screen if this one renders as an empty string, and only one of them
    // means "this came from nowhere in particular".
    expect(tutorSourceLine(null, t)).toBe(en['tutor.sourceNone']);
  });

  it('falls back to the excerpt title for a source that has no heading', () => {
    expect(tutorSourceLine({ ...EXCERPT, heading: null }, t)).toBe(
      `${en['tutor.source']}: Rotations`,
    );
  });

  it('treats a source with neither as no source', () => {
    expect(tutorSourceLine({ ...EXCERPT, heading: null, title: null }, t)).toBe(
      en['tutor.sourceNone'],
    );
  });
});
