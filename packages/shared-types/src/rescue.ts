import type { LearningEvent } from './events';
import type { InterventionDecision, InterventionOutcome } from './intervention';
import type { LocalizedMessage } from './messages';
import type { StuckReason } from './stuck';

/** The five deterministic actions that can be rendered as a stuck rescue. */
export const RESCUE_ACTIONS = ['MICRO_START', 'SIMPLIFY', 'HINT', 'EXAMPLE', 'BREAK'] as const;
export type RescueAction = (typeof RESCUE_ACTIONS)[number];

export function isRescueAction(value: unknown): value is RescueAction {
  return typeof value === 'string' && (RESCUE_ACTIONS as readonly string[]).includes(value);
}

export type RescuePhase = 'offered' | 'active';

/** A local, deterministic plan. It contains no model output or executable tool call. */
export interface RescuePlan {
  readonly interventionId: string;
  readonly sessionId: string;
  readonly taskId: string | null;
  readonly action: RescueAction;
  readonly steps: readonly LocalizedMessage[];
  readonly estimatedMinutes: number;
  readonly source: 'deterministic-local';
}

export interface RescueView {
  readonly interventionId: string;
  readonly sessionId: string;
  readonly decision: InterventionDecision;
  readonly plan: RescuePlan | null;
  readonly phase: RescuePhase;
}

export type RescueSuccessStatus = 'pending' | 'succeeded' | 'expired' | 'repeated-help';

/** The result for one rescue attempt, recomputed from the event log. */
export interface RescueSuccessEvaluation {
  readonly status: RescueSuccessStatus;
  readonly interventionId: string;
  readonly sessionId: string;
  readonly taskId: string | null;
  readonly acceptedAt: string | null;
  readonly windowEndsAt: string | null;
  readonly evidenceEventIds: readonly string[];
  readonly repeatedHelpEventIds: readonly string[];
}

export interface EvaluateRescueSuccessInput {
  readonly plan: RescuePlan;
  readonly outcome?: Pick<
    InterventionOutcome,
    'accepted' | 'dismissed' | 'at' | 'acceptedAt' | 'dismissedAt' | 'continuedAt'
  > | null;
  readonly acceptedAt?: string;
  readonly events: readonly LearningEvent[];
  readonly now: string;
  readonly rescueSuccessWindowMs?: number;
}

export type RescueReasonMap = Readonly<Record<StuckReason, RescueAction>>;
