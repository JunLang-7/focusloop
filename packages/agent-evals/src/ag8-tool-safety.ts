import type { AgentContext, LearningEvent } from '@focusloop/shared-types';
import {
  DEMO_COURSE_ID,
  ToolRegistry,
  createTestEngine,
  type ToolCallDeps,
  type TestEngine,
} from '@focusloop/agent-core';
import type { JsonValue } from './scenario';

/**
 * The 越权 tool scenarios (AG10.6): what the contract does when a call tries to cross it.
 *
 * Every observable comes from the real thing — the engine's registry for direct calls, the real
 * envelope for confirmation flow. The two permission-level cells (reversible, structural) register
 * synthetic tools at those levels in a fresh `ToolRegistry`: what is under test is the *refusal*,
 * which is #208's code, not a roster that happens to exist today. `handlerApplied` is the forbidden
 * observable — a write registration's handler that never runs is precisely what "refused before the
 * effect" means, and it is the thing a regression would turn true.
 */
interface Ag8ToolSafetyOutput {
  readonly ok: boolean;
  readonly reason: string | null;
  readonly eventsAdded: number;
  readonly lastEventType: string | null;
  readonly handlerApplied: boolean;
  readonly proposalStatus: string | null;
}

function engineSession(): { ctx: TestEngine; sessionId: string } {
  const ctx = createTestEngine();
  const { session } = ctx.engine.startSession(DEMO_COURSE_ID);
  return { ctx, sessionId: session.id };
}

function registryAtLevel(permission: 'reversible-write' | 'structural-write'): {
  registry: ToolRegistry;
  wasApplied: () => boolean;
} {
  let applied = false;
  const registry = new ToolRegistry();
  registry.register({
    tool: {
      name: permission === 'reversible-write' ? 'testReversible' : 'testStructural',
      version: 1,
      inputSchema: { type: 'object', properties: {}, required: [] },
      permission,
      idempotency: 'keyed',
    },
    handler: () => {
      applied = true;
      return null;
    },
  });
  return { registry, wasApplied: () => applied };
}

function registryDeps(sessionId: string): ToolCallDeps {
  let counter = 0;
  return {
    currentSessionId: sessionId,
    context: {} as AgentContext,
    now: '2026-01-01T00:00:00.000Z',
    id: () => `call-${(counter += 1)}`,
  };
}

/** Runs a step against an engine and reports what the attempt did to the log. */
function observe(
  ctx: TestEngine,
  sessionId: string,
  step: () => { ok: boolean; reason?: string | null },
): { ok: boolean; reason: string | null; eventsAdded: number; lastEventType: string | null } {
  const before = ctx.engine.listEvents(sessionId);
  const result = step();
  const after = ctx.engine.listEvents(sessionId);
  return {
    ok: result.ok,
    reason: result.ok ? null : (result.reason ?? null),
    eventsAdded: after.length - before.length,
    lastEventType:
      after.length > before.length ? (after[after.length - 1] as LearningEvent).type : null,
  };
}

/**
 * SAFETY: every field is a primitive the contract itself produced — a boolean, a count, a closed
 * reason string, an event-type name — so this boxes observations as the JSON the runner reads;
 * nothing here can carry an object the scenarios would then have to interpret as data.
 */
function asOutput(output: Ag8ToolSafetyOutput): JsonValue {
  /* SAFETY: every field is a primitive the contract itself produced — a boolean, a count, a closed
   * reason string, an event-type name — so this boxes observations as the JSON the runner reads;
   * nothing here can carry an object the scenarios would then have to interpret as data. */
  return output as unknown as JsonValue;
}

/**
 * Executes one scenario against the real contract and returns the observable set the JSON pins.
 * The input is `{ case }`; an unknown case throws — a scenario that tests nothing is a bug.
 */
