import {
  at,
  decideIntervention,
  engineWith,
  eventWith,
  interventionWith,
  taskWith,
} from '@focusloop/intervention-policy';
import { LEARNING_STATES, STUCK_REASONS } from '@focusloop/shared-types';
import type { InterventionDecision, LearningState, StuckReason } from '@focusloop/shared-types';
import type { JsonObject, JsonValue } from './scenario';

function isRecord(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function count(value: JsonValue | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error('AG2 intervention count must be a non-negative integer');
  }
  return value;
}

function stuckReason(value: JsonValue | undefined): StuckReason {
  if (value === undefined) throw new Error('AG2 intervention stuckReason is required here');
  if (typeof value === 'string' && (STUCK_REASONS as readonly string[]).includes(value)) {
    return value as StuckReason;
  }
  throw new Error(`AG2 intervention unknown stuck reason: ${JSON.stringify(value)}`);
}

function learningState(value: JsonValue | undefined, fallback: LearningState): LearningState {
  if (value === undefined) return fallback;
  if (typeof value === 'string' && (LEARNING_STATES as readonly string[]).includes(value)) {
    return value as LearningState;
  }
  throw new Error(`AG2 intervention unknown state: ${JSON.stringify(value)}`);
}

/**
 * Speak, or stay quiet — the policy's answer, evaluated as AG10.5's appropriateness scenarios.
 *
 * The input is the *situation* (a stuck reason the learner gave, what was recently shown, how much
 * of the session budget is spent), and the output is the decision the production `decideIntervention`
 * makes from it. The three scenarios the suite pins are the three answers the product lives on: a
 * said reason is answered at once, a cooldown keeps the agent quiet, and the budget outranks even a
 * request.
 */
export function runAg2InterventionAdapter(input: JsonValue): JsonValue {
  if (!isRecord(input)) throw new Error('AG2 intervention input must be an object');

  const state = learningState(input['state'], 'FOCUSED');
  const reason = input['stuckReason'];
  const shownCount = count(input['shownCount'], 0);
  const shownActionValue = input['shownAction'];
  const shownAction = shownActionValue === undefined ? 'HINT' : shownActionValue;
  const sinceLastMs = count(input['sinceLastMs'], 1_000);
  const budget = count(input['maxInterventionsPerSession'], 4);

  const decision: InterventionDecision = decideIntervention(
    {
      engineState: engineWith({ state }),
      recentEvents:
        reason === undefined
          ? []
          : [eventWith('HELP_REQUESTED', at(0), { reason: stuckReason(reason), taskId: 't1' })],
      shownInterventions: Array.from({ length: shownCount }, () =>
        interventionWith(at(0), shownAction as 'HINT'),
      ),
      currentTask: input['currentTask'] === false ? null : taskWith(),
      now: at(sinceLastMs),
    },
    { maxInterventionsPerSession: budget },
  );

  /*
   * SAFETY: every field below is produced by production code from validated input — the adapter's
   * only job is to rename them for the assertions; the JSON round-trip at the runner boundary is
   * what makes the structure verifiable.
   */
  return {
    action: decision.action,
    reason: decision.reason.key,
    // Present only when the decision answers a request — the field is omitted rather than null,
    // which is what `InterventionDecision` itself promises and what `absent` can then assert.
    ...(decision.answersRequestId === undefined || decision.answersRequestId === null
      ? {}
      : { answersRequestId: decision.answersRequestId }),
  } as unknown as JsonValue;
}
