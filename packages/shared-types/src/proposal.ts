import type { ProposalMessageKey } from './messages';

/**
 * Closed set of structural-change classes the confirmation envelope accepts.
 *
 * This slice ships the envelope only — no shrink/split/reorder. AG4 extends
 * this union when it registers its adaptations; nothing outside the list may
 * be proposed or executed.
 */
export const AGENT_PROPOSAL_KINDS = ['structural-write'] as const;

export type AgentProposalKind = (typeof AGENT_PROPOSAL_KINDS)[number];

export function isAgentProposalKind(value: unknown): value is AgentProposalKind {
  return typeof value === 'string' && (AGENT_PROPOSAL_KINDS as readonly string[]).includes(value);
}

/**
 * A structural change the learner must confirm before it runs.
 *
 * `proposalHash` covers `payload` **and** `stateFingerprint` — the state the
 * payload was computed against — so a confirmation after the state moved is
 * refused rather than applied to the wrong world (TOCTOU).
 */
export interface AgentProposal {
  readonly id: string;
  readonly sessionId: string;
  readonly kind: AgentProposalKind;
  readonly payload: Record<string, unknown>;
  readonly proposedAt: string;
  readonly expiresAt: string;
  readonly proposalHash: string;
  /** Fingerprint of session state when the payload was built. */
  readonly stateFingerprint: string;
  /** One per proposal; a second execute with the key is a no-op replay. */
  readonly idempotencyKey: string;
  /** Tool or caller that produced the proposal — the AG8 audit trail. */
  readonly createdBy: string;
}

export type AgentProposalStatus = 'proposed' | 'confirmed' | 'executed' | 'refused' | 'expired';

export type ProposalRefusalReason =
  | 'unknown-proposal'
  | 'wrong-session'
  | 'expired'
  | 'state-changed'
  | 'hash-mismatch'
  | 'already-confirmed'
  | 'already-executed'
  | 'already-refused'
  | 'not-confirmed'
  | 'forged-id';

/** A refusal the renderer can show: a closed reason plus a translatable key. */
export interface ProposalRefusal {
  readonly ok: false;
  readonly reason: ProposalRefusalReason;
  readonly messageKey: ProposalMessageKey;
  readonly proposalId?: string;
}

export interface ProposalConfirmOk {
  readonly ok: true;
  readonly status: 'confirmed';
  readonly proposal: AgentProposal;
}

export interface ProposalExecuteOk {
  readonly ok: true;
  /** First execution wrote the event; a replay returns the same id. */
  readonly status: 'executed' | 'already-executed';
  readonly proposalId: string;
  readonly eventId: string;
}

export type ProposalConfirmResult = ProposalConfirmOk | ProposalRefusal;
export type ProposalExecuteResult = ProposalExecuteOk | ProposalRefusal;

/** What `confirm` / `execute` look like over IPC — always a result object, never a throw. */
export interface ConfirmProposalRequest {
  readonly proposalId: string;
  readonly sessionId: string;
  /** Client's copy of the hash it was shown; must match the stored proposal. */
  readonly expectedHash: string;
}

export interface ExecuteProposalRequest {
  readonly proposalId: string;
  readonly sessionId: string;
  readonly idempotencyKey: string;
}
