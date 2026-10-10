import { describe, expect, it } from 'vitest';
import { createTestEngine, type TestEngine } from './test-helpers';
import { DEMO_COURSE_ID } from './demo-course';

const ORDER = ['rbt-t5', 'rbt-t4', 'rbt-t3', 'rbt-t2', 'rbt-t1'];

function withSession(): { ctx: TestEngine; sessionId: string } {
  const ctx = createTestEngine();
  const { session } = ctx.engine.startSession(DEMO_COURSE_ID);
  return { ctx, sessionId: session.id };
}

function propose(
  ctx: TestEngine,
  sessionId: string,
  tool: string,
  args: Record<string, unknown>,
  kind: 'reversible-write' | 'structural-write' = 'structural-write',
  idempotencyKey = `plan-${tool}-1`,
) {
  return ctx.engine.proposeStructuralChange({
    sessionId,
    kind,
    payload: { tool, args },
    createdBy: 'engine-test',
    idempotencyKey,
  });
}

describe('the session-plan tools (AG8.5)', () => {
  it('a confirmed reorder produces TASKS_REORDERED with the order intact — once (AC1/AC2)', () => {
    const { ctx, sessionId } = withSession();
    try {
      const courseBefore = JSON.stringify(ctx.store.getCourse(DEMO_COURSE_ID));
      const proposed = propose(ctx, sessionId, 'reorderSessionPlan', { order: ORDER });
      expect(proposed.proposal).not.toBeNull();
      expect(proposed.event?.payload.proposal.kind).toBe('structural-write');

      expect(
        ctx.engine.executeProposal({
          proposalId: proposed.proposal!.id,
          sessionId,
          idempotencyKey: 'plan-reorderSessionPlan-1',
        }),
      ).toMatchObject({ ok: false, reason: 'not-confirmed' });

      ctx.engine.confirmProposal({
        proposalId: proposed.proposal!.id,
        sessionId,
        expectedHash: proposed.proposal!.proposalHash,
      });
      const executed = ctx.engine.executeProposal({
        proposalId: proposed.proposal!.id,
        sessionId,
        idempotencyKey: 'plan-reorderSessionPlan-1',
      });
      expect(executed).toMatchObject({ ok: true, status: 'executed' });

      const reordered = ctx.engine
        .listEvents(sessionId)
        .filter((e) => e.type === 'TASKS_REORDERED');
      expect(reordered).toHaveLength(1);
      expect(reordered[0]!.id).toBe(`tool:${proposed.proposal!.id}`);
      expect(reordered[0]!.payload).toEqual({ order: ORDER });

      // The course — where order-of-record lives for the reducer's reader — was never written.
      expect(JSON.stringify(ctx.store.getCourse(DEMO_COURSE_ID))).toBe(courseBefore);

      const replay = ctx.engine.executeProposal({
        proposalId: proposed.proposal!.id,
        sessionId,
        idempotencyKey: 'plan-reorderSessionPlan-1',
      });
      expect(replay).toMatchObject({ ok: true, status: 'already-executed' });
      expect(
        ctx.engine.listEvents(sessionId).filter((e) => e.type === 'TASKS_REORDERED'),
      ).toHaveLength(1);
    } finally {
      ctx.close();
    }
  });

  it('refuses an order the plan could not be built from (AC1 semantics)', () => {
    const { ctx, sessionId } = withSession();
    try {
      // The matrix level is structural: claiming reversible cannot slip it past the door.
      expect(
        propose(ctx, sessionId, 'reorderSessionPlan', { order: ORDER }, 'reversible-write')
          .proposal,
      ).toBeNull();
      // Empty: the reducer would clear the plan — refused rather than interpreted.
      expect(propose(ctx, sessionId, 'reorderSessionPlan', { order: [] }).proposal).toBeNull();
      // Duplicates and phantom ids: applyTaskOrder would silently drop or double-rank them.
      expect(
        propose(ctx, sessionId, 'reorderSessionPlan', { order: ['rbt-t1', 'rbt-t1'] }).proposal,
      ).toBeNull();
      expect(
        propose(ctx, sessionId, 'reorderSessionPlan', { order: [...ORDER.slice(0, 4), 'ghost'] })
          .proposal,
      ).toBeNull();
      // Not an array at all (the schema's own refusal reaches the proposal layer as null).
      expect(
        propose(ctx, sessionId, 'reorderSessionPlan', { order: 'rbt-t1' }).proposal,
      ).toBeNull();
    } finally {
      ctx.close();
    }
  });

  it('a confirmed saveCheckpoint becomes the checkpoint resume trusts (AC2)', () => {
    const { ctx, sessionId } = withSession();
    try {
      const before = ctx.engine.getLatestCheckpoint(sessionId);
      const proposed = propose(ctx, sessionId, 'saveCheckpoint', {});
      expect(proposed.proposal).not.toBeNull();

      expect(
        ctx.engine.executeProposal({
          proposalId: proposed.proposal!.id,
          sessionId,
          idempotencyKey: 'plan-saveCheckpoint-1',
        }),
      ).toMatchObject({ ok: false, reason: 'not-confirmed' });

      ctx.engine.confirmProposal({
        proposalId: proposed.proposal!.id,
        sessionId,
        expectedHash: proposed.proposal!.proposalHash,
      });
      expect(
        ctx.engine.executeProposal({
          proposalId: proposed.proposal!.id,
          sessionId,
          idempotencyKey: 'plan-saveCheckpoint-1',
        }),
      ).toMatchObject({ ok: true, status: 'executed' });

      const after = ctx.engine.getLatestCheckpoint(sessionId);
      expect(after).not.toBeNull();
      if (before !== null) expect(after!.id).not.toBe(before.id);
      expect(ctx.engine.listMemory(sessionId, 'episodic')).toMatchObject({ ok: true });
    } finally {
      ctx.close();
    }
  });

  it('the direct path refuses both with the permission reason and records the attempts (AC1)', () => {
    const { ctx, sessionId } = withSession();
    try {
      for (const [tool, args] of [
        ['reorderSessionPlan', { order: ORDER }],
        ['saveCheckpoint', {}],
      ] as const) {
        const result = ctx.engine.executeToolCall({ sessionId, tool, args });
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.reason).toBe('permission');
      }
      const rows = ctx.store.listToolCalls(sessionId);
      expect(rows.filter((row) => row.error === 'permission')).toHaveLength(2);
    } finally {
      ctx.close();
    }
  });
});
