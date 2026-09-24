import { formatFocusTime, type FocusTimerState } from './focus-timer';

/** Use a task estimate only before the local timer has started. Zero is an elapsed value, not absence. */
export function focusClockValue(
  timer: FocusTimerState,
  visiblePhase: 'ready' | 'active' | 'paused' | 'expired' | 'complete',
  estimatedMinutes: number,
): string {
  const remainingMs =
    timer.phase === 'ready' && visiblePhase === 'active'
      ? estimatedMinutes * 60_000
      : timer.remainingMs;
  return formatFocusTime(remainingMs);
}