export function runAg8ToolSafetyAdapter(input: JsonValue): JsonValue {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new Error('AG8 tool-safety input must be an object');
  }
  const scenarioCase = (input as { case?: unknown }).case;
  if (typeof scenarioCase !== 'string') throw new Error('AG8 tool-safety input needs a case');

  switch (scenarioCase) {
    case 'safe-read-crosses-the-direct-path': {
      // The safe-read cell: the direct path is where reads live, and running one writes no event.
      const { ctx, sessionId } = engineSession();
      try {
        const observed = observe(ctx, sessionId, () =>
          ctx.engine.executeToolCall({ sessionId, tool: 'readCurrentTask', args: {} }),
        );
        return asOutput({ ...observed, handlerApplied: false, proposalStatus: null });
      } finally {
        ctx.close();
      }
    }
    case 'reversible-write-crosses-into-permission':
    case 'structural-write-crosses-into-permission': {
      // The write cells: registered at the level, refused on the direct path — the handler never runs.
      const permission = scenarioCase.startsWith('reversible')
        ? 'reversible-write'
        : 'structural-write';
      const { registry, wasApplied } = registryAtLevel(permission);
      const result = registry.execute(
        {
          sessionId: 's1',
          tool: permission === 'reversible-write' ? 'testReversible' : 'testStructural',
          args: {},
        },
        registryDeps('s1'),
      );
      return asOutput({
        ok: result.ok,
        reason: result.ok ? null : result.reason,
        eventsAdded: 0,
        lastEventType: null,
        handlerApplied: wasApplied(),
        proposalStatus: null,
      });
    }
    case 'unknown-tool-refused': {
      const { ctx, sessionId } = engineSession();
      try {
        const observed = observe(ctx, sessionId, () =>
          ctx.engine.executeToolCall({ sessionId, tool: 'dropTable', args: { table: 'events' } }),
        );
        return asOutput({ ...observed, handlerApplied: false, proposalStatus: null });
      } finally {
        ctx.close();
      }
    }
    case 'malformed-args-refused': {
      const { ctx, sessionId } = engineSession();
      try {
        const observed = observe(ctx, sessionId, () =>
          ctx.engine.executeToolCall({
            sessionId,
            tool: 'readCurrentTask',
            args: { injected: true },
          }),
        );
        return asOutput({ ...observed, handlerApplied: false, proposalStatus: null });
      } finally {
        ctx.close();
      }
    }
    case 'wrong-session-refused': {
      const { ctx } = engineSession();
      try {
        const observed = observe(ctx, 'other-session', () =>
          ctx.engine.executeToolCall({
            sessionId: 'other-session',
            tool: 'readCurrentTask',
            args: {},
          }),
        );
        return asOutput({ ...observed, handlerApplied: false, proposalStatus: null });
      } finally {
        ctx.close();
      }
    }
    case 'execute-without-confirm-refused':
    case 'forged-key-refused':
    case 'replay-executes-once': {
      const { ctx, sessionId } = engineSession();
      try {
        // The confirm-flow cases count what the *whole* flow added — the propose is part of what
        // the scenario is about, not setup outside its window: a bypass that executed would show
        // itself as a second event and a status change, both of which the scenarios forbid.
        const beforeFlow = ctx.engine.listEvents(sessionId);
        const afterFlow = (): { added: number; last: string | null } => {
          const events = ctx.engine.listEvents(sessionId);
          return {
            added: events.length - beforeFlow.length,
            last:
              events.length > beforeFlow.length
                ? (events[events.length - 1] as LearningEvent).type
                : null,
          };
        };
        const proposed = ctx.engine.proposeStructuralChange({
          sessionId,
          kind: 'structural-write',
          payload: { op: 'demo' },
          createdBy: 'ag10.6',
          idempotencyKey: `ag10-${scenarioCase}`,
        });
        if (proposed.proposal === null) {
          throw new Error('the envelope refused to create the fixture proposal');
        }
        const proposalId = proposed.proposal.id;

        if (scenarioCase === 'execute-without-confirm-refused') {
          // The bypass: execution attempted on a proposal nobody confirmed.
          const execution = ctx.engine.executeProposal({
            proposalId,
            sessionId,
            idempotencyKey: proposed.proposal!.idempotencyKey,
          });
          const flow = afterFlow();
          const stored = ctx.store.getAgentProposal(proposalId);
          return asOutput({
            ok: execution.ok,
            reason: execution.ok ? null : execution.reason,
            eventsAdded: flow.added,
            lastEventType: flow.last,
            handlerApplied: false,
            proposalStatus: stored?.status ?? null,
          });
        }

        const confirmed = ctx.engine.confirmProposal({
          proposalId,
          sessionId,
          expectedHash: proposed.proposal.proposalHash,
        });
        if (!confirmed.ok) throw new Error('the fixture proposal refused its own confirmation');

        if (scenarioCase === 'forged-key-refused') {
          const execution = ctx.engine.executeProposal({
            proposalId,
            sessionId,
            idempotencyKey: 'not-the-real-key',
          });
          const flow = afterFlow();
          const stored = ctx.store.getAgentProposal(proposalId);
          return asOutput({
            ok: execution.ok,
            reason: execution.ok ? null : execution.reason,
            eventsAdded: flow.added,
            lastEventType: flow.last,
            handlerApplied: false,
            proposalStatus: stored?.status ?? null,
          });
        }

        // replay-executes-once: execute twice with the right key. `eventsAdded` is the whole flow's
        // count — proposal plus one execution — so a replay that wrote again would show a third.
        ctx.engine.executeProposal({
          proposalId,
          sessionId,
          idempotencyKey: proposed.proposal!.idempotencyKey,
        });
        const second = ctx.engine.executeProposal({
          proposalId,
          sessionId,
          idempotencyKey: proposed.proposal!.idempotencyKey,
        });
        const flow = afterFlow();
        const stored = ctx.store.getAgentProposal(proposalId);
        return asOutput({
          ok: second.ok,
          reason: second.ok ? null : second.reason,
          eventsAdded: flow.added,
          lastEventType: flow.last,
          handlerApplied: false,
          proposalStatus: stored?.status ?? null,
        });
      } finally {
        ctx.close();
      }
    }
    default:
      throw new Error(`AG8 tool-safety: unknown case "${scenarioCase}"`);
  }
}
