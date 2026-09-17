import {
  isInsightRange,
  isLocale,
  LEARNING_EVENT_TYPES,
  SESSION_END_REASONS,
  type DispatchEventRequest,
  type EndSessionRequest,
  type ImportMaterialRequest,
  type InsightsRequest,
  type LearningEvent,
  type ResumeDecisionRequest,
  type ResolveInterventionRequest,
  type SessionEndReason,
  type SetLocaleRequest,
  type SimulatorCommand,
  type StartSessionRequest,
} from '@focusloop/shared-types';

export class IpcValidationError extends Error {
  readonly channel: string;

  constructor(channel: string, message: string) {
    super(`${channel}: ${message}`);
    this.name = 'IpcValidationError';
    this.channel = channel;
  }
}

function fail(channel: string, message: string): never {
  throw new IpcValidationError(channel, message);
}

function asRecord(channel: string, value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(channel, 'expected an object payload');
  }
  return value as Record<string, unknown>;
}

function asString(channel: string, record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== 'string' || value.length === 0) {
    fail(channel, `"${key}" must be a non-empty string`);
  }
  return value;
}

function asOptionalString(
  channel: string,
  record: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = record[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') fail(channel, `"${key}" must be a string when present`);
  return value;
}

const EVENT_TYPES = new Set<string>(LEARNING_EVENT_TYPES);
const EVENT_SOURCES = new Set<string>(['user', 'extension', 'simulator', 'system', 'agent']);
const MAX_PAYLOAD_BYTES = 4 * 1024;

/** Validates the payload of `focusloop:event:dispatch`. */
export function parseDispatchRequest(channel: string, value: unknown): DispatchEventRequest {
  const record = asRecord(channel, value);
  const sessionId = asString(channel, record, 'sessionId');
  const type = asString(channel, record, 'type');
  if (!EVENT_TYPES.has(type)) fail(channel, `unknown learning event type "${type}"`);

  const source = asString(channel, record, 'source');
  if (!EVENT_SOURCES.has(source)) fail(channel, `unknown event source "${source}"`);

  const payload = record['payload'];
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    fail(channel, '"payload" must be an object');
  }
  if (JSON.stringify(payload).length > MAX_PAYLOAD_BYTES) {
    fail(channel, 'payload is too large');
  }

  const at = asOptionalString(channel, record, 'at');
  const eventId = asOptionalString(channel, record, 'eventId');

  return {
    sessionId,
    type: type as LearningEvent['type'],
    source: source as LearningEvent['source'],
    payload: payload as Record<string, unknown>,
    ...(at === undefined ? {} : { at }),
    ...(eventId === undefined ? {} : { eventId }),
  };
}

export function parseStartSession(channel: string, value: unknown): StartSessionRequest {
  const record = asRecord(channel, value);
  return { courseId: asString(channel, record, 'courseId') };
}

export function parseEndSession(channel: string, value: unknown): EndSessionRequest {
  const record = asRecord(channel, value);
  const sessionId = asString(channel, record, 'sessionId');
  const reason = asString(channel, record, 'reason');
  if (!(SESSION_END_REASONS as readonly string[]).includes(reason)) {
    fail(channel, `unknown session end reason "${reason}"`);
  }
  return { sessionId, reason: reason as SessionEndReason };
}

export function parseImportMaterial(channel: string, value: unknown): ImportMaterialRequest {
  const record = asRecord(channel, value);
  const fileName = asString(channel, record, 'fileName');
  const content = record['content'];
  if (typeof content !== 'string') fail(channel, '"content" must be a string');
  return { fileName, content };
}

export function parseResumeDecision(channel: string, value: unknown): ResumeDecisionRequest {
  const record = asRecord(channel, value);
  return { checkpointId: asString(channel, record, 'checkpointId') };
}

export function parseSessionId(channel: string, value: unknown): string {
  return asString(channel, asRecord(channel, value), 'sessionId');
}

export function parseCourseId(channel: string, value: unknown): string {
  return asString(channel, asRecord(channel, value), 'courseId');
}

export function parseSetLocale(channel: string, value: unknown): SetLocaleRequest {
  const record = asRecord(channel, value);
  const locale = asString(channel, record, 'locale');
  if (!isLocale(locale)) fail(channel, `unsupported locale "${locale}"`);
  return { locale };
}

export function parseInsightsRequest(channel: string, value: unknown): InsightsRequest {
  const record = asRecord(channel, value);
  const range = asString(channel, record, 'range');
  if (!isInsightRange(range)) fail(channel, `unsupported insight range "${range}"`);
  return { range };
}

export function parseResolveIntervention(
  channel: string,
  value: unknown,
): ResolveInterventionRequest {
  const record = asRecord(channel, value);
  const interventionId = asString(channel, record, 'interventionId');

  for (const key of ['accepted', 'dismissed', 'taskCompleted'] as const) {
    if (typeof record[key] !== 'boolean') fail(channel, `"${key}" must be a boolean`);
  }

  const quizOutcome = record['quizOutcome'];
  if (
    quizOutcome !== undefined &&
    quizOutcome !== null &&
    quizOutcome !== 'correct' &&
    quizOutcome !== 'incorrect'
  ) {
    fail(channel, '"quizOutcome" must be "correct", "incorrect" or null');
  }

  return {
    interventionId,
    accepted: record['accepted'] as boolean,
    dismissed: record['dismissed'] as boolean,
    taskCompleted: record['taskCompleted'] as boolean,
    quizOutcome: (quizOutcome ?? null) as 'correct' | 'incorrect' | null,
  };
}

const SIMULATOR_COMMANDS = new Set<string>([
  'distraction',
  'return',
  'confusion',
  'overload',
  'success',
]);

export function parseSimulatorCommand(channel: string, value: unknown): SimulatorCommand {
  const record = asRecord(channel, value);
  const command = asString(channel, record, 'command');
  if (!SIMULATOR_COMMANDS.has(command)) fail(channel, `unknown simulator command "${command}"`);
  return {
    command: command as SimulatorCommand['command'],
    sessionId: asString(channel, record, 'sessionId'),
  };
}

/**
 * The renderer must never be able to reach Node directly, so every argument is
 * re-validated here even though TypeScript already types it.
 */
export function parseNoArgs(channel: string, value: unknown): void {
  if (value !== undefined && value !== null) {
    fail(channel, 'this channel takes no arguments');
  }
}
