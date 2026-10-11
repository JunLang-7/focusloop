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
import { ADAPTIVE_TASK_LIMITS } from './adaptive-task';
import type { AgentMemoryRefusal } from './memory';
import { RESCUE_ACTIONS } from './rescue';
import { TUTOR_MODES, type TutorMode } from './tutor';

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

/**
 * Task size: the step length this learner's accepted narrowings rested on.
 *
 * Lower bound is `ADAPTIVE_TASK_LIMITS.minMinutes` — a step cannot be smaller than the smallest
 * step AG4 ever writes. Upper bound is 15: accepted steps live in the 1–5 range (the same limits),
 * and fifteen minutes is three of the largest — past that, "size" is a plan question (AG4), not a
 * number this store should hold.
 */
export const TASK_SIZE_MIN_MINUTES = ADAPTIVE_TASK_LIMITS.minMinutes;
export const TASK_SIZE_MAX_MINUTES = 15;

export interface TaskSizePreferenceValue {
  readonly preferredStepMinutes: number;
}

/**
 * The actions a preference may have an opinion about.
 *
 * `RESCUE_ACTIONS` plus QUESTION. Deliberately **not** every `InterventionAction`: `NO_ACTION` is
 * the absence of an action (nothing to welcome), and `RESUME` is the interruption the policy never
 * rate-limits — preferring it would be a preference about nothing, since the learner never gets to
 * refuse it.
 */
export const PREFERENCE_INTERVENTION_ACTIONS = [...RESCUE_ACTIONS, 'QUESTION'] as const;

export interface ActionTally {
  readonly action: (typeof PREFERENCE_INTERVENTION_ACTIONS)[number];
  readonly count: number;
}

export interface InterventionPreferenceValue {
  readonly welcomed: readonly ActionTally[];
  readonly refused: readonly ActionTally[];
}

export interface ExplanationPreferenceValue {
  /** Which forms landed — `TUTOR_MODES` names, counts behind them. Never a judgement of the learner. */
  readonly modes: readonly { readonly mode: TutorMode; readonly count: number }[];
}

export interface ResumePreferenceValue {
  /** The long card says the idea, the short one does not; which does this learner keep? */
  readonly style: 'brief' | 'recap';
}

/** What each scope's `value` must be — a new scope without a shape here cannot compile. */
export interface LearnerPreferenceValueByScope {
  'task-size': TaskSizePreferenceValue;
  intervention: InterventionPreferenceValue;
  explanation: ExplanationPreferenceValue;
  resume: ResumePreferenceValue;
}

export interface LearnerPreferenceCommon {
  /** Opaque id — the audit rows and the panel refer to it, never to the value. */
  readonly id: string;
  /** The session it was recorded in: deletion is checked against this (ADR 0001's session rule). */
  readonly sessionId: string;
  readonly evidence: LearnerPreferenceEvidence;
  /** Who derived it — an identifier (e.g. a derivation name), not prose about the person. */
  readonly source: string;
  /** When the learner confirmed it. `null` until AG6.7 confirms: storing-confirmed is AG6's rule. */
  readonly confirmedAt: string | null;
  /** Optional TTL; `null` means it does not expire on its own. An expired row stays stored, stays
   * visible in the panel marked "expired", stays deletable — and is never quoted as current. */
  readonly expiresAt: string | null;
  readonly createdAt: string;
}

/**
 * A preference: discriminated by `scope`, so `value` is the shape that scope describes and an
 * intervention tally can never be stored as a task size (AG6.1's "cannot mismatch" made type-level).
 */
export type LearnerPreference =
  | (LearnerPreferenceCommon & {
      readonly scope: 'task-size';
      readonly value: TaskSizePreferenceValue;
    })
  | (LearnerPreferenceCommon & {
      readonly scope: 'intervention';
      readonly value: InterventionPreferenceValue;
    })
  | (LearnerPreferenceCommon & {
      readonly scope: 'explanation';
      readonly value: ExplanationPreferenceValue;
    })
  | (LearnerPreferenceCommon & { readonly scope: 'resume'; readonly value: ResumePreferenceValue });

/**
 * Asking for a candidate has three answers, and they must not collapse into one `null` (AG6.2–6.4):
 * a candidate, an honest abstention (`ok: true, candidate: null` — below the sample, nothing
 * welcomed, nothing persisted to count), or the session gate's refusal, which is an error about
 * *where* the question was asked rather than about the evidence.
 */
