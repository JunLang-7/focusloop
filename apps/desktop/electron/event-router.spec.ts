import { describe, expect, it, vi } from 'vitest';
import type { BrowserWindow } from 'electron';
import { IPC_CHANNELS, type DispatchEventResponse } from '@focusloop/shared-types';
import { createEventRouter, type EventEngine } from './event-router';

/** A window that behaves like the two things the router asks of it. */
function fakeWindow(options: { readonly destroyed?: boolean } = {}) {
  const send = vi.fn();
  const webContents = {
    isDestroyed: () => options.destroyed === true,
    send,
  };
  const window = {
    isDestroyed: () => options.destroyed === true,
    webContents,
  } as unknown as BrowserWindow;
  return { window, send };
}

function response(state: string): DispatchEventResponse {
  return {
    event: {
      id: `e-${state}`,
      sessionId: 'session-1',
      type: 'TAB_LEFT',
      at: '2026-01-01T00:00:00.000Z',
      source: 'extension',
      payload: {},
    },
    state,
    checkpoint: null,
    resumeCard: null,
    decision: null,
    interventionId: null,
    rescue: null,
  } as unknown as DispatchEventResponse;
}

function engineFor(applied: string[]): EventEngine {
  return {
    dispatch: (request) => {
      applied.push(request.type);
      return response('INTERRUPTED');
    },
    getCurrentSession: () => ({ session: { id: 'session-1' } }),
  };
}

describe('the event router', () => {
  it('tells every live window what an applied event did, in the same step', () => {
    const applied: string[] = [];
    const first = fakeWindow();
    const second = fakeWindow();
    const router = createEventRouter(engineFor(applied), () => [first.window, second.window]);

    const result = router.dispatch({
      sessionId: 'session-1',
      type: 'TAB_LEFT',
      source: 'extension',
      payload: {},
      at: '2026-01-01T00:00:00.000Z',
    } as never);

    // Applied once, told twice, and the caller still gets the engine's own answer.
    expect(applied).toEqual(['TAB_LEFT']);
    expect(first.send).toHaveBeenCalledTimes(1);
    expect(second.send).toHaveBeenCalledTimes(1);
    expect(result.state).toBe('INTERRUPTED');
    /*
     * On the channel the renderer subscribes to, and with the whole response: the resume card the
     * engine offered in it is the half that went missing in #204.
     */
    expect(first.send).toHaveBeenCalledWith(
      IPC_CHANNELS.onEvent,
      expect.objectContaining({
        state: 'INTERRUPTED',
      }),
    );
  });

  /*
   * The regression, at the smallest scale it can be stated: applying without telling is what #204
   * was, so an implementation that only calls `dispatch` on the engine fails here.
   */
  it('does not apply a dispatch without publishing it', () => {
    const window = fakeWindow();
    const router = createEventRouter(engineFor([]), () => [window.window]);

    router.dispatch({
      sessionId: 'session-1',
      type: 'TAB_LEFT',
      source: 'extension',
      payload: {},
      at: '2026-01-01T00:00:00.000Z',
    } as never);

    expect(window.send).toHaveBeenCalledTimes(1);
  });

  it('skips a window that is gone, and keeps going', () => {
    const destroyed = fakeWindow({ destroyed: true });
    const alive = fakeWindow();
    const router = createEventRouter(engineFor([]), () => [destroyed.window, alive.window]);

    router.publish(response('FOCUSED'));

    expect(destroyed.send).not.toHaveBeenCalled();
    expect(alive.send).toHaveBeenCalledTimes(1);
  });

  /*
   * The other two entry points do not go through `dispatch`: a tick and a hand-built proposal
   * response are published directly, and they reach the same windows through the same function.
   */
  it('publishes a response the caller already has — a tick, or a proposal', () => {
    const window = fakeWindow();
    const router = createEventRouter(engineFor([]), () => [window.window]);

    router.publish(response('READY'));

    expect(window.send).toHaveBeenCalledTimes(1);
  });

  it('looks the windows up when it delivers, not when it is built', () => {
    const late = fakeWindow();
    let windows: readonly BrowserWindow[] = [];
    const router = createEventRouter(engineFor([]), () => windows);

    // The bridge is started before any window exists, so an empty list at construction is normal.
    router.publish(response('READY'));
    expect(late.send).not.toHaveBeenCalled();

    windows = [late.window];
    router.publish(response('READY'));
    expect(late.send).toHaveBeenCalledTimes(1);
  });

  it('leaves the session read to the engine it wraps', () => {
    const router = createEventRouter(engineFor([]), () => []);
    expect(router.getCurrentSession()).toEqual({ session: { id: 'session-1' } });
  });
});
