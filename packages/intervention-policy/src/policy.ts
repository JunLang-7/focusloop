import type {
  Intervention,
  InterventionAction,
  InterventionDecision,
  LearningEvent,
  LearningState,
  MicroTask,
} from '@focusloop/shared-types';
import type { StateEngineState } from '@focusloop/learning-state';
import type { InterventionPolicyConfig } from './config';
import { resolvePolicyConfig } from './config';

export interface DecideInterventionInput {
  readonly engineState: StateEngineState;
  readonly recentEvents: readonly LearningEvent[];
  /** Interventions already shown in this session. */
  readonly shownInterventions: readonly Intervention[];
  readonly currentTask: MicroTask | null;
  readonly now: string;
}

const ACTION_MINUTES: Record<InterventionAction, number> = {
  NO_ACTION: 0,
  MICRO_START: 5,
  SIMPLIFY: 3,
  HINT: 2,
  EXAMPLE: 4,
  QUESTION: 2,
  BREAK: 5,
  RESUME: 5,
};

/**
 * Urgency ranking. A more urgent action may interrupt the cooldown; an equally
 * or less urgent one may not. This is what keeps the agent quiet without making
 * it useless when the learner is genuinely stuck.
 */
export const ACTION_PRIORITY: Record<InterventionAction, number> = {
  NO_ACTION: 0,
  QUESTION: 1,
  HINT: 2,
  MICRO_START: 3,
  SIMPLIFY: 3,
  EXAMPLE: 4,
  BREAK: 5,
  RESUME: 6,
};

function decision(
  action: InterventionAction,
  state: LearningState,
  reason: string,
  confidence: number,
  estimatedMinutes = ACTION_MINUTES[action],
): InterventionDecision {
  return { action, state, reason, confidence, estimatedMinutes };
}

function msSince(iso: string | undefined, now: string): number | null {
  if (iso === undefined) return null;
  const delta = Date.parse(now) - Date.parse(iso);
  return Number.isFinite(delta) ? delta : null;
}

function lastEventOfType(
  events: readonly LearningEvent[],
  type: LearningEvent['type'],
): LearningEvent | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event !== undefined && event.type === type) return event;
  }
  return null;
}

/** The state rules, in priority order. First match wins. */
function candidateFor(
  engineState: StateEngineState,
  currentTask: MicroTask | null,
  now: string,
  config: InterventionPolicyConfig,
): InterventionDecision {
  const state = engineState.state;

  if (state === 'OVERLOADED') {
    return decision('BREAK', state, 'repeated help requests in a short window', 0.9);
  }

  if (state === 'CONFUSED') {
    if (engineState.consecutiveIncorrect >= 2) {
      return decision('EXAMPLE', state, 'two consecutive incorrect answers', 0.85);
    }
    return decision('HINT', state, 'help requested on the current task', 0.7);
  }

  if (state === 'INITIATION_FRICTION') {
    return decision('MICRO_START', state, 'no task started within the initiation window', 0.8);
  }

  if (state === 'FOCUSED' && currentTask !== null) {
    const elapsed = msSince(engineState.taskStartedAt ?? undefined, now);
    const estimateMs = currentTask.estimatedMinutes * 60_000;
    if (elapsed !== null && estimateMs > 0 && elapsed > estimateMs * config.simplifyAfterRatio) {
      return decision('SIMPLIFY', state, 'task is running well past its estimate', 0.75);
    }
  }

  if (state === 'FOCUSED' && engineState.consecutiveIncorrect === 1) {
    return decision('QUESTION', state, 'one incorrect answer so far', 0.6);
  }

  if (state === 'DISTRACTED') {
    return decision('NO_ACTION', state, 'learner is away but has not crossed the threshold', 1);
  }

  return decision('NO_ACTION', state, 'no rule matched — staying out of the way', 1);
}

/**
 * Intervention policy v1 — deterministic, rule-based, explainable.
 *
 * Deliberately NOT a model call: the learner must be able to predict and trust
 * the agent. `NO_ACTION` is a first-class answer and is the default.
 */
export function decideIntervention(
  input: DecideInterventionInput,
  configOverrides: Partial<InterventionPolicyConfig> = {},
): InterventionDecision {
  const config: InterventionPolicyConfig = resolvePolicyConfig(configOverrides);
  const { engineState, shownInterventions, now, recentEvents } = input;
  const state = engineState.state;

  // 1. Never become the distraction.
  if (shownInterventions.length >= config.maxInterventionsPerSession) {
    return decision('NO_ACTION', state, 'session intervention budget exhausted', 1);
  }

  // 2. A dismissed resume means the learner wants to be left alone.
  const lastDismissed = lastEventOfType(recentEvents, 'RESUME_DISMISSED');
  const sinceDismissed = msSince(lastDismissed?.at, now);
  const resumeIsPending = state === 'INTERRUPTED' && engineState.awaitingResume;
  if (
    sinceDismissed !== null &&
    sinceDismissed < config.dismissedResumeCooldownMs &&
    !resumeIsPending
  ) {
    return decision('NO_ACTION', state, 'resume was dismissed recently', 1);
  }

  // 3. The one interruption that always matters, and is never rate limited.
  if (resumeIsPending) {
    return decision('RESUME', state, 'learner returned after an interruption', 1);
  }

  const candidate = candidateFor(engineState, input.currentTask, now, config);
  if (candidate.action === 'NO_ACTION') return candidate;

  // 4. Cooldown, except when the situation has become more urgent.
  const lastShown = shownInterventions[shownInterventions.length - 1];
  const sinceLastShown = msSince(lastShown?.shownAt, now);
  if (sinceLastShown !== null && sinceLastShown < config.cooldownMs && lastShown !== undefined) {
    const escalated = ACTION_PRIORITY[candidate.action] > ACTION_PRIORITY[lastShown.action];
    if (!escalated) {
      return decision('NO_ACTION', state, 'inside the cooldown window', 1);
    }
  }

  return candidate;
}

/** Converts a decision into a persisted intervention record. */
export function createIntervention(
  seed: { id: string; sessionId: string; at: string },
  decision: InterventionDecision,
): Intervention {
  return {
    id: seed.id,
    sessionId: seed.sessionId,
    at: seed.at,
    state: decision.state,
    action: decision.action,
    reason: decision.reason,
    shownAt: seed.at,
  };
}

export function estimatedMinutesFor(action: InterventionAction): number {
  return ACTION_MINUTES[action];
}
