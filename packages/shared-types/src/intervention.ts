import type { LocalizedMessage } from './messages';
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
  readonly reason: LocalizedMessage;
  /** 0..1 — how strongly the rule matched. Never presented as a diagnosis. */
  readonly confidence: number;
  /** Minutes the suggested action is expected to take. */
  readonly estimatedMinutes: number;
  /**
   * The id of the `HELP_REQUESTED` event this decision answers, when it answers one.
   *
   * Present only when the learner asked for help and said why: that is the one case where the
   * decision is an answer rather than the agent speaking up. Acted on immediately; the record of it
   * exists so that "has this request been answered" can be *read* rather than guessed at later.
   */
  readonly answersRequestId?: string;
}

export interface Intervention {
  readonly id: string;
  readonly sessionId: string;
  readonly at: string;
  readonly state: LearningState;
  readonly action: InterventionAction;
  readonly reason: LocalizedMessage;
  readonly shownAt: string;
  /**
   * The `HELP_REQUESTED` event this intervention was produced in answer to, when it answers one.
   *
   * Without this, an intervention's timestamp is the only evidence that a request has been dealt
   * with, and a timestamp cannot tell an answer from something unrelated shown in the same
   * millisecond. Absent for every intervention the agent showed unasked, and for rows written
   * before this field existed — both of which are correctly read as "answers no request".
   */
  readonly answersRequestId?: string;
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
  readonly acceptedAt?: string;
  readonly dismissedAt?: string;
  readonly continuedAt?: string;
}

export interface InterventionOutcomeInput {
  readonly intervention: Intervention;
  readonly accepted: boolean;
  readonly dismissed: boolean;
  readonly taskCompleted: boolean;
  readonly resumeLatencyMs: number | null;
  readonly quizOutcome: 'correct' | 'incorrect' | null;
  readonly acceptedAt?: string;
  readonly dismissedAt?: string;
  readonly continuedAt?: string;
}
