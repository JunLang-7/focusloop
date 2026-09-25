import { createHash } from 'node:crypto';
import type {
  AgentProposal,
  AgentProposalKind,
  ConfirmProposalRequest,
  ExecuteProposalRequest,
  LearningEvent,
  ProposalConfirmResult,
  ProposalExecuteResult,
  ProposalRefusal,
  ProposalRefusalReason,
} from '@focusloop/shared-types';
import { isAgentProposalKind } from '@focusloop/shared-types';
import type { FocusLoopStore, SessionRecord } from '@focusloop/persistence';

/**
 * The confirmation + idempotency envelope (AG4's hard gate, AG8's first slice).
 *
 * propose → (learner confirms) → execute → one domain event, where a proposal
 * is bound to the state it was built from and cannot be executed twice.
 *
 * **This module is the command layer.** The only way a structural payload runs
 * is `executeAgentProposal` after a successful confirm. There is no second
 * export that applies a payload — the architectural test pins the export list.
 *
 * Free of shrink/split/reorder: those are AG4's payloads, not the envelope's.
 */

export interface ProposalCommandDeps {
  readonly store: FocusLoopStore;
  readonly now: () => string;
  readonly idFactory: () => string;
}

export interface CreateProposalInput {
  readonly sessionId: string;
  readonly kind: AgentProposalKind;
  readonly payload: Record<string, unknown>;
  readonly createdBy: string;
  readonly idempotencyKey: string;
  /** How long the learner has to confirm. Default 5 minutes. */
  readonly ttlMs?: number;
}

const DEFAULT_TTL_MS = 5 * 60 * 1000;

export function refusal(reason: ProposalRefusalReason, proposalId?: string): ProposalRefusal {
  return {
    ok: false,
    reason,
    messageKey: `proposal.refusal.${reason}` as ProposalRefusal['messageKey'],
    ...(proposalId === undefined ? {} : { proposalId }),
  };
}

/**
 * Fingerprint of the session state a payload is computed against.
 *
 * Covers engine state + session bookkeeping so any structural change (or any
 * dispatch that moves the learner) invalidates a pending confirmation.
 */
export function sessionStateFingerprint(record: SessionRecord): string {
  const canonical = JSON.stringify({
    state: record.engineState.state,
    currentTaskId: record.engineState.currentTaskId ?? null,
    lastActiveTaskId: record.engineState.lastActiveTaskId ?? null,
    completedTaskIds: [...record.engineState.completedTaskIds].sort(),
    sessionUpdatedAt: record.session.updatedAt,
    sessionEndedAt: record.session.endedAt ?? null,
  });
  return createHash('sha256').update(canonical).digest('hex');
}

/** Hash covers the payload **and** the state fingerprint it was computed against. */
export function computeProposalHash(
  payload: Record<string, unknown>,
  stateFingerprint: string,
): string {
  const canonical = JSON.stringify({
    payload: sortKeys(payload),
    stateFingerprint,
  });
  return createHash('sha256').update(canonical).digest('hex');
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) out[key] = sortKeys(source[key]);
    return out;
  }
  return value;
}

/** Builds and stores a proposal bound to the current session state. */
export function createAgentProposal(
  deps: ProposalCommandDeps,
  input: CreateProposalInput,
): AgentProposal | null {
  if (!isAgentProposalKind(input.kind)) return null;
  const record = deps.store.getSession(input.sessionId);
  if (record === null) return null;

  const proposedAt = deps.now();
  const ttl = input.ttlMs ?? DEFAULT_TTL_MS;
  const expiresAt = new Date(Date.parse(proposedAt) + ttl).toISOString();
  const stateFingerprint = sessionStateFingerprint(record);
  const proposal: AgentProposal = {
    id: deps.idFactory(),
    sessionId: input.sessionId,
    kind: input.kind,
    payload: input.payload,
    proposedAt,
    expiresAt,
    proposalHash: computeProposalHash(input.payload, stateFingerprint),
    stateFingerprint,
    idempotencyKey: input.idempotencyKey,
    createdBy: input.createdBy,
  };

  const inserted = deps.store.insertAgentProposal(proposal);
  return inserted ? proposal : null;
}

/**
 * Confirms a proposal. Bound to the hash the client was shown **and** to the
 * state fingerprint recomputed now: state moved → refuse (`state-changed`),
 * past `expiresAt` → refuse (`expired`), another session / forged id → refuse.
 */
