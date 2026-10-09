/**
 * A preference the agent has learned about how this learner likes to work (AG7.4) — the store AG6
 * writes into and AG7.6 deletes from.
 *
 * Two rules live in the schema rather than in a review:
 *
 * 1. **Evidence is not optional.** Every preference carries the window and the sample it was derived
 *    from. An inference without them is not representable — which is how "observations carry their
 *    evidence" survives a new caller who never read AG6's design.
 * 2. **Content the learner can read back.** `value` is JSON, `source` an identifier, `scope` a closed
 *    vocabulary: nothing here is an opaque score, and nothing is a personality label, a diagnosis or
 *    a trait (AG6's never-do, fixed at the type).
 *
 * Deletion is physical and session-checked (ADR 0001): another session's preference is a refusal,
 * not a row that happened to vanish.
 */
import type { AgentMemoryRefusal } from './memory';

/** AG7.1's preference scopes — closed, so a derivation cannot invent a fifth kind of thing. */
export const LEARNER_PREFERENCE_SCOPES = [
  'task-size',
  'explanation',
  'intervention',
  'resume',
] as const;

export type LearnerPreferenceScope = (typeof LEARNER_PREFERENCE_SCOPES)[number];

/** The evidence a preference was derived from. Required, always — see the file header. */
export interface LearnerPreferenceEvidence {
  /** ISO-8601 start of the window the preference was observed in. */
  readonly windowStart: string;
  /** ISO-8601 end of that window; not before `windowStart`. */
  readonly windowEnd: string;
  /** How many observations it rests on. A positive integer, or it is not evidence. */
  readonly sampleSize: number;
}

export interface LearnerPreference {
  /** Opaque id — the audit rows and the panel refer to it, never to the value. */
  readonly id: string;
  /** The session it was recorded in: deletion is checked against this (ADR 0001's session rule). */
  readonly sessionId: string;
  readonly scope: LearnerPreferenceScope;
  /** The preference itself, as JSON the learner can read back — never a hidden score. */
  readonly value: Record<string, unknown>;
  readonly evidence: LearnerPreferenceEvidence;
  /** Who derived it — an identifier (e.g. a derivation name), not prose about the person. */
  readonly source: string;
  /** When the learner confirmed it. `null` until AG6.7 confirms: storing-confirmed is AG6's rule. */
  readonly confirmedAt: string | null;
  /** Optional TTL; `null` means it does not expire on its own. */
  readonly expiresAt: string | null;
  readonly createdAt: string;
}

export interface LearnerPreferenceListOk {
  readonly ok: true;
  readonly preferences: readonly LearnerPreference[];
}

export type LearnerPreferenceListResult = LearnerPreferenceListOk | AgentMemoryRefusal;

/**
 * Deleting is idempotent: `deleted: false` is a completed no-op (the second press of the same id),
 * never an error. A preference belonging to another session is a refusal instead.
 */
export interface PreferenceDeleteOk {
  readonly ok: true;
  readonly deleted: boolean;
}

export type PreferenceDeleteResult = PreferenceDeleteOk | AgentMemoryRefusal;
