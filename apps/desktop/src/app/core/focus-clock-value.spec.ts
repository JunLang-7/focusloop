import { describe, expect, it } from 'vitest';
import { focusClockValue } from './focus-clock-value';
import { reset, start, tick } from './focus-timer';

describe('focusClockValue', () => {
  it('uses the task estimate before the timer starts', () => {
    expect(focusClockValue(reset(), 'active', 4)).toBe('4:00');
  });

  it('keeps zero visible after the timer expires', () => {
    const expired = tick(start(reset(1), 0), 60_000);
    expect(expired.phase).toBe('expired');
    expect(focusClockValue(expired, 'expired', 4)).toBe('0:00');
  });
});
