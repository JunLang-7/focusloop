/**
 * Why the learner says they are stuck (AG2).
 *
 * "I am stuck" on its own is not something anybody can help with. What to do next — shrink the task,
 * explain it another way, or stop — depends on *which kind* of stuck it is, and the learning state
 * cannot tell them apart: somebody who cannot see the first move and somebody who is out of energy
 * both look like friction from the outside. These are the smallest set of kinds that separate the
 * interventions that actually differ.
 *
 * Six, not twenty. Each one has to be a distinction a learner can make about themselves in a second,
 * and each one has to lead to a different thing happening.
 *
 * These are words about the work, never about the person. `tired` describes a session, not a capacity;
 * nothing here is a trait, nothing is stored as one, and nothing is inferred about anybody.
 */
export const STUCK_REASONS = [
  /** Cannot see the first move. The task is not too big — the entrance is. */
  'cannot-start',
  /** Reading it is not producing understanding. It needs to be said another way. */
  'do-not-understand',
  /** Knows what to do and it is more than can be held at once. It needs cutting down. */
  'too-big',
  /** Did it, and it came out wrong. Needs the missing piece, not a smaller task. */
  'went-wrong',
  /** Knew it, and it is gone. Needs a cue, not an explanation. */
  'cannot-recall',
  /** Nothing to do with the work. Needs to stop. */
  'tired',
] as const;

export type StuckReason = (typeof STUCK_REASONS)[number];

export function isStuckReason(value: unknown): value is StuckReason {
  return typeof value === 'string' && (STUCK_REASONS as readonly string[]).includes(value);
}
