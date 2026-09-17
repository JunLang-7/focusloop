import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { ProviderError } from '@focusloop/llm-provider';
import type { AIProvider } from '@focusloop/shared-types';
import { DEMO_COURSE_ID, createTestEngine, type TestEngine } from '@focusloop/agent-core';
import { startBridgeServer, type BridgeServerHandle } from './server';

/**
 * Degraded mode (#28).
 *
 * The core demo must survive every one of these:
 *   no network · no API key · provider timeout · extension disconnected.
 */
function offlineProvider(): AIProvider {
  return {
    id: 'deepseek',
    model: 'deepseek-chat',
    offline: false,
    complete: async () => {
      throw new ProviderError('offline', 'deepseek', 'network unreachable');
    },
  };
}

function timeoutProvider(): AIProvider {
  return {
    id: 'deepseek',
    model: 'deepseek-chat',
    offline: false,
    complete: async () => {
      throw new ProviderError('timeout', 'deepseek', 'timed out after 20000ms');
    },
  };
}

describe('degraded mode', () => {
  let ctx: TestEngine;

  beforeEach(() => {
    ctx = createTestEngine();
  });

  afterEach(() => {
    ctx.close();
  });

  it('completes the whole golden path with the offline mock provider', async () => {
    const { session } = ctx.engine.startSession(DEMO_COURSE_ID);

    ctx.engine.dispatch({
      sessionId: session.id,
      type: 'TASK_STARTED',
      source: 'user',
      payload: { taskId: 'rbt-t1' },
    });
    ctx.engine.dispatch({
      sessionId: session.id,
      type: 'TASK_COMPLETED',
      source: 'user',
      payload: { taskId: 'rbt-t1' },
    });

    ctx.engine.simulate({ command: 'distraction', sessionId: session.id });
    ctx.clock.advance(30_000);
    const returned = ctx.engine.simulate({ command: 'return', sessionId: session.id });
    expect(returned.state).toBe('INTERRUPTED');
    expect(returned.resumeCard).not.toBeNull();

    ctx.clock.advance(1_200);
    const resumed = ctx.engine.acceptResume(returned.checkpoint!.id);
    expect(resumed.outcome?.resumeLatencyMs).toBe(1_200);

    const dashboard = ctx.engine.getDashboard();
    expect(dashboard.interruptCount).toBe(1);
    expect(dashboard.tasksCompleted).toBe(1);
    expect(dashboard.averageResumeLatencyMs).toBe(1_200);
  });

  it('degrades to the mock provider when the real one is offline', async () => {
    const degraded = createTestEngine({
      providers: { primary: offlineProvider(), fallback: ctx.providers.fallback },
    });
    try {
      const result = await degraded.engine.enrich('Explain rotations.');
      expect(result.degraded).toBe(true);
      expect(result.failure).toMatchObject({ reason: 'offline', providerId: 'deepseek' });
      expect(result.text.length).toBeGreaterThan(0);
      expect(result.providerId).toBe('mock');
    } finally {
      degraded.close();
    }
  });

  it('degrades to the mock provider when the real one times out', async () => {
    const degraded = createTestEngine({
      providers: { primary: timeoutProvider(), fallback: ctx.providers.fallback },
    });
    try {
      const result = await degraded.engine.enrich('Explain rotations.');
      expect(result).toMatchObject({ degraded: true, providerId: 'mock' });
      expect(result.failure?.reason).toBe('timeout');
    } finally {
      degraded.close();
    }
  });

  it('keeps working when the extension never connects', () => {
    // No bridge is started at all: this is the "extension disconnected" case.
    const { session } = ctx.engine.startSession(DEMO_COURSE_ID);
    ctx.engine.simulate({ command: 'distraction', sessionId: session.id });
    ctx.clock.advance(30_000);
    const returned = ctx.engine.simulate({ command: 'return', sessionId: session.id });
    expect(returned.state).toBe('INTERRUPTED');
  });

  it('keeps working when the extension disconnects mid-session', async () => {
    ctx.engine.startSession(DEMO_COURSE_ID);
    const bridge = await startBridgeServer({ engine: ctx.engine, port: 0, token: 'a'.repeat(32) });

    await new Promise<void>((resolve) => {
      const socket = new WebSocket(bridge.url);
      socket.on('open', () => {
        socket.send(
          JSON.stringify({
            protocol: 1,
            type: 'TAB_LEFT',
            token: 'a'.repeat(32),
            eventId: 'e1',
            at: ctx.clock.now(),
            payload: {},
          }),
        );
      });
      socket.on('message', () => {
        // The extension goes away without telling anyone.
        socket.terminate();
        resolve();
      });
    });

    await bridge.close();
    expect(ctx.engine.getCurrentSession()?.session.state).toBe('DISTRACTED');

    // The learner can still finish and resume the session by hand.
    ctx.clock.advance(30_000);
    const tick = ctx.engine.tick();
    expect(tick?.state).toBe('INTERRUPTED');
    expect(tick?.resumeCard).not.toBeNull();

    ctx.clock.advance(2_000);
    const resumed = ctx.engine.acceptResume(tick!.checkpoint!.id);
    expect(resumed.state).toBe('RESUMING');
    expect(resumed.outcome?.resumeLatencyMs).toBe(2_000);
    expect(ctx.engine.getDashboard().interruptCount).toBe(1);
  });

  it('reports why the simulator is unavailable instead of failing silently', () => {
    const production = createTestEngine({ simulatorEnabled: false });
    try {
      const availability = production.engine.getSimulatorAvailability();
      expect(availability.enabled).toBe(false);
      expect(availability.reason.length).toBeGreaterThan(0);
    } finally {
      production.close();
    }
  });

  it('survives a port collision without taking the app down', async () => {
    const first: BridgeServerHandle = await startBridgeServer({
      engine: ctx.engine,
      port: 0,
      token: 'a'.repeat(32),
    });
    try {
      await expect(
        startBridgeServer({ engine: ctx.engine, port: first.port, token: 'b'.repeat(32) }),
      ).rejects.toBeTruthy();
      // The original bridge is untouched and the engine still runs.
      const { session } = ctx.engine.startSession(DEMO_COURSE_ID);
      expect(session.state).toBe('READY');
    } finally {
      await first.close();
    }
  });
});
