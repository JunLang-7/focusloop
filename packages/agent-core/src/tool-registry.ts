/**
 * The registry that makes a tool call mean something (AG8.1).
 *
 * Validation happens here, in the main process, in a fixed order chosen so that each check can
 * only run on input the previous check already vouched for: the envelope is shape-checked before
 * it is read, the tool name is looked up before its permission is graded, and the session is
 * compared only after the call is known to be well-formed and permitted. A refusal at any step
 * produces the same artifact — a `ToolCall` row and a reason — because the attempt is the record.
 *
 * The direct path runs safe reads only. Reversible and structural writes arrive through the
 * proposal envelope instead (ADR 0003 §2), so a write seen here is a permission violation by
 * construction, not a slower write.
 */
import {
  MAX_TOOL_ARGS_CHARACTERS,
  TOOL_REFUSAL_MESSAGE_KEYS,
  validateRuntimeSchema,
  type AgentContext,
  type AgentTool,
  type RuntimeSchema,
  type ToolCall,
  type ToolCallRequest,
  type ToolCallResult,
  type ToolRefusalReason,
} from '@focusloop/shared-types';

/** What a registered tool receives: the validated args and the session's bounded context. */
export type ToolHandler = (args: Record<string, unknown>, context: AgentContext) => unknown;

export interface ToolRegistration {
  readonly tool: AgentTool;
  readonly handler: ToolHandler;
}

/** Everything the registry needs from the engine to grade one call. */
export interface ToolCallDeps {
  /** The session the call must belong to; `null` when nothing is running. */
  readonly currentSessionId: string | null;
  /** The bounded context safe reads serve from; `null` when nothing is running. */
  readonly context: AgentContext | null;
  readonly now: string;
  readonly id: () => string;
}

/**
 * A registered name is code-authored, so it carries a pattern rather than escaping: lowercase
 * first letter, then letters and digits. Anything else never reaches the map, which is one more
 * reason an SQL-shaped name is simply unknown.
 */
const TOOL_NAME_PATTERN = /^[a-z][a-zA-Z0-9]*$/;

/** The only fields a request may carry. An extra one is refused, not ignored. */
const ENVELOPE_KEYS = new Set(['sessionId', 'tool', 'args', 'idempotencyKey']);

/** A non-null, non-array object: the only thing `args` or a request may be. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The registry: registered tools in, a `ToolCall` and an outcome out.
 *
 * Registering happens in code and never from data, so the map is a closed set a request can only
 * name — never extend, reshape, or reach past.
 */
export class ToolRegistry {
  private readonly tools = new Map<string, ToolRegistration>();

  /** Registering is a code path, not data: a bad name or a duplicate is a programming error. */
  register(registration: ToolRegistration): void {
    const { name } = registration.tool;
    if (!TOOL_NAME_PATTERN.test(name)) {
      throw new Error(`Tool name "${name}" is outside the closed vocabulary`);
    }
    if (this.tools.has(name)) {
      throw new Error(`Tool "${name}" is already registered`);
    }
    this.tools.set(name, registration);
  }

  /** The closed vocabulary, for whoever builds the model's schema over it. */
  names(): readonly string[] {
    return [...this.tools.keys()];
  }