export function confirmAgentProposal(
  deps: ProposalCommandDeps,
  request: ConfirmProposalRequest,
): ProposalConfirmResult {
  const stored = deps.store.getAgentProposal(request.proposalId);
  if (stored === null) return refusal('unknown-proposal');
  if (stored.proposal.sessionId !== request.sessionId) return refusal('wrong-session');
  if (stored.status === 'executed') return refusal('already-executed', stored.proposal.id);
  if (stored.status === 'confirmed') return refusal('already-confirmed', stored.proposal.id);
  if (stored.status === 'refused') return refusal('already-refused', stored.proposal.id);

  const nowMs = Date.parse(deps.now());
  const expiresMs = Date.parse(stored.proposal.expiresAt);
  if (Number.isFinite(expiresMs) && nowMs > expiresMs) {
    deps.store.markAgentProposalRefused(stored.proposal.id, 'expired', deps.now());
    return refusal('expired', stored.proposal.id);
  }

  if (request.expectedHash !== stored.proposal.proposalHash) {
    deps.store.markAgentProposalRefused(stored.proposal.id, 'hash-mismatch', deps.now());
    return refusal('hash-mismatch', stored.proposal.id);
  }

  const record = deps.store.getSession(request.sessionId);
  if (record === null) return refusal('unknown-proposal', stored.proposal.id);
  const live = sessionStateFingerprint(record);
  if (live !== stored.proposal.stateFingerprint) {
    deps.store.markAgentProposalRefused(stored.proposal.id, 'state-changed', deps.now());
    return refusal('state-changed', stored.proposal.id);
  }

  const ok = deps.store.markAgentProposalConfirmed(stored.proposal.id, deps.now());
  if (!ok) return refusal('already-confirmed', stored.proposal.id);

  return { ok: true, status: 'confirmed', proposal: stored.proposal };
}

/**
 * Executes a confirmed proposal. Idempotent on `idempotencyKey` /
 * `proposalId`: the second call returns the first call's event id and writes
 * nothing. A proposal that was never confirmed is refused (`not-confirmed`).
 *
 * The payload applier is not called from anywhere else — see the architectural
 * test on the export list.
 */
export function executeAgentProposal(
  deps: ProposalCommandDeps,
  request: ExecuteProposalRequest,
): ProposalExecuteResult {
  const stored = deps.store.getAgentProposal(request.proposalId);
  if (stored === null) return refusal('unknown-proposal');
  if (stored.proposal.sessionId !== request.sessionId) return refusal('wrong-session');

  // Replay: same proposal already executed — one event, one state change, ever.
  if (stored.status === 'executed' && stored.eventId !== null) {
    if (request.idempotencyKey !== stored.proposal.idempotencyKey) {
      return refusal('hash-mismatch', stored.proposal.id);
    }
    return {
      ok: true,
      status: 'already-executed',
      proposalId: stored.proposal.id,
      eventId: stored.eventId,
    };
  }

  if (stored.status === 'refused') return refusal('already-refused', stored.proposal.id);
  if (stored.status === 'proposed') return refusal('not-confirmed', stored.proposal.id);
  if (stored.status !== 'confirmed') return refusal('not-confirmed', stored.proposal.id);

  if (request.idempotencyKey !== stored.proposal.idempotencyKey) {
    return refusal('forged-id', stored.proposal.id);
  }

  const nowMs = Date.parse(deps.now());
  const expiresMs = Date.parse(stored.proposal.expiresAt);
  if (Number.isFinite(expiresMs) && nowMs > expiresMs) {
    deps.store.markAgentProposalRefused(stored.proposal.id, 'expired', deps.now());
    return refusal('expired', stored.proposal.id);
  }

  // State must still match what was confirmed — another TOCTOU gate.
  const record = deps.store.getSession(request.sessionId);
  if (record === null) return refusal('unknown-proposal', stored.proposal.id);
  if (sessionStateFingerprint(record) !== stored.proposal.stateFingerprint) {
    deps.store.markAgentProposalRefused(stored.proposal.id, 'state-changed', deps.now());
    return refusal('state-changed', stored.proposal.id);
  }

  const eventId = deps.idFactory();
  const event: LearningEvent = {
    id: eventId,
    sessionId: request.sessionId,
    at: deps.now(),
    type: 'AGENT_PROPOSAL_EXECUTED',
    source: 'agent',
    payload: {
      proposalId: stored.proposal.id,
      kind: stored.proposal.kind,
      idempotencyKey: stored.proposal.idempotencyKey,
    },
  };

  // Transaction: one event + one status change, or neither.
  const run = deps.store.transaction(() => {
    const appended = deps.store.appendEvent(event);
    if (!appended) return false;
    return deps.store.markAgentProposalExecuted(stored.proposal.id, eventId, deps.now());
  });

  const applied = run();
  if (!applied) {
    // Lost a race with a concurrent execute — read back and return the winner's event.
    const again = deps.store.getAgentProposal(stored.proposal.id);
    if (again?.status === 'executed' && again.eventId !== null) {
      return {
        ok: true,
        status: 'already-executed',
        proposalId: stored.proposal.id,
        eventId: again.eventId,
      };
    }
    return refusal('already-executed', stored.proposal.id);
  }

  return { ok: true, status: 'executed', proposalId: stored.proposal.id, eventId };
}

/**
 * Exports of this command layer — the architectural test asserts this list so
 * no second structural write path can appear without failing CI.
 */
export const PROPOSAL_COMMAND_EXPORTS = [
  'PROPOSAL_COMMAND_EXPORTS',
  'confirmAgentProposal',
  'computeProposalHash',
  'createAgentProposal',
  'executeAgentProposal',
  'refusal',
  'sessionStateFingerprint',
] as const;
