import type { LearningState } from './state';

export const INTERVENTION_ACTIONS = [
  'NO_ACTION',
  'MICRO_START',
  'SIMPLIFY',
  'HINT',
  'EXAMPLE',
  'QUESTION',
  'BREAK',
  'RESUME',
] as const;

export type InterventionAction = (typeof INTERVENTION_ACTIONS)[number];

/** Why the policy produced this action. Kept for explainability + tests. */
export interface InterventionDecision {
  readonly action: InterventionAction;
  readonly state: LearningState;
  readonly reason: string;
  /** 0..1 — how strongly the rule matched. Never presented as a diagnosis. */
  readonly confidence: number;
  /** Minutes the suggested action is expected to take. */
  readonly estimatedMinutes: number;
}

export interface Intervention {
  readonly id: string;
  readonly sessionId: string;
  readonly at: string;
  readonly state: LearningState;
  readonly action: InterventionAction;
  readonly reason: string;
  readonly shownAt: string;
}

export interface InterventionOutcome {
  readonly id: string;
  readonly interventionId: string;
  readonly sessionId: string;
  readonly at: string;
  readonly state: LearningState;
  readonly action: InterventionAction;
  readonly accepted: boolean;
  readonly dismissed: boolean;
  readonly taskCompleted: boolean;
  readonly resumeLatencyMs: number | null;
  readonly quizOutcome: 'correct' | 'incorrect' | null;
}

export interface InterventionOutcomeInput {
  readonly intervention: Intervention;
  readonly accepted: boolean;
  readonly dismissed: boolean;
  readonly taskCompleted: boolean;
  readonly resumeLatencyMs: number | null;
  readonly quizOutcome: 'correct' | 'incorrect' | null;
}
