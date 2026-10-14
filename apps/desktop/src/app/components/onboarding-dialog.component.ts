import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import {
  DEFAULT_REMINDER_ENABLED,
  DEFAULT_REMINDER_TIME,
  DEFAULT_THEME,
  SUPPORTED_LOCALES,
  THEME_PREFERENCES,
  type Locale,
  type ThemePreference,
} from '@focusloop/shared-types';
import { AppStateService } from '../core/app-state.service';
import { ReminderService } from '../core/reminder.service';
import { I18nService, LOCALE_LABELS } from '../core/i18n/i18n.service';
import type { MessageKey } from '../core/i18n/i18n.service';

const THEME_KEYS: Record<ThemePreference, MessageKey> = {
  light: 'settings.themeLight',
  dark: 'settings.themeDark',
  system: 'settings.themeSystem',
};

/**
 * The first-run questionnaire: three questions whose answers are real settings.
 *
 * Deliberately not a tour and not a slideshow. It asks the three things the app would otherwise guess —
 * which language to read, whether to be nudged, and how it should look — edits a **draft**, and writes
 * it only when the learner accepts. "Later" therefore changes nothing but still stops it asking again,
 * which is what makes it a questionnaire rather than a wall.
 *
 * The language is asked first and **previewed** as it is chosen, because the rest of the questionnaire is
 * written in it: a learner who picks Chinese should not have to answer two English questions to get it.
 * The preview is renderer-only until "Start"; "Later" puts the interface back where it started.
 */
@Component({
  selector: 'fl-onboarding',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './onboarding-dialog.component.css',
  template: `
    <div class="onboarding__overlay" data-testid="onboarding">
      <section
        class="onboarding"
        role="dialog"
        aria-modal="true"
        [attr.aria-labelledby]="'onboarding-title'"
      >
        <p class="eyebrow">{{ t('onboarding.eyebrow') }}</p>
        <h2 id="onboarding-title">{{ t('onboarding.title') }}</h2>
        <p class="muted small">{{ t('onboarding.body') }}</p>

        <div class="onboarding__question">
          <h3>{{ t('app.language') }}</h3>
          <select
            class="onboarding__language"
            data-testid="onboarding-language"
            [value]="locale()"
            (change)="onLocale($event)"
          >
            @for (option of locales; track option) {
              <option [value]="option" [selected]="locale() === option">
                {{ labels[option] }}
              </option>
            }
          </select>
        </div>

        <div class="onboarding__question">
          <div>
            <h3>{{ t('onboarding.reminder') }}</h3>
            <p class="muted small">{{ t('settings.reminderHint') }}</p>
          </div>
          <div class="onboarding__reminder">
            <input
              type="time"
              class="onboarding__time"
              data-testid="onboarding-reminder-time"
              [attr.aria-label]="t('onboarding.reminder')"
              [value]="reminderTime()"
              [disabled]="!reminderEnabled()"
              (change)="onReminderTime($event)"
            />
            <button
              type="button"
              class="settings-switch"
              role="switch"
              data-testid="onboarding-reminder-toggle"
              [attr.aria-label]="t('onboarding.reminder')"
              [attr.aria-checked]="reminderEnabled()"
              (click)="reminderEnabled.set(!reminderEnabled())"
            >
              <span></span>
            </button>
          </div>
        </div>

        <div class="onboarding__question">
          <h3>{{ t('onboarding.theme') }}</h3>
          <div class="onboarding__themes" role="group" [attr.aria-label]="t('onboarding.theme')">
            @for (option of themes; track option) {
              <button
                type="button"
                class="onboarding__theme"
                [attr.data-testid]="'onboarding-theme-' + option"
                [class.is-selected]="theme() === option"
                [attr.aria-pressed]="theme() === option"
                (click)="theme.set(option)"
              >
                {{ t(THEME_KEYS[option]) }}
              </button>
            }
          </div>
        </div>

        <div class="onboarding__actions">
          <button
            type="button"
            class="btn btn--primary"
            data-testid="onboarding-start"
            (click)="start()"
          >
            {{ t('onboarding.start') }}
          </button>
          <button
            type="button"
            class="btn btn--quiet"
            data-testid="onboarding-skip"
            (click)="skip()"
          >
            {{ t('onboarding.skip') }}
          </button>
        </div>
      </section>
    </div>
  `,
})
export class OnboardingDialogComponent {
  private readonly state = inject(AppStateService);
  private readonly reminder = inject(ReminderService);
  private readonly i18n = inject(I18nService);

  protected readonly t = this.i18n.t;
  protected readonly themes = THEME_PREFERENCES;
  protected readonly THEME_KEYS = THEME_KEYS;
  protected readonly locales = SUPPORTED_LOCALES;
  protected readonly labels = LOCALE_LABELS;

  /** A draft: nothing here reaches the store until `start()`. */
  protected readonly reminderEnabled = signal(DEFAULT_REMINDER_ENABLED);
  protected readonly reminderTime = signal(DEFAULT_REMINDER_TIME);
  protected readonly theme = signal<ThemePreference>(DEFAULT_THEME);
  /** Seeded from what the app is already speaking, which the first launch took from the OS. */
  protected readonly locale = signal<Locale>(this.state.locale());

  protected onLocale(event: Event): void {
    const locale = (event.target as HTMLSelectElement).value as Locale;
    this.locale.set(locale);
    // A preview only: the store is written on Start, and Later puts this back.
    this.i18n.set(locale);
  }

  protected onReminderTime(event: Event): void {
    this.reminderTime.set((event.target as HTMLInputElement).value);
  }

  protected async start(): Promise<void> {
    await this.applyAndDismiss({
      locale: this.locale(),
      reminderEnabled: this.reminderEnabled(),
      reminderTime: this.reminderTime(),
      theme: this.theme(),
    });
  }

  /** The answers the learner saw are discarded; the questionnaire still does not ask twice. */
  protected async skip(): Promise<void> {
    await this.applyAndDismiss(null);
    // Discard the language preview too: "Later" means nothing changed, including the interface.
    this.i18n.set(this.state.locale());
  }

  private async applyAndDismiss(
    answers: {
      locale: Locale;
      reminderEnabled: boolean;
      reminderTime: string;
      theme: ThemePreference;
    } | null,
  ): Promise<void> {
    if (answers !== null) {
      await this.state.setLocale(answers.locale);
      await this.state.setTheme(answers.theme);
      await this.state.setReminderEnabled(answers.reminderEnabled);
      await this.state.setReminderTime(answers.reminderTime);
      // Asked here because this click is the gesture the platform requires, and this is the only moment
      // the learner is looking at a reminder they just opted into.
      if (answers.reminderEnabled) await this.reminder.requestPermission();
    }
    await this.state.setOnboarded(true);
  }
}
