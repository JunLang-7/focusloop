import { describe, expect, it } from 'vitest';
import type { Intervention, InterventionOutcome } from '@focusloop/shared-types';
import { createProviderSelection } from '@focusloop/llm-provider';
import { createTestEngine, type TestEngine } from './test-helpers';
import { DEMO_COURSE_ID } from './demo-course';
import {
  PREFERENCE_WINDOW_MS,
  deriveExplanationCandidate,
  deriveInterventionCandidate,
  deriveTaskSizeCandidate,
} from './preference-derivation';

const NOW = '2026-06-01T00:00:00.000Z';
function daysAgo(days: number): string {
  return new Date(Date.parse(NOW) - days * 86_400_000).toISOString();
}

describe('the task-size derivation (AG6.2)', () => {
  it('abstains below the sample minimum', () => {
    expect(
      deriveTaskSizeCandidate({
        accepted: [
          { at: daysAgo(1), minutes: 2 },
          { at: daysAgo(2), minutes: 1 },
        ],
        now: NOW,
      }),
    ).toBeNull();
  });

  it('counts the rows inside the window — an old acceptance is not this month’s habit', () => {
    const candidate = deriveTaskSizeCandidate({
      accepted: [
        { at: daysAgo(40), minutes: 5 }, // outside the window
        { at: daysAgo(3), minutes: 2 },
        { at: daysAgo(2), minutes: 2 },
        { at: daysAgo(1), minutes: 1 },
      ],
      now: NOW,
    });
    expect(candidate).not.toBeNull();
    expect(candidate!.evidence.sampleSize).toBe(3);
    expect(candidate!.evidence.windowStart).toBe(
      new Date(Date.parse(NOW) - PREFERENCE_WINDOW_MS).toISOString(),
    );
    expect(candidate!.evidence.windowEnd).toBe(NOW);
  });

  it('carries the size they last lived with — the most recent acceptance, not an average', () => {
    const candidate = deriveTaskSizeCandidate({
      accepted: [
        { at: daysAgo(3), minutes: 2 },
        { at: daysAgo(1), minutes: 1 },
        { at: daysAgo(2), minutes: 2 },
      ],
      now: NOW,
    });
    expect(candidate!.value.preferredStepMinutes).toBe(1);
  });

  it('drops a row that is not a step size instead of letting it vote', () => {
    const candidate = deriveTaskSizeCandidate({
      accepted: [
        { at: daysAgo(3), minutes: 99 },
        { at: daysAgo(2), minutes: 2 },
        { at: daysAgo(1), minutes: 2 },
      ],
      now: NOW,
    });
    // 99 is out of bounds → two counted → below the minimum of three.
    expect(candidate).toBeNull();
  });
});

describe('the intervention derivation (AG6.3)', () => {
  const observation = (at: string, action: Intervention['action'], accepted: boolean) => ({
    at,
    action,
    accepted,
    dismissed: !accepted,
  });

  it('splits welcomed from refused, counting only actions a preference can have an opinion about', () => {
    const candidate = deriveInterventionCandidate({
      observations: [
        observation(daysAgo(3), 'HINT', true),
        observation(daysAgo(2), 'HINT', true),
        observation(daysAgo(1), 'BREAK', false),
        // RESUME is the interruption the learner never gets to refuse: not a preference.
        observation(daysAgo(1), 'RESUME', true),
      ],
      now: NOW,
    });
    expect(candidate).not.toBeNull();
    expect(candidate!.value.welcomed).toEqual([{ action: 'HINT', count: 2 }]);
    expect(candidate!.value.refused).toEqual([{ action: 'BREAK', count: 1 }]);
    expect(candidate!.evidence.sampleSize).toBe(3);
  });

  it('abstains below its minimum — three of one action in a row is a streak, not a stance', () => {
    expect(
      deriveInterventionCandidate({
        observations: [
          observation(daysAgo(2), 'HINT', true),
          observation(daysAgo(1), 'HINT', true),
        ],
        now: NOW,
      }),
    ).toBeNull();
  });

  it('is row-order independent: shuffled observations produce the same candidate', () => {
    const observations = [
      observation(daysAgo(3), 'HINT', true),
      observation(daysAgo(2), 'EXAMPLE', false),
      observation(daysAgo(1), 'SIMPLIFY', true),
    ];
    const first = deriveInterventionCandidate({ observations, now: NOW });
    const second = deriveInterventionCandidate({
      observations: [...observations].reverse(),
      now: NOW,
    });
    expect(first).toEqual(second);
  });
});

