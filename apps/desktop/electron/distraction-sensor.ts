import { app, powerMonitor } from 'electron';
import { DEFAULT_STATE_ENGINE_CONFIG } from '@focusloop/learning-state';
import type { EventEngine } from './event-router';

/**
 * The app's own distraction sensor, and the reason it exists.
 *
 * Until now the only thing that could tell FocusLoop the learner had left was the browser
 * extension: a tab switch arrives over the socket, `TAB_LEFT` is dispatched, and the state engine
 * takes it from there. That is a real signal, and it is also the only one — so on a machine with no
 * extension installed nothing is ever detected, and the feature the product is built around silently
 * does nothing. The simulator's buttons were the offline stand-in, and a developer bar is not a
 * feature.
 *
 * What the app can observe by itself, with no extension and no permissions:
 *
 *  - **its own window losing focus.** The learner switching to a browser, a PDF or a notes app is
 *    the distraction this app exists to notice, and it is visible from the main process;
 *  - **the system going untouched.** `powerMonitor.getSystemIdleTime()` is seconds since the last
 *    keyboard or mouse input anywhere, which is the difference between "staring at the screen" and
 *    "gone".
 *
 * Both feed the same vocabulary the extension uses, and neither decides anything: this module is a
 * sensor, the state engine is the decider. Thresholds, escalation to `INTERRUPTED`, the resume card
 * and the intervention policy all stay where they were, so the observer adds a source of truth
 * rather than a second policy.
 *
 * **Overlap with the extension is expected and harmless by construction.** Switching to a browser
 * blurs this window *and* leaves the extension's tab, so two `TAB_LEFT` events can arrive. The
 * reducer stores `awaySince` on each and both compute the same state; the second only moves the
 * timestamp by the milliseconds between them, which cannot change whether the learner is helped.
 */

/** How often the ticker should sample idle time. Injected so tests need no wall clock. */
export interface DistractionSensorOptions {
  /**
   * Main-process clock, as an ISO string, matching the engine's own.
   *
   * The engine has one; this module takes it rather than calling `Date.now()` so an event it reports
   * is dated by the same clock as every event the engine writes.
   */
  readonly now: () => string;
  /**
   * Seconds since the last input anywhere in the system. `powerMonitor.getSystemIdleTime`, injected
   * because a unit test cannot press a key on the machine.
   */
  readonly idleSeconds: () => number;
  /** Defaults to the domain's `idleThresholdMs`; overridable for the same reason the engine allows it. */
  readonly idleThresholdMs?: number;
}

export interface DistractionSensor {
  /** Called from the ticker. Cheap: reads one number and usually does nothing. */
  sample(): void;
  /** Stops reporting. The window listeners are removed; a sensor left reporting after teardown would
   *  write events for a service that is closing. */
  dispose(): void;
}

/**
 * Input this recent means the learner is back at the machine.
 *
 * Not zero, because `getSystemIdleTime` only resets on a real input event and a mouse that moved a
 * second ago is not the same as one that has not moved: tying the "they are back" edge to a small
 * window keeps a jittery reading from reporting an end and a start in the same breath.
 */
const IDLE_RESUMED_MS = 3_000;

/** Whether the sensor is on at all. `0` turns it off, which is how the existing specs stay deterministic. */
export function distractionSensorEnabled(
  raw: string | undefined = process.env['FOCUSLOOP_DISTRACTION_SENSOR'],
): boolean {
  return raw !== '0';
}

/**
 * Starts the sensor. Returns a handle even when it is disabled, so the caller has one shape to shut
 * down rather than a conditional at every call site.
 */
