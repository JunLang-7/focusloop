import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FOCUS_MINUTES,
  MINUTE_MS,
  addMinute,
  formatFocusTime,
  reset,
  pause,
  resume,
  start,
  tick,
} from './focus-timer';

describe('focus timer', () => {
  it('starts ready with a three-minute micro-commitment', () => {
    const timer = reset(DEFAULT_FOCUS_MINUTES, 10_000);

    expect(timer).toMatchObject({
      phase: 'ready',
      durationMs: 3 * MINUTE_MS,
      remainingMs: 3 * MINUTE_MS,
      progress: 0,
    });
  });

  it('starts explicitly and ticks from the injected clock', () => {
    const ready = reset(3, 100);
    const active = start(ready, 1_000);
    const afterOneMinute = tick(active, 61_000);

    expect(active.phase).toBe('active');
    expect(afterOneMinute.remainingMs).toBe(2 * MINUTE_MS);
    expect(afterOneMinute.progress).toBeCloseTo(1 / 3);
    expect(afterOneMinute.endAtMs).toBe(181_000);
  });

  it('expires at the boundary and never reports negative time', () => {
    const active = start(reset(1), 0);
    const expired = tick(active, MINUTE_MS + 500);

    expect(expired.phase).toBe('expired');
    expect(expired.remainingMs).toBe(0);
    expect(expired.progress).toBe(1);
    expect(tick(expired, MINUTE_MS * 2)).toEqual(expired);
  });

  it('pauses with elapsed time accounted for and does not tick while paused', () => {
    const active = start(reset(3), 0);
    const paused = pause(active, MINUTE_MS);
    const later = tick(paused, MINUTE_MS * 10);

    expect(paused.phase).toBe('paused');
    expect(paused.remainingMs).toBe(2 * MINUTE_MS);
    expect(later).toEqual(paused);
  });

  it('resumes with the same remaining time from the new timestamp', () => {
    const paused = pause(start(reset(3), 0), MINUTE_MS);
    const resumed = resume(paused, MINUTE_MS * 5);

    expect(resumed.phase).toBe('active');
    expect(resumed.remainingMs).toBe(2 * MINUTE_MS);
    expect(resumed.endAtMs).toBe(MINUTE_MS * 7);
  });

  it('adds one minute immediately while active and preserves current progress', () => {
    const active = tick(start(reset(3), 0), MINUTE_MS);
    const extended = addMinute(active, MINUTE_MS);

    expect(extended.phase).toBe('active');
    expect(extended.durationMs).toBe(4 * MINUTE_MS);
    expect(extended.remainingMs).toBe(3 * MINUTE_MS);
    expect(extended.progress).toBe(0.25);
    expect(extended.endAtMs).toBe(4 * MINUTE_MS);
  });

  it('keeps add-minute paused and can recover an expired timer', () => {
    const paused = pause(start(reset(3), 0), MINUTE_MS);
    const extendedPaused = addMinute(paused, MINUTE_MS * 100);
    expect(extendedPaused.phase).toBe('paused');
    expect(extendedPaused.remainingMs).toBe(3 * MINUTE_MS);

    const expired = tick(start(reset(1), 0), MINUTE_MS);
    const recovered = addMinute(expired, MINUTE_MS);
    expect(recovered.phase).toBe('active');
    expect(recovered.remainingMs).toBe(MINUTE_MS);
  });

  it('does not mutate the input state', () => {
    const ready = reset();
    const active = start(ready, 0);

    expect(ready.phase).toBe('ready');
    expect(active).not.toBe(ready);
    expect(tick(active, MINUTE_MS)).not.toBe(active);
  });

  it('formats elapsed values as zero-padded mm:ss', () => {
    expect(formatFocusTime(0)).toBe('0:00');
    expect(formatFocusTime(3 * MINUTE_MS + 9_000)).toBe('3:09');
    expect(formatFocusTime(-1)).toBe('0:00');
    expect(formatFocusTime(61 * MINUTE_MS)).toBe('61:00');
  });

  it('clamps zero and negative commitments safely', () => {
    const empty = reset(-1);
    expect(empty).toMatchObject({ durationMs: 0, remainingMs: 0, progress: 1 });
    expect(start(empty, 0).phase).toBe('expired');
  });
});
