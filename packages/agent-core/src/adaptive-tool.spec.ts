import { describe, expect, it } from 'vitest';
import { createTestEngine, type TestEngine } from './test-helpers';
import { DEMO_COURSE_ID } from './demo-course';
import { rewriteIdempotencyKey } from './task-rewrite';

function started(): { ctx: TestEngine; sessionId: string } {
  const ctx = createTestEngine();
  const { session } = ctx.engine.startSession(DEMO_COURSE_ID);
  ctx.engine.dispatch({
    sessionId: session.id,
    type: 'TASK_STARTED',
    source: 'user',
    payload: { taskId: 'rbt-t1' },
  });
  return { ctx, sessionId: session.id };
}

function proposeAdaptive(
  ctx: TestEngine,
  sessionId: string,
  args: Record<string, unknown>,
  kind: 'reversible-write' | 'structural-write' = 'reversible-write',
  idempotencyKey = 'adaptive-caller-key',
) {
  return ctx.engine.proposeStructuralChange({
    sessionId,
    kind,
    payload: { tool: 'createAdaptiveTask', args },
    createdBy: 'engine-test',
    idempotencyKey,
  });
}

describe('the adaptive-task tool (AG8.4)', () => {
  it('proposes with the rewrite embedded, executes once, and serves it derived (AC1/AC2)', () => {
    const { ctx, sessionId } = started();
    try {
      const storedBefore = JSON.stringify(ctx.store.getCourse(DEMO_COURSE_ID));

      const proposed = proposeAdaptive(ctx, sessionId, {
        action: 'MICRO_START',
        taskId: 'rbt-t1',
      });
      expect(proposed.proposal).not.toBeNull();
      expect(proposed.event?.payload.proposal.kind).toBe('reversible-write');
      // The rewrite rides in the payload — that is what `activeTaskRewrite` serves from.
      expect(proposed.proposal!.payload['rewrite']).toBeDefined();

      // Refused without confirmation, like every other write.
      expect(
        ctx.engine.executeProposal({
          proposalId: proposed.proposal!.id,
          sessionId,
          idempotencyKey: rewriteIdempotencyKey(sessionId, 'rbt-t1', 'MICRO_START'),
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
        idempotencyKey: rewriteIdempotencyKey(sessionId, 'rbt-t1', 'MICRO_START'),
      });
      expect(executed).toMatchObject({ ok: true, status: 'executed' });

      // AC2: the stored course is byte-identical — serving derives, the write never touches it.
      expect(JSON.stringify(ctx.store.getCourse(DEMO_COURSE_ID))).toBe(storedBefore);

      // And what the learner is served is the narrowed task.
      const served = ctx.engine
        .getCourse(DEMO_COURSE_ID)!
        .microTasks.find((task) => task.id === 'rbt-t1');
      expect(served?.estimatedMinutes).toBe(2);
      expect(served?.instructions).toBe('in-order traversal is sorted');

      // Replay writes no second anything.
      const replay = ctx.engine.executeProposal({
        proposalId: proposed.proposal!.id,
        sessionId,
        idempotencyKey: rewriteIdempotencyKey(sessionId, 'rbt-t1', 'MICRO_START'),
      });
      expect(replay).toMatchObject({ ok: true, status: 'already-executed' });
      expect(
        ctx.engine.listEvents(sessionId).filter((e) => e.type === 'AGENT_PROPOSAL_EXECUTED'),
      ).toHaveLength(1);
    } finally {
      ctx.close();
    }
  });

  it("the rescue's key IS the tool's key: one task, one rewrite, across both paths", () => {
    const { ctx, sessionId } = started();
    try {
      // The tool goes first — and the proposal takes the domain key, not the caller's.
      const viaTool = proposeAdaptive(ctx, sessionId, { action: 'MICRO_START', taskId: 'rbt-t1' });
      expect(viaTool.proposal).not.toBeNull();
      expect(viaTool.proposal!.idempotencyKey).toBe(
        rewriteIdempotencyKey(sessionId, 'rbt-t1', 'MICRO_START'),
      );
      ctx.engine.confirmProposal({
        proposalId: viaTool.proposal!.id,
        sessionId,
        expectedHash: viaTool.proposal!.proposalHash,
      });
      ctx.engine.executeProposal({
        proposalId: viaTool.proposal!.id,
        sessionId,
        idempotencyKey: rewriteIdempotencyKey(sessionId, 'rbt-t1', 'MICRO_START'),
      });

      // A second propose for the same task+action — any caller key — cannot become a second
      // proposal: the domain key already exists, so creation refuses outright.
      const again = proposeAdaptive(
        ctx,
        sessionId,
        { action: 'MICRO_START', taskId: 'rbt-t1' },
        'reversible-write',
        'some-other-caller-key',
      );
      expect(again.proposal).toBeNull();

      // And the rescue's own accept afterwards finds the executed proposal by the same key and
      // changes nothing: one task, one rewrite, ever.
      const asked = ctx.engine.dispatch({
        sessionId,
        type: 'HELP_REQUESTED',
        source: 'user',
        payload: { reason: 'cannot-start', taskId: 'rbt-t1' },
      });
      ctx.engine.resolveRescue({
        sessionId,
        interventionId: asked.interventionId!,
        resolution: 'accept',
      });
      expect(
        ctx.engine.listEvents(sessionId).filter((e) => e.type === 'AGENT_PROPOSAL_EXECUTED'),
      ).toHaveLength(1);
    } finally {
      ctx.close();
    }
  });

  it('refuses what the matrix and the builder refuse (kind, action, currency)', () => {
    const { ctx, sessionId } = started();
    try {
      // The kind must be the matrix level: this row is reversible (ADR 0003 §3).
      expect(
        proposeAdaptive(
          ctx,
          sessionId,
          { action: 'MICRO_START', taskId: 'rbt-t1' },
          'structural-write',
        ).proposal,
      ).toBeNull();
      // A rescue action is not a rewrite action.
      expect(
        proposeAdaptive(ctx, sessionId, { action: 'HINT', taskId: 'rbt-t1' }).proposal,
      ).toBeNull();
      // The rewrite must be for the task the learner is ON — a narrowing of a task they are not
      // looking at would execute and serve nowhere.
      ctx.engine.dispatch({
        sessionId,
        type: 'TASK_STARTED',
        source: 'user',
        payload: { taskId: 'rbt-t2' },
      });
      expect(
        proposeAdaptive(ctx, sessionId, { action: 'MICRO_START', taskId: 'rbt-t1' }).proposal,
      ).toBeNull();
      // A task the course does not have.
      expect(
        proposeAdaptive(ctx, sessionId, { action: 'MICRO_START', taskId: 'nope' }).proposal,
      ).toBeNull();
    } finally {
      ctx.close();
    }
  });
});
