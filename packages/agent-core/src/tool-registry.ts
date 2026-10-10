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
  /**
   * The read itself. Required of safe-read registrations (enforced at register time) and
   * deliberately absent for writes: a write never runs on the direct path — its effect belongs to
   * the confirmed execution (the engine's `onExecute`), not to a handler this registry could reach.
   */
  readonly handler?: ToolHandler;
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
    if (registration.tool.permission === 'safe-read' && registration.handler === undefined) {
      // A read with nothing to run would return `undefined` and call it an answer.
      throw new Error(`Safe-read tool "${name}" needs a handler`);
    }
    this.tools.set(name, registration);
  }

  /** A registration by name — `proposeStructuralChange` validates tool payloads against it (AG8.3). */
  get(name: string): ToolRegistration | undefined {
    return this.tools.get(name);
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
    let serialized: string | null;
    try {
      serialized = JSON.stringify(rawArgs);
    } catch {
      // A payload that cannot be serialized (circular, BigInt) is a payload the audit cannot
      // hold and the schema cannot have described: `null` reads as unbounded here and the
      // bounds check below refuses the call.
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

    // 6. The read itself. A throwing handler is `internal` — a refusal, never a crash. The `!` is
    // the register-time promise: a safe-read registration cannot exist without a handler, and step 3
    // has already established this is a safe-read.
    try {
      const output = registration.handler!(rawArgs, deps.context);
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

/**
 * The four lifecycle writes with engine effects (AG8.3), at their ADR 0003 matrix levels.
 *
 * `pauseTask` and `extendTask` are absent on purpose: the focus timer lives in a renderer signal
 * with no domain command to dispatch, and whether the model may pause a learner's timer at all is a
 * product question rather than a registration — recorded in the follow-up issue, not papered over
 * with a handler that does nothing.
 */
function lifecycleTools(): readonly ToolRegistration[] {
  const keyed = 'keyed' as const;
  const taskIdSchema: RuntimeSchema = {
    type: 'object',
    properties: { taskId: { type: 'string' } },
    required: ['taskId'],
  };
  return [
    {
      tool: {
        name: 'startTask',
        version: 1,
        inputSchema: taskIdSchema,
        permission: 'reversible-write',
        idempotency: keyed,
      },
    },
    {
      tool: {
        name: 'completeTask',
        version: 1,
        inputSchema: taskIdSchema,
        permission: 'structural-write',
        idempotency: keyed,
      },
    },
    {
      tool: {
        name: 'resumeTask',
        version: 1,
        inputSchema: {
          type: 'object',
          properties: { checkpointId: { type: 'string' } },
          required: ['checkpointId'],
        },
        permission: 'reversible-write',
        idempotency: keyed,
      },
    },
    {
      tool: {
        name: 'startBreak',
        version: 1,
        inputSchema: {
          type: 'object',
          properties: { interventionId: { type: 'string' } },
          required: ['interventionId'],
        },
        permission: 'reversible-write',
        idempotency: keyed,
      },
    },
  ];
}

/**
 * The adaptive-task tool (AG8.4): MICRO_START and SIMPLIFY as a reversible write — ADR 0003's row
 * that cites "derived on read, ends with the task or with Continue" as the reason it is reversible.
 */
function adaptiveTools(): readonly ToolRegistration[] {
  return [
    {
      tool: {
        name: 'createAdaptiveTask',
        version: 1,
        inputSchema: {
          type: 'object',
          properties: {
            action: { type: 'string' },
            taskId: { type: 'string' },
            interventionId: { type: 'string' },
          },
          required: ['action', 'taskId'],
        },
        permission: 'reversible-write',
        idempotency: 'keyed',
      },
    },
  ];
}

/**
 * The session-plan tools (AG8.5): both structural in ADR 0003 §3 — the rows with no way back.
 * `reorderSessionPlan` takes the whole intended order (a list, hence the schema's `array`), and
 * `saveCheckpoint` takes nothing: it builds the position resume will trust from the session as it
 * is, and there is no checkpoint delete to undo it with.
 */
function sessionPlanTools(): readonly ToolRegistration[] {
  return [
    {
      tool: {
        name: 'reorderSessionPlan',
        version: 1,
        inputSchema: {
          type: 'object',
          properties: { order: { type: 'array', items: { type: 'string' } } },
          required: ['order'],
        },
        permission: 'structural-write',
        idempotency: 'keyed',
      },
    },
    {
      tool: {
        name: 'saveCheckpoint',
        version: 1,
        inputSchema: { type: 'object', properties: {}, required: [] },
        permission: 'structural-write',
        idempotency: 'keyed',
      },
    },
  ];
}

/**
 * The registry the engine keeps: the four reads (AG8.2) and the writes (AG8.3/8.4).
 *
 * Writes are registered even though the direct path refuses them — registering is what lets a tool
 * proposal be validated against the same contract that would refuse a direct call, and it is what
 * makes "unknown tool" mean *unregistered* rather than *not yet*.
 */
export function createAgentRegistry(): ToolRegistry {
  const registry = createAgentReadRegistry();
  for (const registration of [...lifecycleTools(), ...adaptiveTools(), ...sessionPlanTools()]) {
    registry.register(registration);
  }
  return registry;
}
