import { Injectable, inject, signal } from '@angular/core';
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
 * The daily reminder to *start*, while the window is here to see the moment pass.
 *
 * Two owners, split by whether the app is running (#286). This one fires from inside the window, so the
 * wording is the live interface language and the notification is Chromium's, routed by Electron to the
 * platform. The other owner is the platform's scheduler, which the main process registers and which
 * launches the app with `--reminder-fire` when it is not running. `runningSince` is the seam between
 * them: this window handles only a time it was open for, and the scheduler handles the rest, so neither
 * says the sentence twice. The two sentences themselves live in `packages/shared-types/src/reminder.ts`,
 * which is what lets the scheduled launch — a process with no dictionary — use the same ones.
 *
 * It never fires while the learner is already in a session: the inside of a session has the clock and the
 * resume card, and a nudge there is the interruption this app removes. The scheduled launch is stopped by
 * the same condition, because the running instance holds the single-instance lock and that launch exits.
 */
@Injectable({ providedIn: 'root' })
export class ReminderService {
  private readonly state = inject(AppStateService);
  private readonly i18n = inject(I18nService);
  private handle: ReturnType<typeof setInterval> | null = null;
  /** When this window started; see `ReminderDueInput.runningSince` for why that is part of the rule. */
  private readonly runningSince = new Date();

  /**
   * Whether the platform will actually show a notification, and `unsupported` when there is no
   * `Notification` at all. The settings row reads this to say why a reminder is not appearing, rather
   * than letting the learner believe one is set when it is silently dropped.
   */
  readonly permission = signal<NotificationPermission | 'unsupported'>(
    typeof Notification === 'undefined' ? 'unsupported' : Notification.permission,
  );

  /** Idempotent, so the bootstrap may call it on every init without stacking timers. */
  start(): void {
    if (this.handle !== null) return;
    this.handle = setInterval(() => this.check(), CHECK_INTERVAL_MS);
    this.check();
  }

  /** Asks the platform for permission, from a gesture (the settings button, or the questionnaire). */
  async requestPermission(): Promise<void> {
    if (typeof Notification === 'undefined') {
      this.permission.set('unsupported');
      return;
    }
    if (Notification.permission !== 'default') {
      this.permission.set(Notification.permission);
      return;
    }
    this.permission.set(await Notification.requestPermission());
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
        runningSince: this.runningSince,
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
    if (typeof Notification === 'undefined') {
      this.permission.set('unsupported');
      return;
    }
    this.permission.set(Notification.permission);
    /*
     * Not asking here on purpose: this runs from a timer, and a browser only grants the request from a
     * gesture. The settings row offers the gesture, and says what is wrong until the learner gives it.
     */
    if (Notification.permission !== 'granted') return;
    try {
      new Notification(this.i18n.t('reminder.title'), { body: this.i18n.t('reminder.body') });
    } catch {
      // A machine that refuses to show a notification is not a reason to stop the app.
    }
  }
}
