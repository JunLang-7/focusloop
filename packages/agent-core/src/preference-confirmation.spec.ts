import { describe, expect, it, vi } from 'vitest';
import type { AgentProposal } from '@focusloop/shared-types';
import { DEMO_COURSE_ID } from './demo-course';
import { computeProposalHash } from './proposal';
import { preferenceFromProposal } from './preference-confirmation';
import { createTestEngine } from './test-helpers';

function seeded(ctx = createTestEngine()) {
  const { session } = ctx.engine.startSession(DEMO_COURSE_ID);
  for (let n = 1; n <= 3; n += 1) {
    const id = `${session.id}:rewrite-${n}`;
    const at = ctx.clock.now();
    ctx.store.insertAgentProposal({
      id,
      sessionId: session.id,
      kind: 'reversible-write',
      payload: { rewrite: { taskId: 'rbt-t1', estimatedMinutes: 2 } },
      proposedAt: at,
      expiresAt: '2126-01-01T00:00:00.000Z',
      proposalHash: id,
      stateFingerprint: 'fixture',
      idempotencyKey: id,
      createdBy: 'spec',
    });
    ctx.store.markAgentProposalConfirmed(id, at);
    ctx.store.markAgentProposalExecuted(id, `event-${id}`, at);
  }
  const list = ctx.engine.listPreferenceCandidates(session.id);
  if (!list.ok || list.candidates.length !== 1)
    throw new Error('fixture must derive one candidate');
  const candidate = list.candidates[0]!;
  const propose = (
    kind: 'reversible-write' | 'structural-write' = 'reversible-write',
    candidateId = candidate.id,
  ) =>
    ctx.engine.proposeStructuralChange({
      sessionId: session.id,
      kind,
      payload: { preferenceCandidateId: candidateId },
      createdBy: 'ag6.suggestion',
      idempotencyKey: 'caller-key',
    });
  const confirm = (proposal: AgentProposal) =>
    ctx.engine.confirmProposal({
      proposalId: proposal.id,
      sessionId: session.id,
      expectedHash: proposal.proposalHash,
    });
  const execute = (proposal: AgentProposal) =>
    ctx.engine.executeProposal({
      proposalId: proposal.id,
      sessionId: session.id,
      idempotencyKey: proposal.idempotencyKey,
    });
  return { ctx, sessionId: session.id, candidate, propose, confirm, execute };
}