export type DeriveCandidateResult<S extends LearnerPreferenceScope> =
  { readonly ok: true; readonly candidate: LearnerPreferenceFor<S> | null } | AgentMemoryRefusal;

/** Scope and value paired, for callers who know the scope — AG6.2–6.4 write through this. */
export type LearnerPreferenceFor<S extends LearnerPreferenceScope> = Extract<
  LearnerPreference,
  { readonly scope: S }
>;

const PREFERENCE_VALUE_KEYS: Readonly<Record<LearnerPreferenceScope, readonly string[]>> = {
  'task-size': ['preferredStepMinutes'],
  intervention: ['welcomed', 'refused'],
  explanation: ['modes'],
  resume: ['style'],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function unexpectedKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
): readonly string[] {
  return Object.keys(value)
    .filter((key) => !allowed.includes(key))
    .map((key) => `unexpected property "${key}"`);
}

function tallyProblems(
  value: unknown,
  vocabulary: readonly string[],
  label: string,
  field: 'action' | 'mode',
): readonly string[] {
  if (!Array.isArray(value)) return [`${label} must be a list`];
  const problems: string[] = [];
  for (const entry of value as readonly unknown[]) {
    if (!isRecord(entry)) {
      problems.push(`${label} entries must be objects`);
      continue;
    }
    problems.push(...unexpectedKeys(entry, [field, 'count']));
    const named = entry[field];
    if (typeof named !== 'string' || !vocabulary.includes(named)) {
      problems.push(`${label} has a value outside the closed vocabulary`);
    }
    const count = entry['count'];
    if (typeof count !== 'number' || !Number.isInteger(count) || count < 1) {
      problems.push(`${label} counts must be positive integers`);
    }
  }
  return problems;
}

/**
 * Why this function exists (AG6.1): the typed path is the union above, and this is the same rule
 * enforced for every caller the compiler never saw — an IPC boundary, a stored row read back, a
 * future derivation in a hurry. Empty means the value is in the vocabulary; every problem is a
 * sentence a test can assert on.
 */
export function preferenceValueProblems(
  scope: LearnerPreferenceScope,
  value: unknown,
): readonly string[] {
  if (!isRecord(value)) return ['value must be an object'];
  const problems = [...unexpectedKeys(value, PREFERENCE_VALUE_KEYS[scope])];

  switch (scope) {
    case 'task-size': {
      const minutes = value['preferredStepMinutes'];
      if (
        typeof minutes !== 'number' ||
        !Number.isInteger(minutes) ||
        minutes < TASK_SIZE_MIN_MINUTES ||
        minutes > TASK_SIZE_MAX_MINUTES
      ) {
        problems.push(
          `preferredStepMinutes must be an integer between ${TASK_SIZE_MIN_MINUTES} and ${TASK_SIZE_MAX_MINUTES}`,
        );
      }
      break;
    }
    case 'intervention':
      problems.push(
        ...tallyProblems(value['welcomed'], PREFERENCE_INTERVENTION_ACTIONS, 'welcomed', 'action'),
        ...tallyProblems(value['refused'], PREFERENCE_INTERVENTION_ACTIONS, 'refused', 'action'),
      );
      break;
    case 'explanation':
      problems.push(...tallyProblems(value['modes'], TUTOR_MODES, 'modes', 'mode'));
      break;
    case 'resume': {
      const style = value['style'];
      if (style !== 'brief' && style !== 'recap') problems.push('style must be brief or recap');
      break;
    }
  }
  return problems;
}

export interface LearnerPreferenceListOk {
  readonly ok: true;
  readonly preferences: readonly LearnerPreference[];
}

export type LearnerPreferenceListResult = LearnerPreferenceListOk | AgentMemoryRefusal;

export interface LearnerPreferenceCandidatesOk {
  readonly ok: true;
  readonly candidates: readonly LearnerPreference[];
}

/**
 * The suggestion list (AG6.6): candidates as they were derived — evidence attached, identity
 * belonging to the claim, nothing stored — or the session gate's refusal. An empty list means
 * "below the sample", never "refused": the two must not collapse into one `[]`.
 */
export type LearnerPreferenceCandidatesResult = LearnerPreferenceCandidatesOk | AgentMemoryRefusal;

/**
 * Deleting is idempotent: `deleted: false` is a completed no-op (the second press of the same id),
 * never an error. A preference belonging to another session is a refusal instead.
 */
export interface PreferenceDeleteOk {
  readonly ok: true;
  readonly deleted: boolean;
}

export type PreferenceDeleteResult = PreferenceDeleteOk | AgentMemoryRefusal;
