import { describe, expect, it } from 'vitest';
import type { Intervention, InterventionOutcome } from '@focusloop/shared-types';
import { createTestEngine, type TestEngine } from './test-helpers';
import { DEMO_COURSE_ID } from './demo-course';

/**
 * The suggestion list (AG6.6): the three derivations' candidates, surfaced with their evidence
 * and written nowhere. The rules this suite pins — same rows suggest the same candidates twice,
 * a candidate's identity belongs to its claim rather than to the moment it was read (so #236's
 * decline can stick), below-sample means absent, and reading suggestions touches no store.
 */
function daysBefore(reference: string, days: number): string {
  return new Date(Date.parse(reference) - days * 86_400_000).toISOString();
}

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

/** Three accepted narrowings + three accepted HINTs: all three scopes reach their minimum. */
function seeded(): { ctx: TestEngine; sessionId: string } {
  const ctx = createTestEngine();
  const { session } = ctx.engine.startSession(DEMO_COURSE_ID);
  const now = ctx.clock.now();
  seedRewrite(ctx, session.id, 'rw-1', 2, daysBefore(now, 3));
  seedRewrite(ctx, session.id, 'rw-2', 2, daysBefore(now, 2));
  seedRewrite(ctx, session.id, 'rw-3', 1, daysBefore(now, 1));
  seedIntervention(ctx, session.id, 'iv-1', 'HINT', daysBefore(now, 3), 'accepted');
  seedIntervention(ctx, session.id, 'iv-2', 'HINT', daysBefore(now, 2), 'accepted');
  seedIntervention(ctx, session.id, 'iv-3', 'QUESTION', daysBefore(now, 1), 'accepted');
  return { ctx, sessionId: session.id };
}

describe('the suggestion list (AG6.6)', () => {
  it('same rows → same candidates, run twice — ids included', () => {
    const { ctx, sessionId } = seeded();
    try {
      const first = ctx.engine.listPreferenceCandidates(sessionId);
      const second = ctx.engine.listPreferenceCandidates(sessionId);
      expect(first.ok).toBe(true);
      expect(second).toEqual(first);
      if (!first.ok) throw new Error('expected a list');
      expect(first.candidates.map((row) => row.scope)).toEqual([
        'task-size',
        'intervention',
        'explanation',
      ]);
    } finally {
      ctx.close();
    }
  });

  it('a candidate’s id belongs to its claim, not to the moment it was read', () => {
    const { ctx, sessionId } = seeded();
    try {
      const before = ctx.engine.listPreferenceCandidates(sessionId);
      // A fortnight later the window has moved (windowEnd is `now`), but the rows — and therefore
      // the claim — are the same: #236's decline rides this id and must survive the read time.
      ctx.clock.set('2026-01-15T00:00:00.000Z');
      const after = ctx.engine.listPreferenceCandidates(sessionId);
      if (!before.ok || !after.ok) throw new Error('expected lists');
      expect(after.candidates.map((row) => row.id)).toEqual(before.candidates.map((row) => row.id));
      expect(after.candidates.map((row) => row.evidence.windowEnd)).not.toEqual(
        before.candidates.map((row) => row.evidence.windowEnd),
      );
      // The id reads as what it is: scope plus a fingerprint of the value.
      for (const row of after.candidates) {
        expect(row.id).toMatch(/^candidate:[a-z-]+:[0-9a-f]{24}$/);
      }
    } finally {
      ctx.close();
    }
  });

  it('below the sample is not a suggestion: a fresh session lists none', () => {
    const ctx = createTestEngine();
    try {
      const { session } = ctx.engine.startSession(DEMO_COURSE_ID);
      expect(ctx.engine.listPreferenceCandidates(session.id)).toEqual({
        ok: true,
        candidates: [],
      });
    } finally {
      ctx.close();
    }
  });

  it('every suggestion carries its evidence — sample and window, never bare', () => {
    const { ctx, sessionId } = seeded();
    try {
      const result = ctx.engine.listPreferenceCandidates(sessionId);
      if (!result.ok) throw new Error('expected a list');
      expect(result.candidates).toHaveLength(3);
      for (const candidate of result.candidates) {
        expect(candidate.evidence.sampleSize).toBeGreaterThanOrEqual(3);
        expect(candidate.evidence.windowStart < candidate.evidence.windowEnd).toBe(true);
        expect(candidate.confirmedAt).toBeNull();
        expect(candidate.source).toMatch(/^ag6\./);
      }
    } finally {
      ctx.close();
    }
  });

  it('reading suggestions writes nothing — the AG6 never-do, executable', () => {
    const { ctx, sessionId } = seeded();
    try {
      ctx.engine.listPreferenceCandidates(sessionId);
      expect(ctx.store.listLearnerPreferences(sessionId)).toEqual([]);
      const summary = ctx.engine.getMemorySummary(sessionId);
      expect(
        summary.ok &&
          summary.summary.sources.find((row) => row.source === 'learner_preferences')?.count,
      ).toBe(0);
    } finally {
      ctx.close();
    }
  });

  it('the read is refused the way the memory reads are', () => {
    const ctx = createTestEngine();
    try {
      expect(ctx.engine.listPreferenceCandidates('whatever')).toEqual({
        ok: false,
        reason: 'no-session',
        messageKey: 'memory.refusal.no-session',
      });
      const { session } = ctx.engine.startSession(DEMO_COURSE_ID);
      expect(ctx.engine.listPreferenceCandidates('another')).toEqual({
        ok: false,
        reason: 'wrong-session',
        messageKey: 'memory.refusal.wrong-session',
      });
      expect(ctx.engine.listPreferenceCandidates(session.id)).toEqual({
        ok: true,
        candidates: [],
      });
    } finally {
      ctx.close();
    }
  });
});
