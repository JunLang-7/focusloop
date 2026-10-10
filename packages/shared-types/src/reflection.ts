/**
 * The weekly reflection (AG6.5): what happened this week, and what the agent believes —
 * every line carrying the samples and the window behind it.
 *
 * Stats are counts over persisted rows and claims are the stored preferences, each with its own
 * evidence inline: the reflection never infers, never trends about the person, and never states a
 * number a spec cannot reconstruct from rows. Nothing here can hold prose — the renderer owns the
 * wording (F6's "每项建议能看到样本量与时间窗" is a rendering rule, and this is what feeds it).
 */
import type { LearnerPreference } from './learner-preference';

/** The counts a week can honestly show. Closed so a label exists for every one of them. */
export const REFLECTION_STAT_KEYS = [
  'interventions.shown',
  'interventions.accepted',
  'interventions.dismissed',
  'resumes.accepted',
  'resumes.dismissed',
  'checkpoints.taken',
  'tasks.completed',
] as const;

export type ReflectionStatKey = (typeof REFLECTION_STAT_KEYS)[number];

/**
 * One count, with the evidence that produced it.
 *
 * `samples` is the number of rows the claim rests on: for a ratio (accepted out of outcomes) it is
 * the denominator — what was *shown* — and for an absolute count it is the count itself. Either way
 * a test can point from the claim back to the rows.
 */
export interface ReflectionStat {
  readonly key: ReflectionStatKey;
  readonly value: number;
  readonly samples: number;
}

/** A stored preference, quoted with its own evidence — not the week's window. */
export interface ReflectionPreferenceClaim {
  readonly scope: LearnerPreference['scope'];
  readonly value: LearnerPreference['value'];
  /** The preference's own `evidence`: how many observations, over which window. */
  readonly samples: number;
  readonly windowFrom: string;
  readonly windowTo: string;
}

export interface WeeklyReflection {
  /** The week itself — the same window the dashboard's week view uses. */
  readonly windowFrom: string;
  readonly windowTo: string;
  /** Only counts that are not zero: an empty list *is* the empty week. */
  readonly stats: readonly ReflectionStat[];
  /** Non-expired stored preferences only — an expired row is never quoted as current (AG6.1). */
  readonly preferences: readonly ReflectionPreferenceClaim[];
}
