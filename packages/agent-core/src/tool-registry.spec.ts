import { describe, expect, it } from 'vitest';
import type { AgentContext, ToolCallRequest } from '@focusloop/shared-types';
import { createProviderSelection } from '@focusloop/llm-provider';
import { FocusLoopStore, openDatabase } from '@focusloop/persistence';
import { createTestEngine } from './test-helpers';
import { FocusLoopEngine } from './engine';
import { ToolRegistry, createAgentReadRegistry } from './tool-registry';

const DEPS = {
  currentSessionId: 's1',
  context: {} as AgentContext,
  now: '2026-01-01T00:00:00.000Z',
  id: (() => {
    let n = 0;
    return () => `call-${(n += 1)}`;
  })(),
};

function readRegistry(): ToolRegistry {
  return createAgentReadRegistry();
}

function request(partial: Partial<ToolCallRequest> & { tool?: string } = {}): ToolCallRequest {
  return { sessionId: 's1', tool: 'readCurrentTask', args: {}, ...partial } as ToolCallRequest;
}

describe('the tool registry contract (AG8.1)', () => {
  it('refuses a tool that is not registered, with a reason the renderer can read', () => {
    const result = readRegistry().execute(request({ tool: 'dropTable' }), DEPS);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('unknown-tool');
    expect(result.messageKey).toBe('tool.refusal.unknown-tool');
    expect(result.call.status).toBe('refused');
    expect(result.call.error).toBe('unknown-tool');
  });

  /*
   * The vocabulary is a closed list the registry owns, so hostile names are not "invalid SQL" —
   * they are simply not registered, and there is no path from a name to a query.
   */
  it('refuses SQL and channel-shaped names the same way', () => {
    for (const tool of ["'; DROP TABLE events; --", 'focusloop:data:delete-all', 'toString']) {
      const result = readRegistry().execute(request({ tool }), DEPS);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe('unknown-tool');
    }
  });

  it('refuses envelope fields the contract does not describe', () => {
    const forged = {
      sessionId: 's1',
      tool: 'readCurrentTask',
      args: {},
      permission: 'structural-write',
    } as unknown as ToolCallRequest;
    const result = readRegistry().execute(forged, DEPS);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('bad-schema');
  });

  it('refuses args the tool schema does not describe', () => {
    const registry = new ToolRegistry();
    registry.register({
      tool: {
        name: 'readThing',
        version: 1,
        inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
        permission: 'safe-read',
        idempotency: 'natural',
      },
      handler: () => 'ran',
    });

    const extra = registry.execute(
      request({ tool: 'readThing', args: { id: 'c1', permission: 'structural-write' } }),
      DEPS,
    );
    expect(extra.ok).toBe(false);
    if (!extra.ok) expect(extra.reason).toBe('bad-schema');

    const missing = registry.execute(request({ tool: 'readThing', args: {} }), DEPS);
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.reason).toBe('bad-schema');

    const wrongType = registry.execute(request({ tool: 'readThing', args: { id: 42 } }), DEPS);
    expect(wrongType.ok).toBe(false);
    if (!wrongType.ok) expect(wrongType.reason).toBe('bad-schema');
  });

  it('refuses prototype-polluting args and pollutes nothing', () => {
    const hostile = JSON.parse('{"__proto__":{"polluted":"yes"}}') as Record<string, unknown>;
    const result = readRegistry().execute(
      request({ tool: 'readCurrentTask', args: hostile }),
      DEPS,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('bad-schema');
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  });

  it('refuses an args blob larger than the audit bound', () => {
    const result = readRegistry().execute(
      request({
        tool: 'readCurrentTask',
        args: { note: 'x'.repeat(5000) },
      }),
      DEPS,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('bad-schema');
  });

  it('refuses a tool that is not a safe read on the direct path, without running it', () => {
    const registry = new ToolRegistry();
    let ran = false;
    registry.register({
      tool: {
        name: 'completeTask',
        version: 1,
        inputSchema: { type: 'object', properties: {}, required: [] },
        permission: 'structural-write',
        idempotency: 'keyed',
      },
      handler: () => {
        ran = true;
        return null;
      },
    });

    const result = registry.execute(request({ tool: 'completeTask' }), DEPS);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('permission');
    expect(ran).toBe(false);
  });

  it('refuses a call from another session — or from no session at all', () => {
    const other = readRegistry().execute(request({ sessionId: 's2' }), DEPS);
    expect(other.ok).toBe(false);
    if (!other.ok) expect(other.reason).toBe('wrong-session');

    const none = readRegistry().execute(request(), { ...DEPS, currentSessionId: null });
    expect(none.ok).toBe(false);
    if (!none.ok) expect(none.reason).toBe('wrong-session');
  });

  it('runs a safe read and records the call as ok', () => {
    const result = readRegistry().execute(request({ tool: 'readCurrentTask' }), DEPS);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.call.status).toBe('ok');
      expect(result.call.error).toBeNull();
      expect(result.call.tool).toBe('readCurrentTask');
    }
  });

  it('turns a throwing handler into a refusal rather than a crash', () => {
    const registry = new ToolRegistry();
    registry.register({
      tool: {
        name: 'readThing',
        version: 1,
        inputSchema: { type: 'object', properties: {}, required: [] },
        permission: 'safe-read',
        idempotency: 'natural',
      },
      handler: () => {
        throw new Error('boom');
      },
    });
    const result = registry.execute(request({ tool: 'readThing' }), DEPS);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('internal');
  });

  it('refuses an envelope that never named a session, and a non-object request', () => {
    const registry = readRegistry();
    const noSession = { tool: 'readCurrentTask', args: {} } as unknown as ToolCallRequest;
    const missing = registry.execute(noSession, DEPS);
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.reason).toBe('bad-schema');

    const nullish = null as unknown as ToolCallRequest;
    const nullResult = registry.execute(nullish, DEPS);
    expect(nullResult.ok).toBe(false);
    if (!nullResult.ok) expect(nullResult.reason).toBe('bad-schema');
  });

  it('refuses a non-string idempotency key', () => {
    const forged = {
      sessionId: 's1',
      tool: 'readCurrentTask',
      args: {},
      idempotencyKey: 42,
    } as unknown as ToolCallRequest;
    const result = readRegistry().execute(forged, DEPS);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('bad-schema');
  });

  it('refuses circular args without throwing, and records them as no args', () => {
    const args: Record<string, unknown> = {};
    args['self'] = args;
    const result = readRegistry().execute({ sessionId: 's1', tool: 'readCurrentTask', args }, DEPS);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('bad-schema');
      expect(result.call.args).toEqual({});
    }
  });

  it('registers the four reads and lists its closed vocabulary', () => {
    expect([...readRegistry().names()].sort()).toEqual([
      'readCheckpoint',
      'readConcept',
      'readCurrentTask',
      'readMaterial',
    ]);
  });

  it('refuses to register the same tool twice', () => {
    const registry = new ToolRegistry();
    const registration = {
      tool: {
        name: 'readThing',
        version: 1,
        inputSchema: { type: 'object', properties: {}, required: [] },
        permission: 'safe-read',
        idempotency: 'natural',
      } as const,
      handler: () => null,
    };
    registry.register(registration);
    expect(() => registry.register(registration)).toThrow(/already registered/);
  });

  it('refuses registration of a name outside the closed vocabulary', () => {
    const registry = new ToolRegistry();
    expect(() =>
      registry.register({
        tool: {
          name: 'read current task',
          version: 1,
          inputSchema: { type: 'object', properties: {}, required: [] },
          permission: 'safe-read',
          idempotency: 'natural',
        },
        handler: () => null,
      }),
    ).toThrow();
  });
});

