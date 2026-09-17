import { describe, expect, it } from 'vitest';
import { BRIDGE_PROTOCOL_VERSION } from '@focusloop/shared-types';
import { ActivityTracker } from './tracker';
import { BridgeClient, type SocketLike } from './bridge-client';

const T0 = 1_000_000;

describe('ActivityTracker', () => {
  it('adopts the first activated tab as the learning tab without emitting', () => {
    const tracker = new ActivityTracker();
    expect(tracker.onTabActivated(1, T0)).toBeNull();
    expect(tracker.snapshot().learningTabId).toBe(1);
  });

  it('emits TAB_LEFT when the learner switches away', () => {
    const tracker = new ActivityTracker();
    tracker.onTabActivated(1, T0);
    expect(tracker.onTabActivated(2, T0 + 1_000)).toEqual({ type: 'TAB_LEFT', payload: {} });
  });

  it('emits TAB_RETURNED with the measured duration', () => {
    const tracker = new ActivityTracker();
    tracker.onTabActivated(1, T0);
    tracker.onTabActivated(2, T0 + 1_000);
    expect(tracker.onTabActivated(1, T0 + 31_000)).toEqual({
      type: 'TAB_RETURNED',
      payload: { awayMs: 30_000 },
    });
  });

  it('does not emit a second TAB_LEFT while already away', () => {
    const tracker = new ActivityTracker();
    tracker.onTabActivated(1, T0);
    tracker.onTabActivated(2, T0 + 1_000);
    expect(tracker.onTabActivated(3, T0 + 2_000)).toBeNull();
  });

  it('does not emit when re-activating the learning tab while present', () => {
    const tracker = new ActivityTracker();
    tracker.onTabActivated(1, T0);
    expect(tracker.onTabActivated(1, T0 + 500)).toBeNull();
  });

  it('tracks window focus loss and regain', () => {
    const tracker = new ActivityTracker();
    tracker.onTabActivated(1, T0);
    expect(tracker.onWindowFocusLost(T0 + 1_000)).toEqual({ type: 'TAB_LEFT', payload: {} });
    expect(tracker.onWindowFocusLost(T0 + 2_000)).toBeNull();
    expect(tracker.onWindowFocusGained(T0 + 9_000)).toEqual({
      type: 'TAB_RETURNED',
      payload: { awayMs: 8_000 },
    });
  });

  it('ignores focus gain when the learner was never away', () => {
    const tracker = new ActivityTracker();
    tracker.onTabActivated(1, T0);
    expect(tracker.onWindowFocusGained(T0 + 1_000)).toBeNull();
  });

  it('emits IDLE_STARTED and IDLE_ENDED around an idle period', () => {
    const tracker = new ActivityTracker();
    expect(tracker.onIdleStateChanged('idle', T0)).toEqual({ type: 'IDLE_STARTED', payload: {} });
    expect(tracker.onIdleStateChanged('locked', T0 + 5_000)).toBeNull();
    expect(tracker.onIdleStateChanged('active', T0 + 200_000)).toEqual({
      type: 'IDLE_ENDED',
      payload: { idleMs: 200_000 },
    });
  });

  it('ignores an active transition when the learner was never idle', () => {
    const tracker = new ActivityTracker();
    expect(tracker.onIdleStateChanged('active', T0)).toBeNull();
  });

  it('clamps negative durations to zero', () => {
    const tracker = new ActivityTracker();
    tracker.onTabActivated(1, T0);
    tracker.onTabActivated(2, T0 + 1_000);
    expect(tracker.onTabActivated(1, T0)).toEqual({ type: 'TAB_RETURNED', payload: { awayMs: 0 } });
  });

  it('never reports a URL, title or origin — it cannot see one', () => {
    const tracker = new ActivityTracker();
    tracker.onTabActivated(7, T0);
    const snapshot = tracker.snapshot();
    expect(Object.keys(snapshot).sort()).toEqual(['awaySince', 'idleSince', 'learningTabId']);
  });

  it('resets cleanly', () => {
    const tracker = new ActivityTracker();
    tracker.onTabActivated(1, T0);
    tracker.reset();
    expect(tracker.snapshot().learningTabId).toBeNull();
  });
});

class FakeSocket implements SocketLike {
  readyState = 0;
  readonly sent: string[] = [];
  closed = false;
  private readonly listeners = new Map<string, Array<(event: unknown) => void>>();

  constructor() {
    queueMicrotask(() => this.open());
  }

  addEventListener(type: string, listener: (event: unknown) => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }

  send(data: string): void {
    if (this.readyState !== 1) throw new Error('not open');
    this.sent.push(data);
  }

  close(): void {
    this.closed = true;
    this.readyState = 3;
  }

  open(): void {
    this.readyState = 1;
    this.dispatch('open', {});
  }

  receive(payload: unknown): void {
    this.dispatch('message', { data: JSON.stringify(payload) });
  }

