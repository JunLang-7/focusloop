import { Injectable, inject } from '@angular/core';
import { AppStateService } from './app-state.service';
import { I18nService } from './i18n/i18n.service';
import { reminderDateKey, reminderDue } from './reminder';

const STORAGE_KEY = 'focusloop.reminder-last-fired';

/**
 * Background timers are throttled to roughly a minute, so a faster check would buy nothing.
 */
const CHECK_INTERVAL_MS = 30_000;

function readLastFired(): string | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeLastFired(date: string): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, date);
  } catch {
    // A full quota is not a reason to fail to remind, and the next check will try again.
  }
}

/**
 * The daily reminder to *start*.
 *
 * Owned by the renderer rather than the main process, because the wording of a notification belongs
 * with the rest of the interface language — the main process has no dictionary, and giving it one would
 * be a second place the app is written in. The OS notification itself is Chromium's, which Electron
 * routes to the platform. It never fires while the learner is already in a session: the inside of a
 * session has the clock and the resume card, and a nudge there is the interruption this app removes.
 */
@Injectable({ providedIn: 'root' })
export class ReminderService {
  private readonly state = inject(AppStateService);
  private readonly i18n = inject(I18nService);
  private handle: ReturnType<typeof setInterval> | null = null;

  /** Idempotent, so the bootstrap may call it on every init without stacking timers. */
  start(): void {
    if (this.handle !== null) return;
    this.handle = setInterval(() => this.check(), CHECK_INTERVAL_MS);
    this.check();
  }

  stop(): void {
    if (this.handle === null) return;
    clearInterval(this.handle);
    this.handle = null;
  }

  /** Decides on a supplied moment, so a test does not have to wait for a timer. */
  check(now: Date = new Date()): void {
    const sessionRunning = this.state.snapshot() !== null;
    const due =
      !sessionRunning &&
      reminderDue({
        enabled: this.state.reminderEnabled(),
        reminderTime: this.state.reminderTime(),
        now,
        lastFiredDate: readLastFired(),
      });
    if (!due) return;
    /*
     * Marked before the notification, not after: a refused or slow `Notification` must not let the
     * next check, thirty seconds later, fire the same day's reminder again.
     */
    writeLastFired(reminderDateKey(now));
    this.notify();
  }

  private notify(): void {
    if (typeof Notification === 'undefined') return;
    try {
      new Notification(this.i18n.t('reminder.title'), { body: this.i18n.t('reminder.body') });
    } catch {
      // A machine that refuses to show a notification is not a reason to stop the app.
    }
  }
}
