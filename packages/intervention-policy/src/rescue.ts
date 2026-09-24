import type {
  Intervention,
  InterventionAction,
  InterventionDecision,
  RescueAction,
  RescuePlan,
  RescueSuccessEvaluation,
  RescueView,
  EvaluateRescueSuccessInput,
} from '@focusloop/shared-types';
import { isRescueAction, message } from '@focusloop/shared-types';
import { DEFAULT_POLICY_CONFIG } from './config';

export interface BuildRescuePlanInput {
  readonly interventionId?: string;
  readonly sessionId?: string;
  readonly taskId?: string | null;
  readonly action?: InterventionAction;
  readonly decision?: InterventionDecision;
  readonly intervention?: Pick<Intervention, 'id' | 'sessionId' | 'action'>;
}

export interface RescuePlanSeed {
  readonly interventionId: string;
  readonly sessionId: string;
  readonly taskId?: string | null;
}

const MINUTES: Record<RescueAction, number> = {
  MICRO_START: 5,
  SIMPLIFY: 3,
  HINT: 2,
  EXAMPLE: 4,
  BREAK: 5,
};

export function buildRescuePlan(input: BuildRescuePlanInput): RescuePlan | null;
export function buildRescuePlan(
  decision: InterventionDecision,
  seed: RescuePlanSeed,
): RescuePlan | null;
export function buildRescuePlan(
  inputOrDecision: BuildRescuePlanInput | InterventionDecision,
  seed?: RescuePlanSeed,
): RescuePlan | null {
  const input = isDecision(inputOrDecision)
    ? {
        interventionId: seed?.interventionId ?? '',
        sessionId: seed?.sessionId ?? '',
        taskId: seed?.taskId,
        action: inputOrDecision.action,
        decision: inputOrDecision,
      }
    : inputOrDecision;
  const action = input.action ?? input.decision?.action ?? input.intervention?.action;
  if (!isRescueAction(action)) return null;
  const interventionId = input.interventionId ?? input.intervention?.id;
  const sessionId = input.sessionId ?? input.intervention?.sessionId;
  if (
    typeof interventionId !== 'string' ||
    interventionId.length === 0 ||
    typeof sessionId !== 'string' ||
    sessionId.length === 0 ||
    (input.taskId !== undefined && input.taskId !== null && input.taskId.length === 0)
  )
    return null;
  return {
    interventionId,
    sessionId,
    taskId: input.taskId ?? null,
    action,
    steps: stepsFor(action),
    estimatedMinutes: MINUTES[action],
    source: 'deterministic-local',
  };
}

export function buildRescueView(
  decision: InterventionDecision,
  seed: RescuePlanSeed,
  phase: 'offered' | 'active' = 'offered',
): RescueView {
  return {
    interventionId: seed.interventionId,
    sessionId: seed.sessionId,
    decision,
    plan: phase === 'active' ? buildRescuePlan(decision, seed) : null,
    phase,
  };
}

/** Evaluates a rescue from immutable event facts inside the acceptance window. */
export function evaluateRescueSuccess(input: EvaluateRescueSuccessInput): RescueSuccessEvaluation {
  const windowMs = input.rescueSuccessWindowMs ?? DEFAULT_POLICY_CONFIG.rescueSuccessWindowMs;
  if (!Number.isFinite(windowMs) || windowMs < 0) {
    throw new RangeError('rescueSuccessWindowMs must be a non-negative finite number');
  }
  const acceptedAt =
    input.acceptedAt ??
    input.outcome?.acceptedAt ??
    (input.outcome?.accepted && !input.outcome.dismissed ? input.outcome.at : null);
  const acceptedAtMs = Date.parse(acceptedAt ?? '');
  const nowMs = Date.parse(input.now);
  const windowEndsAt = Number.isFinite(acceptedAtMs)
    ? new Date(acceptedAtMs + windowMs).toISOString()
    : null;
  const empty = {
    interventionId: input.plan.interventionId,
    sessionId: input.plan.sessionId,
    taskId: input.plan.taskId,
    acceptedAt,
    windowEndsAt,
    evidenceEventIds: [] as readonly string[],
    repeatedHelpEventIds: [] as readonly string[],
  };
  if (!Number.isFinite(acceptedAtMs)) return { ...empty, status: 'pending' };

  const end = acceptedAtMs + windowMs;
  const seen = new Set<string>();
  const evidenceEventIds: string[] = [];
  const repeatedHelpEventIds: string[] = [];
  for (const event of input.events) {
    if (seen.has(event.id)) continue;
    seen.add(event.id);
    const at = Date.parse(event.at);
    if (
      event.sessionId !== input.plan.sessionId ||
      !Number.isFinite(at) ||
      !Number.isFinite(nowMs) ||
      at > nowMs ||
      at <= acceptedAtMs ||
      at > end ||
      !matchesTask(event, input.plan.taskId)
    )
      continue;
    if (event.type === 'HELP_REQUESTED') repeatedHelpEventIds.push(event.id);
    else if (event.type === 'TASK_COMPLETED' || event.type === 'QUIZ_CORRECT')
      evidenceEventIds.push(event.id);
  }
  const continuedAt = Date.parse(input.outcome?.continuedAt ?? '');
  const continued =
    Number.isFinite(continuedAt) &&
    Number.isFinite(nowMs) &&
    continuedAt <= nowMs &&
    continuedAt > acceptedAtMs &&
    continuedAt <= end;
  const status =
    repeatedHelpEventIds.length > 0
      ? 'repeated-help'
      : continued || evidenceEventIds.length > 0
        ? 'succeeded'
        : Number.isFinite(nowMs) && nowMs >= end
          ? 'expired'
          : 'pending';
  return { ...empty, status, evidenceEventIds, repeatedHelpEventIds };
}

export const evaluateRescue = evaluateRescueSuccess;

function isDecision(
  value: BuildRescuePlanInput | InterventionDecision,
): value is InterventionDecision {
  return 'state' in value && 'reason' in value && 'confidence' in value;
}

function stepsFor(action: RescueAction): readonly ReturnType<typeof message>[] {
  switch (action) {
    case 'MICRO_START':
      return [message('rescue.microStart.first')];
    case 'SIMPLIFY':
      return [
        message('rescue.simplify.identify'),
        message('rescue.simplify.first'),
        message('rescue.simplify.check'),
      ];
    case 'HINT':
      return [message('rescue.hint.action'), message('rescue.hint.condition')];
    case 'EXAMPLE':
      return [message('rescue.example.pattern'), message('rescue.example.apply')];
    case 'BREAK':
      return [message('rescue.break.pause'), message('rescue.break.return')];
  }
}

function matchesTask(
  event: EvaluateRescueSuccessInput['events'][number],
  taskId: string | null,
): boolean {
  const eventTaskId = 'taskId' in event.payload ? event.payload.taskId : undefined;
  return taskId === null ? eventTaskId === undefined : eventTaskId === taskId;
}
