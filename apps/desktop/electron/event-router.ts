import type { BrowserWindow, WebContents } from 'electron';
import {
  IPC_CHANNELS,
  type DispatchEventRequest,
  type DispatchEventResponse,
} from '@focusloop/shared-types';

/**
 * What an event entry point needs from the engine, and no more.
 *
 * Narrow on purpose. The renderer's dispatch channel, the simulator, the extension's socket and the
 * five-second tick all need exactly these two calls; a type that offers only them is a type that
 * cannot grow a fifth way to change state without coming through this file.
 */
export interface EventEngine {
  dispatch(request: DispatchEventRequest): DispatchEventResponse;
  getCurrentSession(): { readonly session: { readonly id: string } } | null;
}

export interface EventRouter extends EventEngine {
  /** Tells every window about a response the caller already has — a tick, or one built by hand. */
  publish(response: DispatchEventResponse): void;
}

/** Tells one window what the engine just did. */
export function pushEvent(target: WebContents, response: DispatchEventResponse): void {
  if (target.isDestroyed()) return;
  target.send(IPC_CHANNELS.onEvent, response);
}

/**
 * Applies an event and tells the windows, as one step, for every path that changes state.
 *
 * This exists because applying and telling were two steps, and one entry point did only the first
 * (#204): the extension reported `TAB_LEFT`, the engine moved to `DISTRACTED`, the socket
 * acknowledged it — and the window went on showing a focused session, with the resume card the
 * engine had already offered nowhere on screen, until an unrelated five-second tick happened to
 * carry a response. The learner's absence was recorded in the store and invisible in the app.
 *
 * The fix is not a push added to that one caller. It is a single door: `dispatch` here applies and
 * publishes, so a fourth entry point cannot repeat the omission, and the three existing ones stop
 * each deciding for themselves whether the renderer needs to know.
 *
 * Every window is told rather than only the caller, and that is deliberate. There is one engine
 * behind all of them, so a window that did not ask is still looking at a state the engine has left —
 * which is the same defect, one window over. A destroyed window is skipped: on macOS a closed window
 * outlives `window-all-closed`.
 */
export function createEventRouter(
  engine: EventEngine,
  windows: () => readonly BrowserWindow[],
): EventRouter {
  function publish(response: DispatchEventResponse): void {
    for (const window of windows()) {
      if (window.isDestroyed()) continue;
      pushEvent(window.webContents, response);
    }
  }

  return {
    getCurrentSession: () => engine.getCurrentSession(),
    dispatch: (request) => {
      const response = engine.dispatch(request);
      publish(response);
      return response;
    },
    publish,
  };
}