  failConnection(): void {
    this.readyState = 3;
    this.dispatch('close', {});
  }

  private dispatch(type: string, event: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

function createClient(sockets: FakeSocket[], overrides: Record<string, unknown> = {}) {
  let counter = 0;
  return new BridgeClient({
    url: () => 'ws://127.0.0.1:47615',
    token: () => 'a'.repeat(32),
    now: () => T0,
    idFactory: () => `id-${(counter += 1)}`,
    socketFactory: () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    },
    reconnectBaseMs: 10,
    reconnectMaxMs: 40,
    setTimeoutFn: ((fn: () => void) => {
      fn();
      return 0;
    }) as unknown as (fn: () => void, ms: number) => unknown,
    clearTimeoutFn: () => undefined,
    ...overrides,
  });
}

describe('BridgeClient', () => {
  it('queues then flushes an event once connected', async () => {
    const sockets: FakeSocket[] = [];
    const client = createClient(sockets);
    client.emit('TAB_LEFT');
    await Promise.resolve();
    await Promise.resolve();
    const socket = sockets[0];
    expect(socket?.sent).toHaveLength(1);
    const message = JSON.parse(socket!.sent[0]!) as Record<string, unknown>;
    expect(message['type']).toBe('TAB_LEFT');
    expect(message['protocol']).toBe(BRIDGE_PROTOCOL_VERSION);
    expect(message['token']).toBe('a'.repeat(32));
    client.stop();
  });

  it('keeps a stable event id per emission', async () => {
    const sockets: FakeSocket[] = [];
    const client = createClient(sockets);
    const first = client.emit('TAB_LEFT');
    const second = client.emit('TAB_RETURNED', { awayMs: 5_000 });
    await Promise.resolve();
    await Promise.resolve();
    expect(first).not.toBe(second);
    const ids = sockets[0]!.sent.map((raw) => (JSON.parse(raw) as { eventId: string }).eventId);
    expect(new Set(ids).size).toBe(ids.length);
    client.stop();
  });

  it('never sends page content — the payload schema is closed', async () => {
    const sockets: FakeSocket[] = [];
    const client = createClient(sockets);
    client.emit('TAB_LEFT', { origin: 'https://example.com' });
    await Promise.resolve();
    await Promise.resolve();
    const message = JSON.parse(sockets[0]!.sent[0]!) as { payload: Record<string, unknown> };
    expect(Object.keys(message.payload)).toEqual(['origin']);
    client.stop();
  });

  it('reports the state the desktop acknowledges', async () => {
    const sockets: FakeSocket[] = [];
    const client = createClient(sockets);
    client.emit('TAB_LEFT');
    await Promise.resolve();
    await Promise.resolve();
    sockets[0]!.receive({ protocol: 1, type: 'ACK', state: 'DISTRACTED' });
    expect(client.status().lastState).toBe('DISTRACTED');
    client.stop();
  });

  it('records an error response', async () => {
    const sockets: FakeSocket[] = [];
    const client = createClient(sockets);
    client.emit('TAB_LEFT');
    await Promise.resolve();
    await Promise.resolve();
    sockets[0]!.receive({ protocol: 1, type: 'ERROR', reason: 'unauthorized' });
    expect(client.status().lastError).toBe('unauthorized');
    client.stop();
  });

  it('reconnects after the socket closes', async () => {
    const sockets: FakeSocket[] = [];
    const client = createClient(sockets);
    client.emit('TAB_LEFT');
    await Promise.resolve();
    await Promise.resolve();
    expect(sockets).toHaveLength(1);

    sockets[0]!.failConnection();
    await Promise.resolve();
    expect(sockets.length).toBeGreaterThanOrEqual(2);
    client.stop();
  });

  it('bounds the offline queue', () => {
    const sockets: FakeSocket[] = [];
    const client = createClient(sockets, { maxQueueSize: 3 });
    for (let index = 0; index < 10; index += 1) client.emit('TAB_LEFT');
    expect(client.status().queued).toBeLessThanOrEqual(3);
    client.stop();
  });

  it('stops cleanly and ignores further emissions', () => {
    const sockets: FakeSocket[] = [];
    const client = createClient(sockets);
    client.start();
    client.stop();
    client.emit('TAB_LEFT');
    expect(sockets[0]?.closed).toBe(true);
  });

  it('survives a socket factory that throws', () => {
    const client = new BridgeClient({
      url: () => 'ws://127.0.0.1:1',
      token: () => 'a'.repeat(32),
      socketFactory: () => {
        throw new Error('constructor exploded');
      },
      setTimeoutFn: (() => 0) as unknown as (fn: () => void, ms: number) => unknown,
      clearTimeoutFn: () => undefined,
    });
    expect(() => client.emit('TAB_LEFT')).not.toThrow();
    expect(client.status().lastError).toBeTruthy();
    client.stop();
  });
});
