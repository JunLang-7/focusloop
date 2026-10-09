import { describe, expect, it } from 'vitest';
import type { AgentProposal, ProposalConfirmResult } from '@focusloop/shared-types';
import { AGENT_PROPOSAL_KINDS } from '@focusloop/shared-types';
import { PROPOSAL_LEVEL_KEYS, proposalDialogView, refusalMessageKey } from './proposal-confirm';

function proposal(overrides: Partial<AgentProposal> = {}): AgentProposal {
  return {
    id: 'p1',
    sessionId: 's1',
    kind: 'structural-write',
    payload: { op: 'reorder', taskId: 't1' },
    proposedAt: '2026-01-01T00:00:00.000Z',
    expiresAt: '2026-01-01T00:05:00.000Z',
    proposalHash: 'hash',
    stateFingerprint: 'fingerprint',
    idempotencyKey: 'key-1',
    createdBy: 'engine.rescue.MICRO_START',
    ...overrides,
  };
}

describe('what the confirmation dialog shows (#209)', () => {
  it('names the level for every kind the envelope accepts', () => {
    for (const kind of AGENT_PROPOSAL_KINDS) {
      expect(PROPOSAL_LEVEL_KEYS[kind]).toBe(`proposal.level.${kind}`);
    }
  });

  it('shows what will change and who asked, not the proposal as raw JSON', () => {
    const view = proposalDialogView(proposal());
    expect(view.why).toBe('engine.rescue.MICRO_START');
    expect(view.changeLines).toEqual(['op: reorder', 'taskId: t1']);
  });

  it('bounds a payload that would otherwise grow the dialog without limit', () => {
    const payload: Record<string, unknown> = {};
    for (let index = 0; index < 20; index += 1) payload[`k${index}`] = `v${index}`;
    payload['long'] = 'x'.repeat(1000);

    const view = proposalDialogView(proposal({ payload }));
    expect(view.changeLines.length).toBeLessThanOrEqual(8);
    for (const line of view.changeLines) expect(line.length).toBeLessThanOrEqual(170);
    // The count of what was left out is shown rather than the omission being silent.
    expect(view.changeLines.some((line) => line.includes('+'))).toBe(true);
  });

  it('renders a nested value as bounded text instead of an object dump', () => {
    const view = proposalDialogView(
      proposal({ payload: { rewrite: { taskId: 't1', steps: ['a', 'b'] } } }),
    );
    expect(view.changeLines).toHaveLength(1);
    expect(view.changeLines[0]).toContain('rewrite:');
    expect(view.changeLines[0]!.length).toBeLessThanOrEqual(170);
  });
});

describe('a refusal is the message it already carries (#209)', () => {
  const refusal = (reason: 'expired' | 'state-changed' | 'hash-mismatch'): ProposalConfirmResult =>
    ({
      ok: false,
      reason,
      messageKey: `proposal.refusal.${reason}`,
      proposalId: 'p1',
    }) as ProposalConfirmResult;

  it('shows expired and state-changed as the reason they name', () => {
    expect(refusalMessageKey(refusal('expired'))).toBe('proposal.refusal.expired');
    expect(refusalMessageKey(refusal('state-changed'))).toBe('proposal.refusal.state-changed');
    expect(refusalMessageKey(refusal('hash-mismatch'))).toBe('proposal.refusal.hash-mismatch');
  });

  it('is silent on success — nothing ran that the learner needs explained', () => {
    expect(refusalMessageKey({ ok: true, status: 'confirmed', proposal: proposal() })).toBeNull();
    expect(
      refusalMessageKey({ ok: true, status: 'executed', proposalId: 'p1', eventId: 'e1' }),
    ).toBeNull();
    expect(
      refusalMessageKey({ ok: true, status: 'already-executed', proposalId: 'p1', eventId: 'e1' }),
    ).toBeNull();
  });
});
