import { describe, expect, it } from 'vitest';
import {
  preferenceValueProblems,
  type LearnerPreferenceFor,
  type LearnerPreferenceScope,
} from './learner-preference';

/** One valid value per scope — the shapes AG6.2–6.4 will produce, argued into type here first. */
const VALID: Record<LearnerPreferenceScope, unknown> = {
  'task-size': { preferredStepMinutes: 2 },
  intervention: {
    welcomed: [{ action: 'HINT', count: 4 }],
    refused: [{ action: 'BREAK', count: 2 }],
  },
  explanation: { modes: [{ mode: 'EXAMPLE', count: 3 }] },
  resume: { style: 'brief' },
};

describe('preference values per scope (AG6.1)', () => {
  it.each(Object.keys(VALID) as LearnerPreferenceScope[])(
    'accepts the shaped value for %s',
    (scope) => {
      expect(preferenceValueProblems(scope, VALID[scope])).toEqual([]);
    },
  );

  it('rejects a value with a field its scope does not describe', () => {
    expect(
      preferenceValueProblems('task-size', { preferredStepMinutes: 2, comment: 'extra' }),
    ).not.toEqual([]);
    expect(preferenceValueProblems('resume', { style: 'brief', why: 'extra' })).not.toEqual([]);
  });

  it('bounds task size where a step stops being a step', () => {
    // 1–5 is AG4's accepted-step contract (ADAPTIVE_TASK_LIMITS); 15 is three of the largest —
    // past that, size is a plan question (AG4), not a number this store should hold.
    expect(preferenceValueProblems('task-size', { preferredStepMinutes: 1 })).toEqual([]);
    expect(preferenceValueProblems('task-size', { preferredStepMinutes: 15 })).toEqual([]);
    expect(preferenceValueProblems('task-size', { preferredStepMinutes: 0 })).not.toEqual([]);
    expect(preferenceValueProblems('task-size', { preferredStepMinutes: 16 })).not.toEqual([]);
    expect(preferenceValueProblems('task-size', { preferredStepMinutes: 2.5 })).not.toEqual([]);
    expect(preferenceValueProblems('task-size', { preferredStepMinutes: '2' })).not.toEqual([]);
  });

  it('accepts only the closed action and mode vocabularies', () => {
    expect(
      preferenceValueProblems('intervention', {
        welcomed: [{ action: 'GOSSIP', count: 1 }],
        refused: [],
      }),
    ).not.toEqual([]);
    expect(
      preferenceValueProblems('intervention', {
        welcomed: [{ action: 'HINT', count: 0 }],
        refused: [],
      }),
    ).not.toEqual([]);
    expect(
      preferenceValueProblems('explanation', { modes: [{ mode: 'LECTURE', count: 1 }] }),
    ).not.toEqual([]);
    expect(preferenceValueProblems('resume', { style: 'detailed' })).not.toEqual([]);
  });

  /*
   * The executable never-do: no value shape can carry a diagnosis, trait or ability label — not
   * because a linter says so, but because every string a value may hold is an enum member and
   * anything else is rejected at the door. A smuggled free-text field is the attack this pins.
   */
  it('cannot carry trait, diagnosis or ability language in any scope', () => {
    const traitish = 'is avoidant and has a low pain threshold for confusion';
    for (const scope of Object.keys(VALID) as LearnerPreferenceScope[]) {
      const smuggled = { ...(VALID[scope] as Record<string, unknown>), note: traitish };
      expect(preferenceValueProblems(scope, smuggled)).not.toEqual([]);
    }
    // And the serialized valid values contain none of the vocabulary the ADR forbids.
    const forbidden = [
      'diagnos',
      'intellig',
      'personal',
      'trait',
      'disorder',
      'avoidant',
      'ability',
    ];
    for (const value of Object.values(VALID)) {
      const serialized = JSON.stringify(value).toLowerCase();
      for (const word of forbidden) expect(serialized).not.toContain(word);
    }
  });

  it('pairs scope and value at the type level, so a derivation cannot mismatch them', () => {
    const taskSize: LearnerPreferenceFor<'task-size'> = {
      id: 'p1',
      sessionId: 's1',
      scope: 'task-size',
      value: { preferredStepMinutes: 2 },
      evidence: {
        windowStart: '2026-01-01T00:00:00.000Z',
        windowEnd: '2026-01-08T00:00:00.000Z',
        sampleSize: 4,
      },
      source: 'ag6.task-size',
      confirmedAt: null,
      expiresAt: null,
      createdAt: '2026-01-08T00:00:00.000Z',
    };
    expect(taskSize.scope).toBe('task-size');
    // @ts-expect-error — an intervention tally is not a task-size value; the pairing is the point.
    const wrong: LearnerPreferenceFor<'task-size'> = { ...taskSize, value: { style: 'brief' } };
    expect(wrong.value).toBeDefined();
  });
});
