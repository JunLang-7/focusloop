import {
  buildRescuePlan,
  decideIntervention,
  evaluateRescueSuccess,
} from '@focusloop/intervention-policy';
import {
  isLearningState,
  isStuckReason,
  type LearningEvent,
  type LearningState,
  type StuckReason,
} from '@focusloop/shared-types';
import type { JsonObject, JsonValue } from './scenario';

function isRecord(value: JsonValue): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValue(value: JsonValue | undefined, field: string): string {
  if (typeof value !== 'string' || value.length === 0)
    throw new Error(`AG2 ${field} must be a string`);
  return value;
}

/** Exercises production decision, rescue-plan construction and outcome evaluation. */
export function runAg2Adapter(input: JsonValue): JsonValue {
  if (!isRecord(input)) throw new Error('AG2 input must be an object');
  const now = typeof input['now'] === 'string' ? input['now'] : '2026-01-01T00:00:00.000Z';
  const reason: StuckReason | null = isStuckReason(input['reason']) ? input['reason'] : null;
  const state: LearningState = isLearningState(input['state']) ? input['state'] : 'FOCUSED';
  const requestAt = typeof input['requestAt'] === 'string' ? input['requestAt'] : now;
  const requestId = typeof input['requestId'] === 'string' ? input['requestId'] : 'help-request';
  const requestEvent = {
    id: requestId,
    sessionId: 'session-ag2',
    at: requestAt,
    type: 'HELP_REQUESTED',
    source: 'user',
    payload: reason === null ? {} : { reason, taskId: 'task-ag2' },
  } as LearningEvent;
  const decision = decideIntervention({
    engineState: {
      state,
      since: requestAt,
      lastEventAt: requestAt,
      currentTaskId: 'task-ag2',
      lastActiveTaskId: 'task-ag2',
      taskStartedAt: requestAt,
      completedTaskIds: [],
      consecutiveIncorrect: 0,
      recentHelpRequests: [requestAt],
      awaySince: null,
      idleSince: null,
      awaitingResume: false,
      transitionCount: 0,
      recentEventIds: [requestId],
    },
    recentEvents: [requestEvent],
    shownInterventions: [],
    currentTask: null,
    now,
  });
  const plan = buildRescuePlan(decision, {
    interventionId: 'intervention-ag2',
    sessionId: 'session-ag2',
    taskId: 'task-ag2',
  });
  const acceptedAt = typeof input['acceptedAt'] === 'string' ? input['acceptedAt'] : undefined;
  const continuedAt = typeof input['continuedAt'] === 'string' ? input['continuedAt'] : undefined;
  const evidence = Array.isArray(input['events']) ? input['events'] : [];
  const events = evidence.map((value, index) => {
    if (!isRecord(value)) throw new Error(`AG2 event ${index} must be an object`);
    const type = stringValue(value['type'], `event ${index}.type`);
    if (type !== 'TASK_COMPLETED' && type !== 'QUIZ_CORRECT' && type !== 'HELP_REQUESTED')
      throw new Error(`AG2 event ${index}.type is unsupported`);
    const taskId = typeof value['taskId'] === 'string' ? value['taskId'] : 'task-ag2';
    return {
      id: stringValue(value['id'], `event ${index}.id`),
      sessionId: typeof value['sessionId'] === 'string' ? value['sessionId'] : 'session-ag2',
      at: stringValue(value['at'], `event ${index}.at`),
      type,
      source: 'user',
      payload: { taskId },
    } as LearningEvent;
  });
  const evaluation =
    plan === null
      ? null
      : evaluateRescueSuccess({
          plan,
          outcome:
            acceptedAt === undefined
              ? null
              : {
                  accepted: true,
                  dismissed: false,
                  at: acceptedAt,
                  acceptedAt,
                  ...(continuedAt === undefined ? {} : { continuedAt }),
                },
          events,
          now,
        });
  return {
    action: decision.action,
    reasonKey: decision.reason.key,
    stepKeys: plan?.steps.map((step) => step.key) ?? [],
    estimatedMinutes: plan?.estimatedMinutes ?? decision.estimatedMinutes,
    source: plan?.source ?? null,
    status: evaluation?.status ?? 'pending',
    acceptedAt: evaluation?.acceptedAt ?? null,
    windowEndsAt: evaluation?.windowEndsAt ?? null,
    evidenceEventIds: evaluation === null ? [] : [...evaluation.evidenceEventIds],
    repeatedHelpEventIds: evaluation === null ? [] : [...evaluation.repeatedHelpEventIds],
  };
}