describe('the four read tools over the engine', () => {
  it('serve exactly the AgentContext slices, not a second query path', () => {
    const ctx = createTestEngine();
    try {
      const { session } = ctx.engine.startSession('course-red-black-trees');
      ctx.engine.dispatch({
        sessionId: session.id,
        type: 'TASK_STARTED',
        source: 'user',
        payload: { taskId: 'rbt-t1' },
      });
      const context = ctx.engine.getAgentContext().context;
      expect(context).not.toBeNull();

      const outputs = ['readCurrentTask', 'readConcept', 'readMaterial', 'readCheckpoint'].map(
        (tool) => {
          const result = ctx.engine.executeToolCall({ sessionId: session.id, tool, args: {} });
          expect(result.ok).toBe(true);
          return result.ok ? result.output : null;
        },
      );

      expect(outputs[0]).toEqual(context?.task ?? null);
      expect(outputs[1]).toEqual(context?.concept ?? null);
      expect(outputs[2]).toEqual(context?.material ?? null);
      expect(outputs[3]).toEqual(context?.checkpoint ?? null);
    } finally {
      ctx.close();
    }
  });

  it('writes a ToolCall row for every attempt, refusals included', () => {
    const ctx = createTestEngine();
    try {
      const { session } = ctx.engine.startSession('course-red-black-trees');

      ctx.engine.executeToolCall({ sessionId: session.id, tool: 'readCurrentTask', args: {} });
      ctx.engine.executeToolCall({ sessionId: session.id, tool: 'dropTable', args: {} });
      ctx.engine.executeToolCall({ sessionId: 'other-session', tool: 'readCurrentTask', args: {} });

      const rows = ctx.store.listToolCalls(session.id);
      expect(rows).toHaveLength(2);
      expect(rows.map((row) => row.status).sort()).toEqual(['ok', 'refused']);
      expect(rows.find((row) => row.tool === 'dropTable')?.error).toBe('unknown-tool');
      // The cross-session attempt is recorded against the session it named, not silently dropped.
      expect(ctx.store.listToolCalls('other-session')).toHaveLength(1);
    } finally {
      ctx.close();
    }
  });

  it('exposes its attempts to a caller, with the events a read never writes (#210)', () => {
    const ctx = createTestEngine();
    try {
      const { session } = ctx.engine.startSession('course-red-black-trees');
      ctx.engine.executeToolCall({ sessionId: session.id, tool: 'readCurrentTask', args: {} });
      ctx.engine.executeToolCall({ sessionId: session.id, tool: 'dropTable', args: {} });

      const rows = ctx.engine.listToolCalls(session.id);
      expect(rows).toHaveLength(2);
      // Reads write no event and refusals write no change: null is the honest answer for both,
      // and the resolved-event path is the store's join, pinned in persistence against a real
      // executed proposal.
      expect(rows.every((row) => row.eventId === null)).toBe(true);
      expect(rows.find((row) => row.tool === 'dropTable')?.error).toBe('unknown-tool');
      expect(rows.find((row) => row.tool === 'readCurrentTask')?.status).toBe('ok');
      expect(ctx.engine.listToolCalls('other-session')).toEqual([]);
    } finally {
      ctx.close();
    }
  });

  it('writes no store state on the read path beyond its own audit row', () => {
    const db = openDatabase(':memory:');
    const plain = new FocusLoopStore(db);
    const calls: string[] = [];
    const recording = new Proxy(plain, {
      get(target, property, receiver) {
        const value = Reflect.get(target, property, receiver);
        if (typeof value !== 'function') return value;
        return (...args: unknown[]) => {
          calls.push(String(property));
          return (value as (...inner: unknown[]) => unknown).apply(target, args);
        };
      },
    }) as FocusLoopStore;

    const engine = new FocusLoopEngine({
      store: recording,
      providers: createProviderSelection(null),
      clock: () => '2026-01-01T00:10:00.000Z',
      idFactory: (() => {
        let n = 0;
        return () => `id-${(n += 1)}`;
      })(),
    });
    engine.initialize();
    engine.seedBuiltInCourses();

    try {
      const { session } = engine.startSession('course-red-black-trees');
      engine.dispatch({
        sessionId: session.id,
        type: 'TASK_STARTED',
        source: 'user',
        payload: { taskId: 'rbt-t1' },
      });
      const eventsBefore = engine.listEvents(session.id).length;

      calls.length = 0;
      for (const tool of ['readCurrentTask', 'readConcept', 'readMaterial', 'readCheckpoint']) {
        const result = engine.executeToolCall({ sessionId: session.id, tool, args: {} });
        expect(result.ok).toBe(true);
      }

      /*
       * "No store write on the path" has one named exception: the tool-call audit row the contract
       * itself promises (the raw material AG8.8 makes queryable). Everything else a write-shaped
       * method would have touched — events, sessions, checkpoints — is asserted absent by prefix,
       * so a new write helper cannot slip in unnoticed.
       */
      const WRITE_PREFIXES = [
        'save',
        'append',
        'insert',
        'mark',
        'set',
        'clear',
        'record',
        'replace',
        'delete',
        'update',
      ];
      const writes = calls.filter((name) =>
        WRITE_PREFIXES.some((prefix) => name.startsWith(prefix)),
      );
      expect(writes).toEqual([
        'insertToolCall',
        'insertToolCall',
        'insertToolCall',
        'insertToolCall',
      ]);
      expect(engine.listEvents(session.id)).toHaveLength(eventsBefore);
    } finally {
      engine.initialize(); // no-op on purpose: closes nothing; the store closes below
      plain.close();
    }
  });
});