describe('the explanation derivation (AG6.4)', () => {
  const observation = (at: string, action: Intervention['action'], accepted: boolean) => ({
    at,
    action,
    accepted,
    dismissed: !accepted,
  });

  it('maps explanation-shaped acceptances to tutor modes — never to a judgement', () => {
    const candidate = deriveExplanationCandidate({
      observations: [
        observation(daysAgo(3), 'HINT', true),
        observation(daysAgo(2), 'HINT', true),
        observation(daysAgo(1), 'QUESTION', true),
      ],
      now: NOW,
    });
    expect(candidate).not.toBeNull();
    expect(candidate!.value.modes).toEqual([
      { mode: 'HINT', count: 2 },
      { mode: 'SOCRATIC', count: 1 },
    ]);
    expect(candidate!.evidence.sampleSize).toBe(3);
  });

  it('abstains when nothing was welcomed, and when shaped observations are few', () => {
    // All dismissed: nothing landed, so there is no form to prefer.
    expect(
      deriveExplanationCandidate({
        observations: [
          observation(daysAgo(3), 'HINT', false),
          observation(daysAgo(2), 'EXAMPLE', false),
          observation(daysAgo(1), 'QUESTION', false),
        ],
        now: NOW,
      }),
    ).toBeNull();
    // A task-shaped action is not an explanation form and does not count.
    expect(
      deriveExplanationCandidate({
        observations: [
          observation(daysAgo(3), 'SIMPLIFY', true),
          observation(daysAgo(2), 'HINT', true),
          observation(daysAgo(1), 'HINT', true),
        ],
        now: NOW,
      }),
    ).toBeNull();
  });
});

// ---------------------------------------------------------------- engine: the rows, and the door

function seedRewrite(
  ctx: TestEngine,
  sessionId: string,
  id: string,
  minutes: number,
  executedAt: string,
): void {
  ctx.store.insertAgentProposal({
    id,
    sessionId,
    kind: 'structural-write',
    payload: { rewrite: { taskId: 'rbt-t1', estimatedMinutes: minutes } },
    proposedAt: executedAt,
    expiresAt: '2126-01-01T00:00:00.000Z',
    proposalHash: `hash-${id}`,
    stateFingerprint: 'fp',
    idempotencyKey: `rewrite-${id}`,
    createdBy: 'spec',
  });
  ctx.store.markAgentProposalConfirmed(id, executedAt);
  ctx.store.markAgentProposalExecuted(id, `evt-${id}`, executedAt);
}

function seedIntervention(
  ctx: TestEngine,
  sessionId: string,
  id: string,
  action: Intervention['action'],
  at: string,
  outcome: 'accepted' | 'dismissed' | null,
): void {
  ctx.store.saveIntervention({
    id,
    sessionId,
    at,
    state: 'CONFUSED',
    action,
    reason: { key: 'reason.confused.hint', params: {} },
    shownAt: at,
  } as Intervention);
  if (outcome !== null) {
    ctx.store.saveOutcome({
      id: `outcome-${id}`,
      interventionId: id,
      sessionId,
      at,
      state: 'CONFUSED',
      action,
      accepted: outcome === 'accepted',
      dismissed: outcome === 'dismissed',
      taskCompleted: false,
      resumeLatencyMs: null,
      quizOutcome: null,
    } as InterventionOutcome);
  }
}

function daysBefore(reference: string, days: number): string {
  return new Date(Date.parse(reference) - days * 86_400_000).toISOString();
}

