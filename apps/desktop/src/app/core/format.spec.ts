import { describe, expect, it } from 'vitest';
import { formatClock, formatDuration } from './format';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

describe('formatDuration', () => {
  it('counts seconds under an hour, so the figure that changes is always shown', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(9_000)).toBe('0:09');
    expect(formatDuration(3 * MINUTE + 9_000)).toBe('3:09');
    expect(formatDuration(59 * MINUTE + 59_000)).toBe('59:59');
  });

  /*
   * The reported defect, at the boundary that produced it: an hour of study was still counted in the
   * minutes field, and the field's width was whatever the number needed.
   */
  it('names the hours past an hour instead of counting them in minutes', () => {
    expect(formatDuration(HOUR)).toBe('1:00:00');
    expect(formatDuration(HOUR + 2 * MINUTE + 3_000)).toBe('1:02:03');
    expect(formatDuration(23 * HOUR + 59 * MINUTE + 59_000)).toBe('23:59:59');
  });

  it('names the days past a day, leaving the rest of the span in the clock', () => {
    expect(formatDuration(24 * HOUR)).toBe('1d 0:00:00');
    expect(formatDuration(50 * HOUR + 4 * MINUTE + 5_000)).toBe('2d 2:04:05');
  });

  /*
   * The exact number from the report: a session left open for a fortnight rendered as `21219:30`.
   * Whatever the caller is now allowed to pass, this function must not produce a bare five-digit
   * minutes field again — the span is legible or it is wrong.
   */
  it('reads a fortnight as a span rather than as five digits of minutes', () => {
    expect(formatDuration(21219 * MINUTE + 30_000)).toBe('14d 17:39:30');
  });

  it('floors nonsense rather than printing it', () => {
    expect(formatDuration(-1)).toBe('0:00');
    expect(formatDuration(Number.NaN)).toBe('0:00');
    expect(formatDuration(Number.POSITIVE_INFINITY)).toBe('0:00');
  });
});

describe('formatClock', () => {
  // A local 13:05. The two clocks write it differently in every locale the app supports, which is the
  // assertion — the exact AM/PM wording is the runtime's business, not this test's.
  const afternoon = new Date(2026, 0, 2, 13, 5, 0).toISOString();

  it('writes a time of day in the chosen clock', () => {
    expect(formatClock(afternoon, '12h')).not.toBe(formatClock(afternoon, '24h'));
  });

  it('says it has nothing rather than inventing a time', () => {
    expect(formatClock(undefined, '24h')).toBe('—');
    expect(formatClock('not-a-date', '12h')).toBe('—');
  });
});