  execute(request: ToolCallRequest, deps: ToolCallDeps): ToolCallResult {
    const raw: Record<string, unknown> = isPlainObject(request) ? request : {};
    const sessionId = typeof raw['sessionId'] === 'string' ? (raw['sessionId'] as string) : '';
    const toolName = typeof raw['tool'] === 'string' ? (raw['tool'] as string) : '';

    /*
     * The audit row's args must be safe to serialize no matter what the call carried: a circular
     * or oversized payload is recorded as what fits (or nothing) and refused a line later. The
     * refusal never throws, so a hostile call cannot take the attempt record down with it.
     */
    const rawArgs = isPlainObject(raw['args']) ? raw['args'] : {};
    let serialized: string | null = null;
    try {
      serialized = JSON.stringify(rawArgs);
    } catch {
      serialized = null;
    }
    const bounded = serialized !== null && serialized.length <= MAX_TOOL_ARGS_CHARACTERS;
    const rowArgs: Record<string, unknown> = bounded ? rawArgs : {};

    const call = (status: ToolCall['status'], error: ToolRefusalReason | null): ToolCall => ({
      id: deps.id(),
      sessionId,
      tool: toolName,
      args: rowArgs,
      status,
      confirmation: null,
      error,
      at: deps.now,
      idempotencyKey: typeof raw['idempotencyKey'] === 'string' ? raw['idempotencyKey'] : null,
    });

    const refuse = (reason: ToolRefusalReason): ToolCallResult => ({
      ok: false,
      reason,
      messageKey: TOOL_REFUSAL_MESSAGE_KEYS[reason],
      tool: toolName,
      call: call('refused', reason),
    });

    // 1. The envelope, before anything reads it as one.
    if (!isPlainObject(request) || typeof raw['sessionId'] !== 'string')
      return refuse('bad-schema');
    if (typeof raw['tool'] !== 'string') return refuse('bad-schema');
    for (const key of Object.keys(raw)) {
      if (!ENVELOPE_KEYS.has(key)) return refuse('bad-schema');
    }
    if (raw['args'] !== undefined && !isPlainObject(raw['args'])) return refuse('bad-schema');
    if (raw['idempotencyKey'] !== undefined && typeof raw['idempotencyKey'] !== 'string') {
      return refuse('bad-schema');
    }

    // 2. The name: unregistered is unknown, whatever it spells.
    const registration = this.tools.get(toolName);
    if (registration === undefined) return refuse('unknown-tool');

    // 3. The level: this path is safe-read only (ADR 0003 §2). Runs before args are parsed.
    if (registration.tool.permission !== 'safe-read') return refuse('permission');

    // 4. The args: the tool's schema, then the audit bound. Unknown keys are rejected by the
    // same validator the runtime uses for model output, so `permission` cannot ride in on args.
    const problems = validateRuntimeSchema(rawArgs, registration.tool.inputSchema);
    if (problems.length > 0) return refuse('bad-schema');
    // The same serialization the audit row uses: circular (unserializable) and oversized both
    // land here, once, instead of being re-checked against a payload that cannot change.
    if (!bounded) return refuse('bad-schema');

    // 5. The session: the call must name the session that is running, and there must be one.
    if (deps.currentSessionId === null || deps.currentSessionId !== sessionId) {
      return refuse('wrong-session');
    }
    if (deps.context === null) return refuse('wrong-session');

    // 6. The read itself. A throwing handler is `internal` — a refusal, never a crash.
    try {
      const output = registration.handler(rawArgs, deps.context);
      return { ok: true, call: call('ok', null), output };
    } catch {
      return refuse('internal');
    }
  }
}

/** An empty object schema: the four reads take no arguments, and smuggled ones are refused. */
const NO_ARGS: RuntimeSchema = { type: 'object', properties: {}, required: [] };

function readTool(name: string, pick: (context: AgentContext) => unknown): ToolRegistration {
  return {
    tool: {
      name,
      version: 1,
      inputSchema: NO_ARGS,
      permission: 'safe-read',
      idempotency: 'natural',
    },
    handler: (_args, context) => pick(context),
  };
}

/**
 * The four read tools (AG8.2).
 *
 * Every handler picks a slice of the `AgentContext` the inspector already shows — one builder,
 * one query path, no second way to read the store. That is what makes "side-effect free" a
 * structural property instead of a promise: there is no write call to reach for.
 */
export function createAgentReadRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register(readTool('readCurrentTask', (context) => context.task));
  registry.register(readTool('readConcept', (context) => context.concept));
  registry.register(readTool('readMaterial', (context) => context.material));
  registry.register(readTool('readCheckpoint', (context) => context.checkpoint));
  return registry;
}
