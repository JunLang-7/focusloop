import type { AgentProposal, LearnerPreference } from '@focusloop/shared-types';
import { LEARNER_PREFERENCE_SCOPES, preferenceValueProblems } from '@focusloop/shared-types';
import { computeProposalHash } from './proposal';
import { preferenceCandidateId } from './preference-derivation';

/** Session-scoped decision identity; deleting the preference does not erase the decision. */
export function preferenceDecisionKey(sessionId: string, candidateId: string): string {
  return `preference:${sessionId}:${candidateId}`;
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Validates the frozen domain payload again before the transactional write, including its hash. */
export function preferenceFromProposal(proposal: AgentProposal): LearnerPreference {
  const row = proposal.payload['preference'];
  if (!object(row) || !object(row['evidence'])) throw new Error('Invalid preference proposal');
  const scope = row['scope'];
  const evidence = row['evidence'];
  if (
    proposal.kind !== 'reversible-write' ||
    typeof scope !== 'string' ||
    !(LEARNER_PREFERENCE_SCOPES as readonly string[]).includes(scope) ||
    row['sessionId'] !== proposal.sessionId ||
    typeof row['id'] !== 'string' ||
    row['confirmedAt'] !== null ||
    row['expiresAt'] !== null ||
    typeof row['source'] !== 'string' ||
    typeof row['createdAt'] !== 'string' ||
    !Number.isFinite(Date.parse(row['createdAt'])) ||
    typeof evidence['windowStart'] !== 'string' ||
    !Number.isFinite(Date.parse(evidence['windowStart'])) ||
    typeof evidence['windowEnd'] !== 'string' ||
    !Number.isFinite(Date.parse(evidence['windowEnd'])) ||
    Date.parse(evidence['windowStart']) > Date.parse(evidence['windowEnd']) ||
    typeof evidence['sampleSize'] !== 'number' ||
    !Number.isInteger(evidence['sampleSize']) ||
    evidence['sampleSize'] < 3 ||
    computeProposalHash(proposal.payload, proposal.stateFingerprint) !== proposal.proposalHash
  )
    throw new Error('Invalid preference proposal');
  // SAFETY: scope is closed above; its paired value is checked by the same vocabulary gate the
  // store uses below. Common fields and evidence have been checked before the transaction writes.
  const candidate = row as unknown as LearnerPreference;
  if (
    preferenceValueProblems(candidate.scope, candidate.value).length > 0 ||
    candidate.id !== preferenceCandidateId(candidate.scope, candidate.value) ||
    proposal.idempotencyKey !== preferenceDecisionKey(proposal.sessionId, candidate.id)
  )
    throw new Error('Invalid preference proposal');
  return candidate;
}
