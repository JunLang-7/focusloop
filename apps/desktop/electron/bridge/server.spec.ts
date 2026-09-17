import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { BRIDGE_PROTOCOL_VERSION, type BridgeOutboundMessage } from '@focusloop/shared-types';
import { DEMO_COURSE_ID, createTestEngine, type TestEngine } from '@focusloop/agent-core';
import { startBridgeServer, type BridgeServerHandle } from './server';

const TOKEN = 'a'.repeat(32);

function message(overrides: Partial<Record<string, unknown>> = {}): string {
  return JSON.stringify({
    protocol: BRIDGE_PROTOCOL_VERSION,
    type: 'TAB_LEFT',
    token: TOKEN,
    eventId: `e-${Math.random().toString(36).slice(2)}`,
    at: '2026-01-01T00:00:01.000Z',
    payload: { origin: 'https://example.com' },
    ...overrides,
  });
}

function send(url: string, payload: string): Promise<BridgeOutboundMessage> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error('bridge did not respond in time'));
    }, 4_000);

    socket.on('open', () => socket.send(payload));
    socket.on('message', (raw) => {
      clearTimeout(timer);
      resolve(JSON.parse(raw.toString()) as BridgeOutboundMessage);
      socket.close();
    });
    socket.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

describe('bridge server', () => {
  let ctx: TestEngine;
  let bridge: BridgeServerHandle;

  beforeEach(async () => {
    ctx = createTestEngine();
    const session = ctx.engine.startSession(DEMO_COURSE_ID);
    ctx.engine.dispatch({
      sessionId: session.session.id,
      type: 'TASK_STARTED',
      source: 'user',
      payload: { taskId: 'rbt-t1' },
    });
    bridge = await startBridgeServer({ engine: ctx.engine, port: 0, token: TOKEN });
  });

  afterEach(async () => {
    await bridge.close();
    ctx.close();
  });

  it('binds to loopback only', () => {
    expect(bridge.url).toContain('127.0.0.1');
    expect(bridge.url).not.toContain('0.0.0.0');
  });

  it('accepts a well formed event and reports the new state', async () => {
    const response = await send(bridge.url, message());
    expect(response.type).toBe('ACK');
    expect(response.state).toBe('DISTRACTED');
  });

  it('rejects a message with the wrong token', async () => {
    const response = await send(bridge.url, message({ token: 'b'.repeat(32) }));
    expect(response).toMatchObject({ type: 'ERROR', reason: 'unauthorized' });
  });

  it('rejects a token of the wrong length', async () => {
    const response = await send(bridge.url, message({ token: 'short' }));
    expect(response.type).toBe('ERROR');
  });

  it('rejects malformed JSON', async () => {
    const response = await send(bridge.url, 'not json');
    expect(response).toMatchObject({ type: 'ERROR', reason: 'malformed-json' });
  });

  it('rejects a message that fails schema validation', async () => {
    const response = await send(bridge.url, message({ type: 'EXECUTE_ARBITRARY_CODE' }));
    expect(response).toMatchObject({ type: 'ERROR', reason: 'schema-validation-failed' });
  });

  it('rejects a mismatched protocol version', async () => {
    const response = await send(bridge.url, message({ protocol: 99 }));
    expect(response.type).toBe('ERROR');
  });

  it('applies the same event id only once', async () => {
    const payload = message({ eventId: 'duplicate-1' });
    const first = await send(bridge.url, payload);
    const second = await send(bridge.url, payload);
    expect(first.type).toBe('ACK');
    expect(second.type).toBe('ACK');
    const events = ctx.engine.listEvents(ctx.engine.getCurrentSession()!.session.id);
    expect(events.filter((event) => event.type === 'TAB_LEFT')).toHaveLength(1);
  });

  it('acknowledges HELLO without touching session state', async () => {
    const response = await send(bridge.url, message({ type: 'HELLO' }));
    expect(response.type).toBe('ACK');
    expect(response.state).toBeUndefined();
  });

  it('strips a full URL down to its origin', async () => {
    await send(
      bridge.url,
      message({ payload: { origin: 'https://example.com/private/search?q=secret' } }),
    );
    const event = ctx.engine
      .listEvents(ctx.engine.getCurrentSession()!.session.id)
      .find((item) => item.type === 'TAB_LEFT');
    expect(event?.payload).toEqual({ origin: 'https://example.com' });
  });

  it('reports an error when no session is active', async () => {
    const idle = createTestEngine();
    try {
      const other = await startBridgeServer({ engine: idle.engine, port: 0, token: TOKEN });
      const response = await send(other.url, message());
      expect(response).toMatchObject({ type: 'ERROR', reason: 'no-active-session' });
      await other.close();
    } finally {
      idle.close();
    }
  });
});
