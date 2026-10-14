/**
 * When the daily reminder is due — the pure half, so the boundary can be tested without a timer or a
 * window. The shell owns the timer and the notification; this decides only whether *now* is the moment.
 */

/** `YYYY-MM-DD` in local time, the day a reminder is counted against. */
export function reminderDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** `HH:MM` to minutes since midnight, or `null` when it is not a time. */
export function reminderMinutes(value: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (match === null) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

export interface ReminderDueInput {
  readonly enabled: boolean;
  /** `HH:MM`, 24-hour. */
  readonly reminderTime: string;
  readonly now: Date;
  /** The local date it last fired, or `null`. */
  readonly lastFiredDate: string | null;
}

/**
 * Fires at or after the chosen time, once a day.
 *
 * "At or after" rather than "on the exact minute" on purpose: a timer that was asleep, a machine that
 * was closed at 09:00 and opened at 10:00, and a background-throttled interval all arrive late, and a
 * reminder that only fires on the exact minute is a reminder that usually does not fire. The
 * `lastFiredDate` is what keeps "late" from meaning "every minute after".
 */
export function reminderDue(input: ReminderDueInput): boolean {
  if (!input.enabled) return false;
  const today = reminderDateKey(input.now);
  if (input.lastFiredDate === today) return false;
  const due = reminderMinutes(input.reminderTime);
  if (due === null) return false;
  return input.now.getHours() * 60 + input.now.getMinutes() >= due;
}
