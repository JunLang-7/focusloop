import type { LearningCheckpoint, LearningEvent } from '@focusloop/shared-types';
import { evaluateResumeOutcome } from '@focusloop/continuity';
import type { JsonObject, JsonValue } from './scenario';

/**
 * JSON contract for the AG5 resume *outcome* metric (not the three-tier card).
 *
 * The metric answers three separate questions about one accepted resume —
 * re-engaged, progressed, stalled again — never a single "success" flag.
 */
export interface Ag5OutcomeInput {
  readonly shownAt: string;
  readonly acceptedAt?: string;
  readonly now: string;
  readonly checkpoint: {
    readonly id: string;
    readonly sessionId: string;
    readonly currentTaskId: string;
    readonly currentTaskTitle: string;
  };
  readonly events: readonly {
    readonly id: string;
    readonly type: LearningEvent['type'];
    readonly at: string;
    readonly sessionId: string;
    readonly taskId?: string;
    readonly reason?: string;
  }[];
  readonly sessionEndedAt?: string;
}

export interface Ag5OutcomeOutput {
  readonly status: string;
  readonly reengaged: boolean;
  readonly progressed: boolean;
  readonly stalledAgain: boolean;
}

export type Ag5OutcomeAdapter = (input: Ag5OutcomeInput) => Ag5OutcomeOutput;

function isRecord(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: JsonValue | undefined, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`AG5 outcome fixture ${field} must be a non-empty string`);
  }
  return value;
}

export function parseAg5OutcomeInput(input: JsonValue): Ag5OutcomeInput {
  if (!isRecord(input)) throw new Error('AG5 outcome fixture input must be an object');
  const checkpoint = input['checkpoint'];
  const events = input['events'];
  if (!isRecord(checkpoint)) throw new Error('AG5 outcome fixture checkpoint must be an object');
  if (!Array.isArray(events)) throw new Error('AG5 outcome fixture events must be an array');

  const acceptedAt = input['acceptedAt'];
  const sessionEndedAt = input['sessionEndedAt'];
  return {
    shownAt: str(input['shownAt'], 'shownAt'),
    ...(typeof acceptedAt === 'string' ? { acceptedAt } : {}),
    now: str(input['now'], 'now'),
    checkpoint: {
      id: str(checkpoint['id'], 'checkpoint.id'),
      sessionId: str(checkpoint['sessionId'], 'checkpoint.sessionId'),
      currentTaskId: str(checkpoint['currentTaskId'], 'checkpoint.currentTaskId'),
      currentTaskTitle: str(checkpoint['currentTaskTitle'], 'checkpoint.currentTaskTitle'),
    },
    events: events.map((raw, index) => {
      if (!isRecord(raw)) throw new Error(`AG5 outcome event ${index} must be an object`);
      const type = str(raw['type'], `event ${index}.type`);
      const taskId = raw['taskId'];
      const reason = raw['reason'];
      return {
        id: str(raw['id'], `event ${index}.id`),
        type: type as LearningEvent['type'],
        at: str(raw['at'], `event ${index}.at`),
        sessionId: str(raw['sessionId'], `event ${index}.sessionId`),
        ...(typeof taskId === 'string' ? { taskId } : {}),
        ...(typeof reason === 'string' ? { reason } : {}),
      };
    }),
    ...(typeof sessionEndedAt === 'string' ? { sessionEndedAt } : {}),
  };
}

export function buildAg5Outcome(input: Ag5OutcomeInput): Ag5OutcomeOutput {
  const checkpoint: LearningCheckpoint = {
    id: input.checkpoint.id,
    sessionId: input.checkpoint.sessionId,
    conceptId: 'concept-ag5',
    conceptTitle: input.checkpoint.currentTaskTitle,
    goal: input.checkpoint.currentTaskTitle,
    mastered: [],
    unresolved: [],
    currentTaskId: input.checkpoint.currentTaskId,
    currentTaskTitle: input.checkpoint.currentTaskTitle,
    currentStep: 1,
    frictionState: 'FOCUSED',
    nextBestAction: { key: 'action.read.summarise', params: {} },
    createdAt: input.shownAt,
  };

  const events: LearningEvent[] = input.events.map((event) => ({
    id: event.id,
    sessionId: event.sessionId,
    at: event.at,
    type: event.type,
    source: 'user',
    payload: {
      ...(event.taskId === undefined ? {} : { taskId: event.taskId }),
      ...(event.reason === undefined ? {} : { reason: event.reason }),
    },
  })) as LearningEvent[];

  const result = evaluateResumeOutcome({
    checkpoint,
    timing: {
      checkpointId: checkpoint.id,
      shownAt: input.shownAt,
      ...(input.acceptedAt === undefined ? {} : { acceptedAt: input.acceptedAt }),
    },
    events,
    ...(input.sessionEndedAt === undefined ? {} : { sessionEndedAt: input.sessionEndedAt }),
    now: input.now,
  });

  return {
    status: result.status,
    reengaged: result.reengaged,
    progressed: result.progressed,
    stalledAgain: result.stalledAgain,
  };
}

export function runAg5OutcomeAdapter(
  input: JsonValue,
  adapter: Ag5OutcomeAdapter = buildAg5Outcome,
): JsonValue {
  return adapter(parseAg5OutcomeInput(input)) as unknown as JsonValue;
}
