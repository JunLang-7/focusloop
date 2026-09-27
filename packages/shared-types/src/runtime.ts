/**
 * The serializable half of an agent runtime call.
 *
 * Everything here crosses process boundaries: it is JSON-safe, loggable and
 * testable without an `AbortSignal` (or any other non-serializable value) in
 * sight. Cancellation and other in-process controls live in
 * `RuntimeExecutionOptions` in `@focusloop/llm-provider` and must never be
 * added to this file or to any persisted path.
 */
export interface RuntimeRequestData {
  /** Which agent capability is asking — used for logs and audit, not for routing. */
  readonly skill: string;
  /** Shape the final structured result must satisfy. Omitted for plain text. */
  readonly schema?: RuntimeSchema;
  /** Character budget for context assembled around the prompt. */
  readonly contextBudget: number;
  /** Upper bound on completion tokens the caller is willing to spend. */
  readonly tokenBudget: number;
  /** Absolute deadline (epoch ms). Past deadline the call must not start. */
  readonly deadlineMs?: number;
}

/** A deliberately small, serializable schema for final structured results. */
export interface RuntimeSchema {
  readonly type: 'object';
  readonly properties: Readonly<Record<string, RuntimeSchemaProperty>>;
  readonly required?: readonly string[];
}

export interface RuntimeSchemaProperty {
  readonly type: 'string' | 'number' | 'boolean';
}

/** Outcome of a structured call. Only `value` (when present) may be committed. */
export type StructuredStatus = 'ok' | 'degraded' | 'aborted' | 'expired';

export interface StructuredRuntimeResult<T> {
  readonly status: StructuredStatus;
  /** Present only when status is `ok` or `degraded` and validation passed. */
  readonly value?: T;
  readonly providerId: string;
  readonly model: string;
  /** True when the primary provider failed or could not satisfy the schema. */
  readonly degraded: boolean;
  /** Why the primary was not used, if it was not. */
  readonly failureReason?: string;
}

export interface StreamRuntimeResult {
  readonly status: StructuredStatus;
  readonly providerId: string;
  readonly model: string;
  readonly degraded: boolean;
  readonly failureReason?: string;
}

/**
 * Validates a parsed JSON value against a runtime schema.
 *
 * Returns a list of human-readable problems; an empty list means the value
 * satisfies the schema. Kept intentionally strict: unknown keys are rejected
 * so a model cannot smuggle fields past the contract.
 */
export function validateRuntimeSchema(value: unknown, schema: RuntimeSchema): readonly string[] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return ['result must be a JSON object'];
  }
  const record = value as Record<string, unknown>;
  const problems: string[] = [];
  const allowed = new Set(Object.keys(schema.properties));

  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) problems.push(`unexpected property "${key}"`);
  }

  for (const required of schema.required ?? []) {
    if (!(required in record)) problems.push(`missing required property "${required}"`);
  }

  for (const [key, property] of Object.entries(schema.properties)) {
    if (!(key in record)) continue;
    const actual = record[key];
    const ok =
      property.type === 'string'
        ? typeof actual === 'string'
        : property.type === 'number'
          ? typeof actual === 'number' && Number.isFinite(actual)
          : typeof actual === 'boolean';
    if (!ok) problems.push(`property "${key}" must be ${property.type}`);
  }

  return problems;
}
