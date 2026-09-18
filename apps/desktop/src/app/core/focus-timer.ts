/**
 * A small, immutable state machine for the focus micro-commitment.
 *
 * Time is injected into every transition. This keeps the state machine deterministic in the
 * renderer and makes it possible to test boundary conditions without fake global clocks.
 */

export const DEFAULT_FOCUS_MINUTES = 3;
export const MINUTE_MS = 60_000;

export type FocusTimerPhase = 'ready' | 'active' | 'paused' | 'expired';

export interface FocusTimerState {
  readonly phase: FocusTimerPhase;
  /** The currently committed duration, in milliseconds. */
  readonly durationMs: number;
  /** Time left at the last transition, in milliseconds. */
  readonly remainingMs: number;
  /** A bounded value suitable for an SVG/CSS progress ring. */
  readonly progress: number;
  /** Timestamp at which this commitment was started, when it has started. */
  readonly startedAtMs?: number;
  /** End timestamp while the timer is actively counting down. */
  readonly endAtMs?: number;
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const finiteOr = (value: number, fallback: number): number =>
  Number.isFinite(value) ? value : fallback;

const durationFor = (minutes: number): number =>
  Math.max(0, finiteOr(minutes, DEFAULT_FOCUS_MINUTES)) * MINUTE_MS;

const nowFor = (now: number): number => finiteOr(now, 0);

const progressFor = (durationMs: number, remainingMs: number): number =>
  durationMs <= 0 ? 1 : clamp(1 - remainingMs / durationMs, 0, 1);

const state = (
  phase: FocusTimerPhase,
  durationMs: number,
  remainingMs: number,
  startedAtMs?: number,
  endAtMs?: number,
): FocusTimerState => {
  const boundedDuration = Math.max(0, durationMs);
  const boundedRemaining = clamp(remainingMs, 0, boundedDuration);
  return {
    phase,
    durationMs: boundedDuration,
    remainingMs: boundedRemaining,
    progress: progressFor(boundedDuration, boundedRemaining),
    ...(startedAtMs === undefined ? {} : { startedAtMs }),
    ...(endAtMs === undefined ? {} : { endAtMs }),
  };
};

/** Create a fresh ready timer. Defaults to the three-minute micro-commitment. */
export function reset(minutes = DEFAULT_FOCUS_MINUTES, now = 0): FocusTimerState {
  // `now` is intentionally accepted even though ready timers do not use it. Keeping it in the
  // public transition makes reset interchangeable with the other time-injected operations.
  void now;
  const durationMs = durationFor(minutes);
  return state('ready', durationMs, durationMs);
}

/** Alias for callers that prefer a constructor-like name. */
export const createFocusTimer = reset;

/** Move a ready timer into its active counting-down state. */
export function start(timer: FocusTimerState, now: number): FocusTimerState {
  if (timer.phase !== 'ready') return timer;
  const startedAtMs = nowFor(now);
  if (timer.remainingMs <= 0) return state('expired', timer.durationMs, 0, startedAtMs);
  return state(
    'active',
    timer.durationMs,
    timer.remainingMs,
    startedAtMs,
    startedAtMs + timer.remainingMs,
  );
}

/** Reconcile an active timer with an injected timestamp. */
export function tick(timer: FocusTimerState, now: number): FocusTimerState {
  if (timer.phase !== 'active' || timer.endAtMs === undefined) return timer;

  const remainingMs = clamp(timer.endAtMs - nowFor(now), 0, timer.durationMs);
  return state(
    remainingMs === 0 ? 'expired' : 'active',
    timer.durationMs,
    remainingMs,
    timer.startedAtMs,
    remainingMs === 0 ? undefined : timer.endAtMs,
  );
}

/** Freeze an active timer. Time elapsed between calls is accounted for before pausing. */
export function pause(timer: FocusTimerState, now: number): FocusTimerState {
  const current = tick(timer, now);
  if (current.phase !== 'active') return current;
  return state('paused', current.durationMs, current.remainingMs, current.startedAtMs);
}

/** Continue a paused timer from its exact remaining duration. */
export function resume(timer: FocusTimerState, now: number): FocusTimerState {
  if (timer.phase !== 'paused') return timer;
  if (timer.remainingMs <= 0) return state('expired', timer.durationMs, 0, timer.startedAtMs);

  const resumedAtMs = nowFor(now);
  return state(
    'active',
    timer.durationMs,
    timer.remainingMs,
    timer.startedAtMs,
    resumedAtMs + timer.remainingMs,
  );
}

/**
 * Add one minute without losing elapsed time.
 *
 * A paused timer stays paused. Adding time to an expired timer intentionally reopens it as active,
 * which makes the control useful even when a user reaches the boundary before clicking it.
 */
export function addMinute(timer: FocusTimerState, now: number): FocusTimerState {
  const current = timer.phase === 'active' ? tick(timer, now) : timer;
  const durationMs = current.durationMs + MINUTE_MS;
  const remainingMs = current.remainingMs + MINUTE_MS;

  if (current.phase === 'ready') return state('ready', durationMs, remainingMs);
  if (current.phase === 'paused') {
    return state('paused', durationMs, remainingMs, current.startedAtMs);
  }

  const resumedAtMs = nowFor(now);
  return state(
    'active',
    durationMs,
    remainingMs,
    current.startedAtMs ?? resumedAtMs,
    resumedAtMs + remainingMs,
  );
}

/** Format milliseconds as the timer's stable, zero-padded `m:ss` display value. */
export function formatFocusTime(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(finiteOr(milliseconds, 0) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}