describe('preference confirmation — the envelope is the only door (AG6.7)', () => {
  it('freezes the evidence shown; only successful execution stores it, once', () => {
    const { ctx, sessionId, candidate, propose, confirm, execute } = seeded();
    try {
      const write = vi.spyOn(ctx.store, 'insertLearnerPreference');
      ctx.engine.deriveTaskSizePreference(sessionId);
      ctx.engine.listPreferenceCandidates(sessionId);
      expect(write).not.toHaveBeenCalled();
      const proposal = propose().proposal!;
      expect(proposal.payload['preference']).toEqual(candidate);
      expect(proposal.idempotencyKey).toBe(`preference:${sessionId}:${candidate.id}`);
      expect(execute(proposal)).toMatchObject({ ok: false, reason: 'not-confirmed' });
      expect(write).not.toHaveBeenCalled();
      expect(confirm(proposal)).toMatchObject({ ok: true });
      expect(write).not.toHaveBeenCalled();
      ctx.clock.advance(1000);
      expect(execute(proposal)).toMatchObject({ ok: true, status: 'executed' });
      expect(ctx.store.listLearnerPreferences(sessionId)).toEqual([
        {
          ...candidate,
          id: `preference:${sessionId}:${candidate.id}`,
          confirmedAt: '2026-01-01T00:00:00.000Z',
        },
      ]);
      expect(confirm(proposal)).toMatchObject({ ok: false, reason: 'already-executed' });
      expect(execute(proposal)).toMatchObject({ ok: true, status: 'already-executed' });
      expect(write).toHaveBeenCalledTimes(1);
      expect(ctx.engine.listPreferenceCandidates(sessionId)).toEqual({ ok: true, candidates: [] });
    } finally {
      ctx.close();
    }
  });

  it('persists a decline across reloads and moving windows, without storing a preference', () => {
    const { ctx, sessionId, propose, execute } = seeded();
    try {
      const proposal = propose().proposal!;
      expect(
        ctx.engine.declineProposal({
          proposalId: proposal.id,
          sessionId,
          expectedHash: proposal.proposalHash,
        }),
      ).toMatchObject({ ok: true });
      expect(ctx.store.getAgentProposal(proposal.id)).toMatchObject({
        status: 'refused',
        refusalReason: 'declined',
      });
      expect(execute(proposal)).toMatchObject({ ok: false, reason: 'already-refused' });
      ctx.clock.advance(86400000);
      expect(ctx.engine.listPreferenceCandidates(sessionId)).toEqual({ ok: true, candidates: [] });
      expect(propose().proposal).toBeNull();
      expect(ctx.store.listLearnerPreferences(sessionId)).toEqual([]);
    } finally {
      ctx.close();
    }
  });

  it.each(['expired', 'state-changed'] as const)(
    '%s refuses confirmation and stores nothing',
    (reason) => {
      const { ctx, sessionId, propose, confirm, execute } = seeded();
      try {
        const proposal = propose().proposal!;
        if (reason === 'expired') ctx.clock.advance(300001);
        else
          ctx.engine.dispatch({
            sessionId,
            type: 'TASK_STARTED',
            source: 'user',
            payload: { taskId: 'rbt-t1' },
          });
        expect(confirm(proposal)).toMatchObject({
          ok: false,
          reason,
          messageKey: `proposal.refusal.${reason}`,
        });
        expect(execute(proposal)).toMatchObject({ ok: false });
        expect(ctx.store.listLearnerPreferences(sessionId)).toEqual([]);
      } finally {
        ctx.close();
      }
    },
  );

  it('refuses invented ids, wrong levels, wrong sessions and client-supplied preference values', () => {
    const { ctx, sessionId, candidate, propose } = seeded();
    try {
      expect(propose('structural-write').proposal).toBeNull();
      expect(propose('reversible-write', 'invented').proposal).toBeNull();
      for (const payload of [
        { preference: candidate },
        { preferenceCandidateId: candidate.id, preference: candidate },
      ]) {
        expect(
          ctx.engine.proposeStructuralChange({
            sessionId,
            kind: 'reversible-write',
            payload,
            createdBy: 'forged',
            idempotencyKey: 'forged',
          }).proposal,
        ).toBeNull();
      }
      expect(
        ctx.engine.proposeStructuralChange({
          sessionId: 'other',
          kind: 'reversible-write',
          payload: { preferenceCandidateId: candidate.id },
          createdBy: 'forged',
          idempotencyKey: 'other',
        }).proposal,
      ).toBeNull();
      expect(ctx.store.listLearnerPreferences(sessionId)).toEqual([]);
    } finally {
      ctx.close();
    }
  });

  it('rolls the preference, execution event and executed status back together if insertion fails', () => {
    const { ctx, sessionId, propose, confirm, execute } = seeded();
    try {
      const proposal = propose().proposal!;
      confirm(proposal);
      const insert = ctx.store.insertLearnerPreference.bind(ctx.store);
      vi.spyOn(ctx.store, 'insertLearnerPreference').mockImplementation((preference) => {
        insert(preference);
        throw new Error('disk failed');
      });
      expect(() => execute(proposal)).toThrow('disk failed');
      expect(ctx.store.getAgentProposal(proposal.id)?.status).toBe('confirmed');
      expect(
        ctx.engine.listEvents(sessionId).filter((e) => e.type === 'AGENT_PROPOSAL_EXECUTED'),
      ).toEqual([]);
      expect(ctx.store.listLearnerPreferences(sessionId)).toEqual([]);
    } finally {
      ctx.close();
    }
  });

  it('rejects a tampered frozen snapshot before any preference insert, and rolls execution back', () => {
    const { ctx, sessionId, propose, confirm, execute } = seeded();
    try {
      const proposal = propose().proposal!;
      confirm(proposal);
      const actual = ctx.store.getAgentProposal.bind(ctx.store);
      const insert = vi.spyOn(ctx.store, 'insertLearnerPreference');
      vi.spyOn(ctx.store, 'getAgentProposal').mockImplementation((id) => {
        const row = actual(id);
        return row === null
          ? null
          : {
              ...row,
              proposal: {
                ...row.proposal,
                payload: {
                  preference: {
                    ...(proposal.payload['preference'] as object),
                    value: { preferredStepMinutes: 15 },
                  },
                },
              },
            };
      });
      expect(() => execute(proposal)).toThrow('Invalid preference proposal');
      expect(insert).not.toHaveBeenCalled();
      expect(actual(proposal.id)?.status).toBe('confirmed');
      expect(ctx.store.listLearnerPreferences(sessionId)).toEqual([]);
    } finally {
      ctx.close();
    }
  });

  it('validates common fields and evidence at the transactional boundary', () => {
    const { ctx, propose } = seeded();
    try {
      const proposal = propose().proposal!;
      const candidate = proposal.payload['preference'] as Record<string, unknown>;
      const mutations = [
        null,
        [],
        { ...candidate, evidence: null },
        { ...candidate, scope: 'personality' },
        { ...candidate, sessionId: 'other' },
        { ...candidate, id: 1 },
        { ...candidate, confirmedAt: 'already' },
        { ...candidate, expiresAt: 'later' },
        { ...candidate, source: null },
        { ...candidate, createdAt: 'not-a-date' },
        { ...candidate, evidence: { sampleSize: 0, windowStart: 'bad', windowEnd: 'bad' } },
        {
          ...candidate,
          evidence: { sampleSize: 2, windowStart: '2026-02-01', windowEnd: '2026-01-01' },
        },
        {
          ...candidate,
          evidence: { sampleSize: 2, windowStart: '2026-01-01', windowEnd: '2026-02-01' },
        },
        { ...candidate, value: { preferredStepMinutes: 99 } },
        { ...candidate, id: 'forged' },
      ];
      for (const preference of mutations) {
        const payload = { preference };
        expect(() =>
          preferenceFromProposal({
            ...proposal,
            payload,
            proposalHash: computeProposalHash(payload, proposal.stateFingerprint),
          }),
        ).toThrow('Invalid preference proposal');
      }
      expect(() => preferenceFromProposal({ ...proposal, kind: 'structural-write' })).toThrow();
      expect(() => preferenceFromProposal({ ...proposal, idempotencyKey: 'forged' })).toThrow();
      expect(preferenceFromProposal(proposal)).toEqual(candidate);
    } finally {
      ctx.close();
    }
  });

  it('the same claim in two sessions has two stored ids, without a cross-session collision', () => {
    const first = seeded();
    try {
      const p1 = first.propose().proposal!;
      first.confirm(p1);
      first.execute(p1);
      first.ctx.engine.endSession({ sessionId: first.sessionId, reason: 'user' });
      const second = seeded(first.ctx);
      expect(second.candidate.id).toBe(first.candidate.id);
      const p2 = second.propose().proposal!;
      second.confirm(p2);
      second.execute(p2);
      const a = first.ctx.store.listLearnerPreferences(first.sessionId);
      const b = first.ctx.store.listLearnerPreferences(second.sessionId);
      expect(a).toHaveLength(1);
      expect(b).toHaveLength(1);
      expect(a[0]!.id).not.toBe(b[0]!.id);
    } finally {
      first.ctx.close();
    }
  });

  it('forget physically removes the claim and both confirmation snapshots, while the decision remains opaque', () => {
    const { ctx, sessionId, propose, confirm, execute, candidate } = seeded();
    try {
      const proposal = propose().proposal!;
      confirm(proposal);
      execute(proposal);
      const stored = ctx.store.listLearnerPreferences(sessionId)[0]!;
      expect(ctx.engine.deletePreference({ id: stored.id, sessionId })).toEqual({
        ok: true,
        deleted: true,
      });
      expect(ctx.store.listLearnerPreferences(sessionId)).toEqual([]);
      expect(
        ctx.store.getAgentProposal(proposal.id)?.proposal.payload['preference'],
      ).toBeUndefined();
      const announced = ctx.engine
        .listEvents(sessionId)
        .filter((e) => e.type === 'AGENT_PROPOSAL_PROPOSED');
      expect(JSON.stringify(announced)).not.toContain('preferredStepMinutes');
      expect(
        ctx.store.getAgentProposalByIdempotencyKey(`preference:${sessionId}:${candidate.id}`)
          ?.status,
      ).toBe('executed');
      expect(ctx.engine.listPreferenceCandidates(sessionId)).toEqual({ ok: true, candidates: [] });
      expect(execute(proposal)).toMatchObject({ ok: true, status: 'already-executed' });
    } finally {
      ctx.close();
    }
  });

  it.each(['expired', 'state-changed'] as const)(
    '%s between confirm and execute cannot store anything',
    (reason) => {
      const { ctx, sessionId, propose, confirm, execute } = seeded();
      try {
        const proposal = propose().proposal!;
        confirm(proposal);
        if (reason === 'expired') ctx.clock.advance(300001);
        else
          ctx.engine.dispatch({
            sessionId,
            type: 'TASK_STARTED',
            source: 'user',
            payload: { taskId: 'rbt-t1' },
          });
        expect(execute(proposal)).toMatchObject({ ok: false, reason });
        expect(ctx.store.listLearnerPreferences(sessionId)).toEqual([]);
      } finally {
        ctx.close();
      }
    },
  );

  it('checks decline session and hash, and never downgrades an executed proposal', () => {
    const { ctx, sessionId, propose, confirm, execute } = seeded();
    try {
      const proposal = propose().proposal!;
      const request = { proposalId: proposal.id, sessionId, expectedHash: proposal.proposalHash };
      expect(ctx.engine.declineProposal({ ...request, sessionId: 'other' })).toMatchObject({
        ok: false,
        reason: 'wrong-session',
      });
      expect(ctx.engine.declineProposal({ ...request, expectedHash: 'forged' })).toMatchObject({
        ok: false,
        reason: 'hash-mismatch',
      });
      expect(ctx.engine.declineProposal({ ...request, proposalId: 'unknown' })).toMatchObject({
        ok: false,
        reason: 'unknown-proposal',
      });
      confirm(proposal);
      execute(proposal);
      expect(ctx.engine.declineProposal(request)).toMatchObject({
        ok: false,
        reason: 'already-executed',
      });
      expect(ctx.store.listLearnerPreferences(sessionId)).toHaveLength(1);
    } finally {
      ctx.close();
    }
  });
});
