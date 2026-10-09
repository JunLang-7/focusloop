/**
 * The tool contract (AG8.1): what the agent may ask to do, and what happened when it asked.
 *
 * The closed vocabulary is the point. A tool call arrives as data, is validated against a
 * registered tool in the main process, and either runs a read that already exists or is refused
 * with a reason the renderer can render. Nothing here names a table, a channel or a file: the
 * model's choice is among registered names, and an unregistered name is simply unknown.
 *
 * Permission levels are ADR 0003's — safe-read runs on the direct path; reversible-write and
 * structural-write go through the proposal envelope instead (phase 2), which is why `execute` on
 * the direct path refuses anything that is not a safe read.
 */
import type { ToolMessageKey } from './messages';
import type { RuntimeSchema } from './runtime';

/** ADR 0003 §1. Closed: adding a level amends the ADR, not this file alone. */
export const TOOL_PERMISSIONS = ['safe-read', 'reversible-write', 'structural-write'] as const;

export type AgentToolPermission = (typeof TOOL_PERMISSIONS)[number];

export function isToolPermission(value: unknown): value is AgentToolPermission {
  return typeof value === 'string' && (TOOL_PERMISSIONS as readonly string[]).includes(value);
}

/** How a tool's calls stay single — ADR 0003 §3: reads are natural, writes carry the call's key. */
export type ToolIdempotency = 'natural' | 'keyed';

/** A registered tool. `inputSchema` is the serializable schema the args are validated against. */
export interface AgentTool {
  readonly name: string;
  readonly version: number;
  readonly inputSchema: RuntimeSchema;
  readonly permission: AgentToolPermission;
  readonly idempotency: ToolIdempotency;
}

/** Why a tool call could not run. Closed, total, and each reason has a message key. */
export const TOOL_REFUSAL_REASONS = [
  'unknown-tool',
  'bad-schema',
  'wrong-session',
  'permission',
  'internal',
] as const;

export type ToolRefusalReason = (typeof TOOL_REFUSAL_REASONS)[number];

export type ToolCallStatus = 'ok' | 'refused';

/**
 * One attempt, whether it ran or was refused — the raw material AG8.8 makes queryable.
 *
 * `args` is what the call carried, bounded on the way in (see `MAX_TOOL_ARGS_CHARACTERS`);
 * `confirmation` is the proposal id a write executed under and is `null` for every read.
 */
export interface ToolCall {
  readonly id: string;
  readonly sessionId: string;
  readonly tool: string;
  readonly args: Record<string, unknown>;
  readonly status: ToolCallStatus;
  readonly confirmation: string | null;
  readonly error: ToolRefusalReason | null;
  readonly at: string;
  /** Reads carry none (ADR 0003 §3); write tools are keyed at the call level. */
  readonly idempotencyKey: string | null;
}

/** What the caller sends. Unknown envelope fields are refused, not ignored. */
export interface ToolCallRequest {
  readonly sessionId: string;
  readonly tool: string;
  readonly args?: Record<string, unknown>;
  readonly idempotencyKey?: string;
}

/** A refusal the renderer can show: a closed reason plus a translatable key. */
export interface ToolRefusal {
  readonly ok: false;
  readonly reason: ToolRefusalReason;
  readonly messageKey: ToolMessageKey;
  readonly tool: string;
  /** The attempt's row — written even though nothing ran. */
  readonly call: ToolCall;
}

export interface ToolCallOk {
  readonly ok: true;
  readonly call: ToolCall;
  readonly output: unknown;
}

export type ToolCallResult = ToolCallOk | ToolRefusal;

/**
 * Args are recorded verbatim in the audit row, so they are bounded before anything runs.
 *
 * 4 KiB is one screenful of ids and options — a call that needs more is a malformed call, not a
 * big one. The bound rejects rather than truncates: a half-validated arg is worse than a refusal.
 */
export const MAX_TOOL_ARGS_CHARACTERS = 4096;

/** Strings longer than this are not kept verbatim in the audit — ids are short, prose is not. */
export const TOOL_ARGS_KEEP_CHARS = 64;

/** Redaction stops descending here; a call nested deeper than this is answered as redacted. */
export const TOOL_REDACT_DEPTH = 4;

/**
 * What the audit keeps of a call's arguments (AG8.8).
 *
 * The rule from ADR 0001's discipline: the row answers *what was attempted*, which is the keys and
 * the short identifiers — not a second copy of the learner's content. Anything longer than
 * `TOOL_ARGS_KEEP_CHARS` becomes a length marker, at any depth, and the walk is total: circular
 * input degrades to redacted values rather than an exception inside an audit write.
 */
/** What one step of the walk can produce: JSON only, because a tool-call row stores JSON. */
type RedactedValue =
  | string
  | number
  | boolean
  | null
  | { readonly [key: string]: RedactedValue }
  | readonly RedactedValue[];

export function redactToolArgs(args: Record<string, unknown>): Record<string, unknown> {
  const seen = new WeakSet<object>();
  const visit = (value: unknown, depth: number): RedactedValue => {
    if (typeof value === 'string') {
      return value.length > TOOL_ARGS_KEEP_CHARS ? `[redacted ${value.length} chars]` : value;
    }
    if (value === null) return null;
    if (typeof value === 'number' || typeof value === 'boolean') return value;
    // undefined, symbols, functions, bigint: never JSON, so never verbatim in the audit.
    if (typeof value !== 'object') return '[redacted]';
    if (depth >= TOOL_REDACT_DEPTH || seen.has(value)) return '[redacted]';
    seen.add(value);
    if (Array.isArray(value)) return value.map((item) => visit(item, depth + 1));
    const out: Record<string, RedactedValue> = {};
    for (const key of Object.keys(value)) {
      out[key] = visit((value as Record<string, unknown>)[key], depth + 1);
    }
    return out;
  };

  try {
    const result = visit(args, 0);
    if (typeof result === 'object' && result !== null && !Array.isArray(result)) {
      return result as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}

/**
 * A stored call as the inspector reads it: the row plus the domain event it resolved to, if any.
 *
 * `eventId` is `null` for every read — a read writes no event, which is the read path's proof —
 * and for every refusal, where `error` says what happened instead. For a call confirmed through
 * the envelope it is `agent_proposals.event_id`, resolved in the same query that fetches the row.
 */
export interface ToolCallRecord extends ToolCall {
  readonly eventId: string | null;
}

/** The refusal reason to its message key, typed both ways so neither list can drift. */
export const TOOL_REFUSAL_MESSAGE_KEYS: Readonly<Record<ToolRefusalReason, ToolMessageKey>> = {
  'unknown-tool': 'tool.refusal.unknown-tool',
  'bad-schema': 'tool.refusal.bad-schema',
  'wrong-session': 'tool.refusal.wrong-session',
  permission: 'tool.refusal.permission',
  internal: 'tool.refusal.internal',
};
