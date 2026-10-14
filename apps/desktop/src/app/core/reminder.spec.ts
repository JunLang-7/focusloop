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
  const base = { enabled: true, reminderTime: '09:00', lastFiredDate: null } as const;

  it('is not due before the chosen time, and is at it', () => {
    expect(reminderDue({ ...base, now: at(8, 59) })).toBe(false);
    expect(reminderDue({ ...base, now: at(9, 0) })).toBe(true);
  });

  /*
   * "At or after" is the point: a machine that was closed at 09:00 and opened at 10:00 must still get
   * one reminder. The `lastFiredDate` is what stops "late" from becoming "every minute after".
   */
  it('is still due later the same day', () => {
    expect(reminderDue({ ...base, now: at(10, 30) })).toBe(true);
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
