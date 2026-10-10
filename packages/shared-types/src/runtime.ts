/**
 * The serializable half of an agent runtime call.
 *
 * Everything here crosses process boundaries: it is JSON-safe, loggable and
 * testable without an `AbortSignal` (or any other non-serializable value) in
 * sight. Cancellation and other in-process controls live in
 * `RuntimeExecutionOptions` in `@focusloop/llm-provider` and must never be
 * added to this file or to any persisted path.
 */
import type { CompletionUsage, ProviderFailure } from './provider';

/** Whole outbound input in UTF-16 code units, plus a per-completion provider token cap. */
export interface RuntimeBudgets {
  readonly contextBudget: number;
  readonly tokenBudget: number;
}

/** Counts/caps and a fixed unit label. Usage belongs to the selected completion, not all attempts. */
export interface RuntimeBudgetReport extends RuntimeBudgets {
  readonly callerMaxTokens?: number;
  readonly effectiveMaxTokens: number;
  readonly inputCharacters: number;
  readonly characterUnit: 'utf16-code-units';
  /** Absent when unknown; copied only from valid provider-reported counters. */
  readonly usage?: CompletionUsage;
}

export interface RuntimeRequestData extends RuntimeBudgets {
  /** Which agent capability is asking — used for logs and audit, not for routing. */
  readonly skill: string;
  /** Shape the final structured result must satisfy. Omitted for plain text. */
  readonly schema?: RuntimeSchema;
  /** Absolute deadline (epoch ms) for primary, retry and fallback; equality is expired. */
  readonly deadlineMs?: number;
}

/** A deliberately small, serializable schema for final structured results. */
export interface RuntimeSchema {
  readonly type: 'object';
  readonly properties: Readonly<Record<string, RuntimeSchemaProperty>>;
  readonly required?: readonly string[];
}

export interface RuntimeSchemaProperty {
  readonly type: 'string' | 'number' | 'boolean' | 'array';
  /**
   * Element types for `array`: homogeneous scalars, nothing nested.
   *
   * Added for tool arguments that are lists by nature — a plan reorder is the whole intended order,
   * not a single move (#23) — and shaped so both readers stay simple: the audit renders it, and a
   * provider receiving it as JSON Schema finds `type: array` with an optional `items` valid as-is.
   */
  readonly items?: { readonly type: 'string' | 'number' | 'boolean' };
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
  readonly budget?: RuntimeBudgetReport;
  /** Provider calls spent in total, bounded by the runtime retry policy. */
  readonly attempts?: number;
  /** Every failed attempt in order, so retries cannot hide provenance. */
  readonly failures?: readonly ProviderFailure[];
  /** Why the primary was not used, if it was not. */
  readonly failureReason?: string;
}

export interface StreamRuntimeResult {
  readonly budget?: RuntimeBudgetReport;
  readonly status: StructuredStatus;
  readonly providerId: string;
  readonly model: string;
  readonly degraded: boolean;
  readonly failureReason?: string;
}

/** One scalar check, used for both a property's own type and an array's elements. */
function matchesScalar(value: unknown, type: 'string' | 'number' | 'boolean'): boolean {
  if (type === 'string') return typeof value === 'string';
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  return typeof value === 'boolean';
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
    const items = property.items;
    const ok =
      property.type === 'array'
        ? Array.isArray(actual) &&
          (items === undefined ||
            (actual as readonly unknown[]).every((element) => matchesScalar(element, items.type)))
        : matchesScalar(actual, property.type);
    if (!ok) problems.push(`property "${key}" must be ${property.type}`);
  }

  return problems;
}