describe('derivations over the store, behind the session door (AG6.2–6.4)', () => {
  it('reads executed rewrites: sample equals rows, the latest size wins, nothing is written', () => {
    const ctx = createTestEngine();
    try {
      const { session } = ctx.engine.startSession(DEMO_COURSE_ID);
      const now = ctx.clock.now();
      seedRewrite(ctx, session.id, 'rw-1', 2, daysBefore(now, 3));
      seedRewrite(ctx, session.id, 'rw-2', 2, daysBefore(now, 2));
      seedRewrite(ctx, session.id, 'rw-3', 1, daysBefore(now, 1));
      // Outside the window: executed 40 days ago — counted nowhere.
      seedRewrite(ctx, session.id, 'rw-stale', 5, daysBefore(now, 40));

      const result = ctx.engine.deriveTaskSizePreference(session.id);
      expect(result.ok).toBe(true);
      if (!result.ok || result.candidate === null) throw new Error('expected a candidate');
      expect(result.candidate.scope).toBe('task-size');
      expect(result.candidate.value.preferredStepMinutes).toBe(1);
      expect(result.candidate.evidence.sampleSize).toBe(3);
      expect(result.candidate.source).toBe('ag6.task-size');

      // The store the candidate describes is not the store it wrote to (the never-do, executable).
      expect(ctx.store.listLearnerPreferences(session.id)).toEqual([]);
    } finally {
      ctx.close();
    }
  });

  it('abstains below the minimum and outside the window, writing nothing', () => {
    const ctx = createTestEngine();
    try {
      const { session } = ctx.engine.startSession(DEMO_COURSE_ID);
      const now = ctx.clock.now();
      seedRewrite(ctx, session.id, 'rw-1', 2, daysBefore(now, 3));
      seedRewrite(ctx, session.id, 'rw-2', 2, daysBefore(now, 40));

      const result = ctx.engine.deriveTaskSizePreference(session.id);
      expect(result).toEqual({ ok: true, candidate: null });
      expect(ctx.store.listLearnerPreferences(session.id)).toEqual([]);
    } finally {
      ctx.close();
    }
  });

  it('counts interventions with resolved outcomes only, and writes nothing', () => {
    const ctx = createTestEngine();
    try {
      const { session } = ctx.engine.startSession(DEMO_COURSE_ID);
      const now = ctx.clock.now();
      seedIntervention(ctx, session.id, 'iv-1', 'HINT', daysBefore(now, 4), 'accepted');
      seedIntervention(ctx, session.id, 'iv-2', 'HINT', daysBefore(now, 3), 'accepted');
      seedIntervention(ctx, session.id, 'iv-3', 'BREAK', daysBefore(now, 2), 'dismissed');
      // An intervention with no outcome is not an observation: unresolved is not a preference.
      seedIntervention(ctx, session.id, 'iv-4', 'EXAMPLE', daysBefore(now, 1), null);

      const result = ctx.engine.deriveInterventionPreference(session.id);
      expect(result.ok).toBe(true);
      if (!result.ok || result.candidate === null) throw new Error('expected a candidate');
      expect(result.candidate.value.welcomed).toEqual([{ action: 'HINT', count: 2 }]);
      expect(result.candidate.value.refused).toEqual([{ action: 'BREAK', count: 1 }]);
      expect(result.candidate.evidence.sampleSize).toBe(3);
      expect(ctx.store.listLearnerPreferences(session.id)).toEqual([]);
    } finally {
      ctx.close();
    }
  });

  it('derives the explanation candidate from persisted rows only', () => {
    const ctx = createTestEngine();
    try {
      const { session } = ctx.engine.startSession(DEMO_COURSE_ID);
      const now = ctx.clock.now();
      seedIntervention(ctx, session.id, 'iv-1', 'HINT', daysBefore(now, 3), 'accepted');
      seedIntervention(ctx, session.id, 'iv-2', 'QUESTION', daysBefore(now, 2), 'accepted');
      seedIntervention(ctx, session.id, 'iv-3', 'HINT', daysBefore(now, 1), 'accepted');
      seedIntervention(ctx, session.id, 'iv-4', 'SIMPLIFY', daysBefore(now, 1), 'accepted');

      const result = ctx.engine.deriveExplanationPreference(session.id);
      expect(result.ok).toBe(true);
      if (!result.ok || result.candidate === null) throw new Error('expected a candidate');
      expect(result.candidate.value.modes).toEqual([
        { mode: 'HINT', count: 2 },
        { mode: 'SOCRATIC', count: 1 },
      ]);
      // SIMPLIFY is task-shaped, not explanation-shaped: it is neither a mode nor part of the sample.
      expect(result.candidate.evidence.sampleSize).toBe(3);
      expect(ctx.store.listLearnerPreferences(session.id)).toEqual([]);
    } finally {
      ctx.close();
    }
  });

  it('refuses the door the memory reads refuse', () => {
    const ctx = createTestEngine();
    try {
      expect(ctx.engine.deriveTaskSizePreference('anywhere')).toEqual({
        ok: false,
        reason: 'no-session',
        messageKey: 'memory.refusal.no-session',
      });
      const { session } = ctx.engine.startSession(DEMO_COURSE_ID);
      expect(ctx.engine.deriveInterventionPreference('other')).toEqual({
        ok: false,
        reason: 'wrong-session',
        messageKey: 'memory.refusal.wrong-session',
      });
      expect(ctx.engine.deriveExplanationPreference(session.id)).toEqual({
        ok: true,
        candidate: null,
      });
    } finally {
      ctx.close();
    }
  });

  it('cannot be derived from a transcript: the input is persisted rows, and only those', async () => {
    // The transcript is in-process and deliberately unpersisted (#233's rule). Ask a question with
    // a provider that answers in the format the reader accepts, so the transcript really has a turn
    // in it — and the derivation still abstains, because no intervention row exists to count.
    const provider = {
      id: 'scripted',
      model: 'scripted-1',
      offline: false,
      complete: async () => ({
        text: '[hint]\nA rotation restructures three nodes.',
        providerId: 'scripted',
        model: 'scripted-1',
        latencyMs: 1,
      }),
    };
    const scripted = createTestEngine({ providers: createProviderSelection(provider as never) });
    try {
      const { session } = scripted.engine.startSession(DEMO_COURSE_ID);
      const answer = await scripted.engine.askTutor({
        sessionId: session.id,
        mode: 'HINT',
        question: 'why does the colour change?',
      });
      expect(answer.outcome.status).toBe('answered');

      const result = scripted.engine.deriveExplanationPreference(session.id);
      expect(result).toEqual({ ok: true, candidate: null });
    } finally {
      scripted.close();
    }
  });
});
