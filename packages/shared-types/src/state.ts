/**
 * Learning state domain model.
 *
 * FocusLoop does NOT diagnose ADHD and does not model clinical severity.
 * A `LearningState` describes the *current learning interaction state* so the
 * system can help the learner resume, not label the learner.
 */
export const LEARNING_STATES = [
  'READY',
  'INITIATION_FRICTION',
  'FOCUSED',
  'CONFUSED',
  'OVERLOADED',
  'DISTRACTED',
  'INTERRUPTED',
  'RESUMING',
] as const;

export type LearningState = (typeof LEARNING_STATES)[number];

export function isLearningState(value: unknown): value is LearningState {
  return typeof value === 'string' && (LEARNING_STATES as readonly string[]).includes(value);
}

/**
 * States that mean "the learner is not currently making progress".
 * Used by the intervention policy and the dashboard.
 */
export const FRICTION_STATES: readonly LearningState[] = [
  'INITIATION_FRICTION',
  'CONFUSED',
  'OVERLOADED',
  'DISTRACTED',
  'INTERRUPTED',
];

export function isFrictionState(state: LearningState): boolean {
  return FRICTION_STATES.includes(state);
}

/** States from which a resume card is meaningful. */
export const RESUMABLE_STATES: readonly LearningState[] = [
  'INTERRUPTED',
  'DISTRACTED',
  'OVERLOADED',
  'CONFUSED',
  'INITIATION_FRICTION',
];

export function isResumableState(state: LearningState): boolean {
  return RESUMABLE_STATES.includes(state);
}
