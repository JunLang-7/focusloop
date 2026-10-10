import { describe, expect, it } from 'vitest';
import type { ResumeCardView } from '@focusloop/shared-types';
import { createTestEngine, type TestEngine } from './test-helpers';
import { DEMO_COURSE_ID } from './demo-course';
import { computeProposalHash, sessionStateFingerprint } from './proposal';

function withSession(): { ctx: TestEngine; sessionId: string } {
  const ctx = createTestEngine();
  const { session } = ctx.engine.startSession(DEMO_COURSE_ID);
  return { ctx, sessionId: session.id };
}

function proposeTool(
  ctx: TestEngine,
  sessionId: string,
  tool: string,
  args: Record<string, unknown>,
  kind: 'reversible-write' | 'structural-write' = 'reversible-write',
  idempotencyKey = `lc-${tool}-1`,
) {
  return ctx.engine.proposeStructuralChange({
    sessionId,
    kind,
    payload: { tool, args },
    createdBy: 'engine-test',
    idempotencyKey,
  });
}

describe('lifecycle tools over the envelope (AG8.3)', () => {
  it('propose → confirm → execute runs the action once, and a replay runs it no more (AC2)', () => {
    const { ctx, sessionId } = withSession();
    try {
      const proposed = proposeTool(ctx, sessionId, 'startTask', { taskId: 'rbt-t1' });
      expect(proposed.proposal).not.toBeNull();
      expect(proposed.event?.type).toBe('AGENT_PROPOSAL_PROPOSED');
      expect(proposed.event?.payload.proposal.kind).toBe('reversible-write');
      const proposalId = proposed.proposal!.id;

      // Not confirmed yet: the envelope refuses before anything runs.
      expect(
        ctx.engine.executeProposal({ proposalId, sessionId, idempotencyKey: 'lc-startTask-1' }),
      ).toMatchObject({ ok: false, reason: 'not-confirmed' });
      expect(
        ctx.engine.listEvents(sessionId).filter((e) => e.type === 'TASK_STARTED'),
      ).toHaveLength(0);

      const confirmed = ctx.engine.confirmProposal({
        proposalId,
        sessionId,
        expectedHash: proposed.proposal!.proposalHash,
      });
      expect(confirmed.ok).toBe(true);

      const first = ctx.engine.executeProposal({
        proposalId,
        sessionId,
        idempotencyKey: 'lc-startTask-1',
      });
      expect(first).toMatchObject({ ok: true, status: 'executed' });

      // The effect: one TASK_STARTED, carrying the proposal's deterministic id.
      const started = ctx.engine.listEvents(sessionId).filter((e) => e.type === 'TASK_STARTED');
      expect(started).toHaveLength(1);
      expect(started[0]!.id).toBe(`tool:${proposalId}`);
      expect(
        ctx.engine.listEvents(sessionId).filter((e) => e.type === 'AGENT_PROPOSAL_EXECUTED'),
      ).toHaveLength(1);

      // Replay: same key, no second anything.
      const second = ctx.engine.executeProposal({
        proposalId,
        sessionId,
        idempotencyKey: 'lc-startTask-1',
      });
      expect(second).toMatchObject({ ok: true, status: 'already-executed' });
      expect(
        ctx.engine.listEvents(sessionId).filter((e) => e.type === 'TASK_STARTED'),
      ).toHaveLength(1);
      expect(
        ctx.engine.listEvents(sessionId).filter((e) => e.type === 'AGENT_PROPOSAL_EXECUTED'),
      ).toHaveLength(1);
    } finally {
      ctx.close();
    }
  });

  it('the direct path refuses a write with the permission reason, and records the attempt (AC1)', () => {
    const { ctx, sessionId } = withSession();
    try {
      for (const tool of ['startTask', 'completeTask']) {
        const result = ctx.engine.executeToolCall({
          sessionId,
          tool,
          args: { taskId: 'rbt-t1' },
        });
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.reason).toBe('permission');
      }
      const rows = ctx.store.listToolCalls(sessionId);
      expect(rows.filter((row) => row.error === 'permission')).toHaveLength(2);
      // And nothing ran: no task event, no proposal.
      expect(
        ctx.engine.listEvents(sessionId).filter((e) => e.type === 'TASK_STARTED'),
      ).toHaveLength(0);
    } finally {
      ctx.close();
    }
  });

  it('completeTask takes the structural door: same envelope, same not-confirmed gate (AC3)', () => {
    const { ctx, sessionId } = withSession();
    try {
      ctx.engine.dispatch({
        sessionId,
        type: 'TASK_STARTED',
        source: 'user',
        payload: { taskId: 'rbt-t1' },
      });
      const proposed = proposeTool(
        ctx,
        sessionId,
        'completeTask',
        { taskId: 'rbt-t1' },
        'structural-write',
      );
      expect(proposed.proposal).not.toBeNull();
      expect(proposed.event?.payload.proposal.kind).toBe('structural-write');

      expect(
        ctx.engine.executeProposal({
          proposalId: proposed.proposal!.id,
          sessionId,
          idempotencyKey: 'lc-completeTask-1',
        }),
      ).toMatchObject({ ok: false, reason: 'not-confirmed' });

      ctx.engine.confirmProposal({
        proposalId: proposed.proposal!.id,
        sessionId,
        expectedHash: proposed.proposal!.proposalHash,
      });
      ctx.engine.executeProposal({
        proposalId: proposed.proposal!.id,
        sessionId,
        idempotencyKey: 'lc-completeTask-1',
      });

      const completed = ctx.engine.listEvents(sessionId).filter((e) => e.type === 'TASK_COMPLETED');
      expect(completed).toHaveLength(1);
      expect(completed[0]!.id).toBe(`tool:${proposed.proposal!.id}`);
    } finally {
      ctx.close();
    }
  });

  describe('propose-time validation: the proposal never exists if the call is wrong', () => {
    it('refuses a kind that is not the tool’s matrix level', () => {
      const { ctx, sessionId } = withSession();
      try {
        expect(
          proposeTool(ctx, sessionId, 'startTask', { taskId: 'rbt-t1' }, 'structural-write')
            .proposal,
        ).toBeNull();
        expect(
          proposeTool(ctx, sessionId, 'completeTask', { taskId: 'rbt-t1' }, 'reversible-write')
            .proposal,
        ).toBeNull();
      } finally {
        ctx.close();
      }
    });

    it('refuses a read or an unknown name as a write', () => {
      const { ctx, sessionId } = withSession();
      try {
        expect(proposeTool(ctx, sessionId, 'readCurrentTask', {}).proposal).toBeNull();
        expect(proposeTool(ctx, sessionId, 'dropTable', { table: 'events' }).proposal).toBeNull();
      } finally {
        ctx.close();
      }
    });

    it('refuses args the contract does not describe, or a task the course does not have', () => {
      const { ctx, sessionId } = withSession();
      try {
        expect(proposeTool(ctx, sessionId, 'startTask', {}).proposal).toBeNull();
        expect(
          proposeTool(ctx, sessionId, 'startTask', { taskId: 'rbt-t1', extra: true }).proposal,
        ).toBeNull();
        expect(
          proposeTool(ctx, sessionId, 'startTask', { taskId: 'no-such-task' }).proposal,
        ).toBeNull();
      } finally {
        ctx.close();
      }
    });

    it('resumeTask only proposes while a resume card is pending, for that card', () => {
      const { ctx, sessionId } = withSession();
      try {
        // No card: nothing to resume.
        expect(
          proposeTool(ctx, sessionId, 'resumeTask', { checkpointId: 'cp-x' }).proposal,
        ).toBeNull();

        ctx.engine.simulate({ command: 'distraction', sessionId });
        ctx.clock.advance(30_000);
        const response = ctx.engine.simulate({ command: 'return', sessionId });
        const card: ResumeCardView | null = response.resumeCard;
        expect(card).not.toBeNull();

        // A different checkpoint than the card's: refused.
        expect(
          proposeTool(ctx, sessionId, 'resumeTask', { checkpointId: 'not-the-card' }).proposal,
        ).toBeNull();

        const proposed = proposeTool(ctx, sessionId, 'resumeTask', {
          checkpointId: card!.timing.checkpointId,
        });
        expect(proposed.proposal).not.toBeNull();

        ctx.engine.confirmProposal({
          proposalId: proposed.proposal!.id,
          sessionId,
          expectedHash: proposed.proposal!.proposalHash,
        });
        ctx.engine.executeProposal({
          proposalId: proposed.proposal!.id,
          sessionId,
          idempotencyKey: 'lc-resumeTask-1',
        });

        expect(
          ctx.engine.listEvents(sessionId).filter((e) => e.type === 'RESUME_REQUESTED'),
        ).toHaveLength(1);
        expect(ctx.engine.getResumeCard(sessionId)).toBeNull();
      } finally {
        ctx.close();
      }
    });

    it('startBreak only proposes where policy offered that break, for that intervention', () => {
      const { ctx, sessionId } = withSession();
      try {
        // On the task, because `isCurrentRescue` ties an offer to the task the learner asked from:
        // a request naming a task the session is not on is not a current rescue, and resolving it
        // would (correctly) do nothing.
        ctx.engine.dispatch({
          sessionId,
          type: 'TASK_STARTED',
          source: 'user',
          payload: { taskId: 'rbt-t1' },
        });
        // Nothing pending: the tool cannot break where policy did not offer one.
        expect(
          proposeTool(ctx, sessionId, 'startBreak', { interventionId: 'iv-x' }).proposal,
        ).toBeNull();

        // An offered HINT is not a break.
        const hinted = ctx.engine.dispatch({
          sessionId,
          type: 'HELP_REQUESTED',
          source: 'user',
          payload: { reason: 'do-not-understand', taskId: 'rbt-t1' },
        });
        expect(hinted.interventionId).not.toBeNull();
        expect(
          proposeTool(ctx, sessionId, 'startBreak', { interventionId: hinted.interventionId! })
            .proposal,
        ).toBeNull();

        // The break policy did offer: accepted, and the outcome recorded once.
        const tired = ctx.engine.dispatch({
          sessionId,
          type: 'HELP_REQUESTED',
          source: 'user',
          payload: { reason: 'tired', taskId: 'rbt-t1' },
        });
        expect(tired.decision?.action).toBe('BREAK');
        expect(tired.interventionId).not.toBeNull();

        const proposed = proposeTool(ctx, sessionId, 'startBreak', {
          interventionId: tired.interventionId!,
        });
        expect(proposed.proposal).not.toBeNull();

        ctx.engine.confirmProposal({
          proposalId: proposed.proposal!.id,
          sessionId,
          expectedHash: proposed.proposal!.proposalHash,
        });
        const executed = ctx.engine.executeProposal({
          proposalId: proposed.proposal!.id,
          sessionId,
          idempotencyKey: 'lc-startBreak-1',
        });
        expect(executed).toMatchObject({ ok: true, status: 'executed' });

        const outcome = ctx.store.getOutcomeByIntervention(tired.interventionId!);
        expect(outcome?.accepted).toBe(true);
      } finally {
        ctx.close();
      }
    });
  });

  it('a confirmed proposal naming an unregistered tool rolls the whole execution back', () => {
    const { ctx, sessionId } = withSession();
    try {
      // Fabricated by hand — the proposal table itself, with a valid hash and fingerprint, because
      // the point is what EXECUTE does with a payload that propose-time validation would refuse.
      const record = ctx.store.getSession(sessionId);
      expect(record).not.toBeNull();
      const payload = { tool: 'ghostTool', args: {} };
      const stateFingerprint = sessionStateFingerprint(record!);
      const proposalId = 'fabricated-1';
      expect(
        ctx.store.insertAgentProposal({
          id: proposalId,
          sessionId,
          kind: 'structural-write',
          payload,
          proposedAt: '2026-01-01T00:00:00.000Z',
          expiresAt: '2126-01-01T00:00:00.000Z',
          proposalHash: computeProposalHash(payload, stateFingerprint),
          stateFingerprint,
          idempotencyKey: 'fabricated-key',
          createdBy: 'spec',
        }),
      ).toBe(true);

      const confirmed = ctx.engine.confirmProposal({
        proposalId,
        sessionId,
        expectedHash: computeProposalHash(payload, stateFingerprint),
      });
      expect(confirmed.ok).toBe(true);

      // The applier refuses a tool it does not know, and the refusal leaves NOTHING behind:
      // the envelope's transaction rolls back — no status change, no event, no half-write.
      expect(() =>
        ctx.engine.executeProposal({ proposalId, sessionId, idempotencyKey: 'fabricated-key' }),
      ).toThrow(/unregistered tool/);

      const stored = ctx.store.getAgentProposal(proposalId);
      expect(stored?.status).toBe('confirmed'); // NOT executed — the rollback undid the attempt
      expect(
        ctx.engine.listEvents(sessionId).filter((e) => e.type === 'AGENT_PROPOSAL_EXECUTED'),
      ).toHaveLength(0);
    } finally {
      ctx.close();
    }
  });

  it('a generic proposal without a tool still records intent and runs no action (back-compat)', () => {
    const { ctx, sessionId } = withSession();
    try {
      const proposed = ctx.engine.proposeStructuralChange({
        sessionId,
        kind: 'structural-write',
        payload: { op: 'demo' },
        createdBy: 'engine-test',
        idempotencyKey: 'lc-generic-1',
      });
      expect(proposed.proposal).not.toBeNull();
      ctx.engine.confirmProposal({
        proposalId: proposed.proposal!.id,
        sessionId,
        expectedHash: proposed.proposal!.proposalHash,
      });
      const executed = ctx.engine.executeProposal({
        proposalId: proposed.proposal!.id,
        sessionId,
        idempotencyKey: 'lc-generic-1',
      });
      expect(executed).toMatchObject({ ok: true, status: 'executed' });
      expect(
        ctx.engine.listEvents(sessionId).filter((e) => e.type === 'TASK_STARTED'),
      ).toHaveLength(0);
      expect(
        ctx.engine.listEvents(sessionId).filter((e) => e.type === 'AGENT_PROPOSAL_EXECUTED'),
      ).toHaveLength(1);
    } finally {
      ctx.close();
    }
  });
});
