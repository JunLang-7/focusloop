import { describe, expect, it } from 'vitest';
import { reminderDateKey, reminderDue, reminderMinutes } from './reminder';

const at = (hours: number, minutes: number): Date => new Date(2026, 5, 15, hours, minutes, 0, 0);

describe('reminderMinutes', () => {
  it('reads HH:MM as minutes since midnight', () => {
    expect(reminderMinutes('00:00')).toBe(0);
    expect(reminderMinutes('09:30')).toBe(570);
    expect(reminderMinutes('23:59')).toBe(1439);
  });

  it('refuses anything that is not a time', () => {
    expect(reminderMinutes('9:30')).toBeNull();
    expect(reminderMinutes('24:00')).toBeNull();
    expect(reminderMinutes('09:60')).toBeNull();
    expect(reminderMinutes('')).toBeNull();
  });
});

describe('reminderDue', () => {
  const base = {
    enabled: true,
    reminderTime: '09:00',
    lastFiredDate: null,
    runningSince: at(8, 0),
  } as const;

  it('is not due before the chosen time, and is at it', () => {
    expect(reminderDue({ ...base, now: at(8, 59) })).toBe(false);
    expect(reminderDue({ ...base, now: at(9, 0) })).toBe(true);
  });

  /*
   * "At or after" is the point: a timer that was asleep or throttled, or a session that was running at
   * 09:00 and ended at 09:20, still gets one reminder. `lastFiredDate` is what stops "late" from becoming
   * "every minute after".
   */
  it('is still due later the same day when the window was open across the time', () => {
    expect(reminderDue({ ...base, now: at(10, 30) })).toBe(true);
  });

  /*
   * The half the platform scheduler owns. A time that passed while the app was closed was delivered by
   * the scheduler, and replaying it on open would say the same sentence twice, an hour apart.
   */
  it('stays quiet for a time that passed before this window opened', () => {
    expect(reminderDue({ ...base, now: at(10, 30), runningSince: at(10, 0) })).toBe(false);
  });

  it('is due for a time on a later day than the window opened', () => {
    const yesterday = new Date(2026, 5, 14, 20, 0, 0, 0);
    expect(reminderDue({ ...base, now: at(9, 0), runningSince: yesterday })).toBe(true);
  });

  it('fires once a day', () => {
    expect(reminderDue({ ...base, now: at(9, 5), lastFiredDate: '2026-06-15' })).toBe(false);
    expect(reminderDue({ ...base, now: at(9, 5), lastFiredDate: '2026-06-14' })).toBe(true);
  });

  it('is silent when it is off or the time is unreadable', () => {
    expect(reminderDue({ ...base, enabled: false, now: at(12, 0) })).toBe(false);
    expect(reminderDue({ ...base, reminderTime: 'oops', now: at(12, 0) })).toBe(false);
  });
});

describe('reminderDateKey', () => {
  it('is the local calendar day, zero-padded', () => {
    expect(reminderDateKey(new Date(2026, 0, 5, 23, 30))).toBe('2026-01-05');
    expect(reminderDateKey(new Date(2026, 11, 31, 0, 0))).toBe('2026-12-31');
  });
});