export function startDistractionSensor(
  engine: EventEngine,
  options: DistractionSensorOptions,
): DistractionSensor {
  const idleThresholdMs = options.idleThresholdMs ?? DEFAULT_STATE_ENGINE_CONFIG.idleThresholdMs;

  /*
   * Whether this window has ever been in the foreground.
   *
   * A launch that opens behind another window is not the learner leaving, and a startup where focus
   * never arrives would otherwise look exactly like one — the app would report `TAB_LEFT` before the
   * learner had done anything, and every screen asserting a focused session would be wrong for a
   * reason nobody could see. So a blur only means something once a focus has been observed.
   */
  let hasBeenFocused = false;
  let blurredAtMs: number | null = null;
  let idleReported = false;
  let idleStartedAtMs: number | null = null;
  /*
   * Checked by both entry points, not just the listeners.
   *
   * Removing the window subscriptions is not enough on its own: `sample` is called from the ticker,
   * which outlives the teardown, so a disposed sensor would go on writing events for a service that
   * is closing its store.
   */
  let disposed = false;

  const dispatch = (request: Parameters<EventEngine['dispatch']>[0]): void => {
    if (disposed) return;
    try {
      engine.dispatch(request);
    } catch (error) {
      /*
       * Reported, never thrown. This runs from an Electron event handler and from a `setInterval`
       * callback: an uncaught throw in either one puts a dialog over the learner's work, and a sensor
       * that could not report an observation is not a reason to interrupt them.
       */
      console.error('FocusLoop could not record what it observed about the window:', error);
    }
  };

  /** The active session, or null when there is nothing to report against. */
  const sessionId = (): string | null => engine.getCurrentSession()?.session.id ?? null;

  const onBlur = (): void => {
    /*
     * Recorded even before a focus has been seen, so the first measured absence is the real one
     * rather than one that started when the window was first looked at.
     */
    blurredAtMs = Date.parse(options.now());
    if (!hasBeenFocused) return;
    const id = sessionId();
    if (id === null) return;
    dispatch({ sessionId: id, type: 'TAB_LEFT', source: 'system', payload: {} });
  };

  const onFocus = (): void => {
    const wasAway = hasBeenFocused && blurredAtMs !== null;
    const awayMs = wasAway ? Math.max(0, Date.parse(options.now()) - (blurredAtMs ?? 0)) : 0;
    hasBeenFocused = true;
    blurredAtMs = null;
    if (!wasAway) return;
    const id = sessionId();
    if (id === null) return;
    dispatch({ sessionId: id, type: 'TAB_RETURNED', source: 'system', payload: { awayMs } });
  };

  app.on('browser-window-blur', onBlur);
  app.on('browser-window-focus', onFocus);

  const sample = (): void => {
    if (disposed) return;
    const idleMs = options.idleSeconds() * 1000;
    const id = sessionId();
    if (id === null) {
      idleReported = false;
      idleStartedAtMs = null;
      return;
    }

    if (!idleReported) {
      if (idleMs < idleThresholdMs) return;
      /*
       * Dated when the silence began, not when it was noticed.
       *
       * `idleThresholdMs` is defined as the idle duration that turns `DISTRACTED` into
       * `INTERRUPTED`, and the domain escalates by counting from `idleSince`. Reporting the current
       * time as the start would make the learner wait twice — once for the app to notice, once again
       * for the rule — so the report carries the moment input actually stopped, which is also simply
       * when it happened.
       */
      const startedAtMs = Date.parse(options.now()) - idleMs;
      idleReported = true;
      idleStartedAtMs = startedAtMs;
      dispatch({
        sessionId: id,
        type: 'IDLE_STARTED',
        source: 'system',
        payload: {},
        at: new Date(startedAtMs).toISOString(),
      });
      return;
    }

    if (idleMs > IDLE_RESUMED_MS) return;
    const idleStartedAt = idleStartedAtMs;
    idleReported = false;
    idleStartedAtMs = null;
    dispatch({
      sessionId: id,
      type: 'IDLE_ENDED',
      source: 'system',
      payload: {
        idleMs: idleStartedAt === null ? idleMs : Date.parse(options.now()) - idleStartedAt,
      },
    });
  };

  return {
    sample,
    dispose: () => {
      disposed = true;
      app.off('browser-window-blur', onBlur);
      app.off('browser-window-focus', onFocus);
    },
  };
}

/** Seconds since the last system input. Wrapped so the module reads as one thing in `main.ts`. */
export function systemIdleSeconds(): number {
  return powerMonitor.getSystemIdleTime();
}
