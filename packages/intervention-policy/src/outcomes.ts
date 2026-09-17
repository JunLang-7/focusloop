import type {
  Intervention,
  InterventionAction,
  InterventionOutcome,
  InterventionOutcomeSummary,
} from '@focusloop/shared-types';
import { INTERVENTION_ACTIONS } from '@focusloop/shared-types';

export interface RecordOutcomeInput {
  readonly id: string;
  readonly intervention: Intervention;
  readonly at: string;
  readonly accepted: boolean;
  readonly dismissed: boolean;
  readonly taskCompleted: boolean;
  readonly resumeLatencyMs: number | null;
  readonly quizOutcome: 'correct' | 'incorrect' | null;
}

/**
 * Captures whether an intervention actually helped. Without this the agent can
 * never be judged, and the demo has no evidence to show.
 */
export function recordOutcome(input: RecordOutcomeInput): InterventionOutcome {
  return {
    id: input.id,
    interventionId: input.intervention.id,
    sessionId: input.intervention.sessionId,
    at: input.at,
    state: input.intervention.state,
    action: input.intervention.action,
    accepted: input.accepted,
    dismissed: input.dismissed,
    taskCompleted: input.taskCompleted,
    resumeLatencyMs: input.resumeLatencyMs,
    quizOutcome: input.quizOutcome,
  };
}

/** Every action is always present so the dashboard never has holes. */
export function summarizeOutcomes(
  outcomes: readonly InterventionOutcome[],
): InterventionOutcomeSummary[] {
  const byAction = new Map<InterventionAction, InterventionOutcomeSummary>();

  for (const action of INTERVENTION_ACTIONS) {
    byAction.set(action, {
      action,
      total: 0,
      accepted: 0,
      dismissed: 0,
      tasksCompleted: 0,
    });
  }

  for (const outcome of outcomes) {
    const current = byAction.get(outcome.action);
    if (current === undefined) continue;
    byAction.set(outcome.action, {
      action: current.action,
      total: current.total + 1,
      accepted: current.accepted + (outcome.accepted ? 1 : 0),
      dismissed: current.dismissed + (outcome.dismissed ? 1 : 0),
      tasksCompleted: current.tasksCompleted + (outcome.taskCompleted ? 1 : 0),
    });
  }

  return [...byAction.values()];
}

/** Mean resume latency across the outcomes that actually recorded one. */
export function averageResumeLatencyMs(outcomes: readonly InterventionOutcome[]): number | null {
  const values = outcomes
    .map((outcome) => outcome.resumeLatencyMs)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  if (values.length === 0) return null;
  const total = values.reduce((sum, value) => sum + value, 0);
  return Math.round(total / values.length);
}

/**
 * Acceptance rate is only meaningful once something was actually shown.
 * `NO_ACTION` outcomes are scored as not-accepted but never counted here.
 */
export function acceptanceRate(outcomes: readonly InterventionOutcome[]): number | null {
  const shown = outcomes.filter((outcome) => outcome.action !== 'NO_ACTION');
  if (shown.length === 0) return null;
  const accepted = shown.filter((outcome) => outcome.accepted).length;
  return accepted / shown.length;
}
