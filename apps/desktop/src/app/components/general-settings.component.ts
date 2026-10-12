import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { SUPPORTED_LOCALES, type Locale, type ThemePreference } from '@focusloop/shared-types';
import { DataControlsComponent } from './data-controls.component';
import { AppStateService } from '../core/app-state.service';
import { I18nService, LOCALE_LABELS } from '../core/i18n/i18n.service';

/** General preferences and local data controls inside the settings window. */
@Component({
  selector: 'fl-general-settings',
  standalone: true,
  imports: [DataControlsComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './general-settings.component.css',
  template: `
    <div class="general" data-testid="general-settings">
      <section class="general__row">
        <div>
          <label for="settings-language">{{ t('app.language') }}</label>
          <p>{{ t('settings.languageHint') }}</p>
        </div>
        <select
          id="settings-language"
          data-testid="general-language"
          [value]="state.locale()"
          (change)="chooseLocale($event)"
        >
          @for (locale of locales; track locale) {
            <option [value]="locale" [selected]="state.locale() === locale">
              {{ labels[locale] }}
            </option>
          }
        </select>
      </section>
      <section class="general__appearance" aria-labelledby="appearance-title">
        <h2 id="appearance-title">{{ t('settings.appearance') }}</h2>
        <div class="theme-cards" role="group" [attr.aria-label]="t('app.theme.switch')">
          <button
            type="button"
            class="theme-card"
            data-testid="theme-light"
            [class.is-selected]="state.theme() === 'light'"
            [attr.aria-pressed]="state.theme() === 'light'"
            (click)="chooseTheme('light')"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="12" r="4" />
              <path
                d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"
              /></svg
            >{{ t('settings.themeLight') }}
          </button>
          <button
            type="button"
            class="theme-card"
            data-testid="theme-dark"
            [class.is-selected]="state.theme() === 'dark'"
            [attr.aria-pressed]="state.theme() === 'dark'"
            (click)="chooseTheme('dark')"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5Z" /></svg
            >{{ t('settings.themeDark') }}
          </button>
          <button
            type="button"
            class="theme-card"
            data-testid="theme-system"
            [class.is-selected]="state.theme() === 'system'"
            [attr.aria-pressed]="state.theme() === 'system'"
            (click)="chooseTheme('system')"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <rect x="3" y="4" width="18" height="13" rx="2" />
              <path d="M12 17v3m-4 0h8" /></svg
            >{{ t('settings.themeSystem') }}
          </button>
        </div>
      </section>
      <section class="general__row">
        <div>
          <h2 id="material-title">{{ t('app.material.switch') }}</h2>
          <p>{{ t('settings.materialHint') }}</p>
        </div>
        <button
          type="button"
          class="settings-switch"
          role="switch"
          data-testid="material-text-toggle"
          [attr.aria-labelledby]="'material-title'"
          [attr.aria-checked]="state.showMaterialText()"
          (click)="toggleMaterial()"
        >
          <span></span>
        </button>
      </section>
      <section class="general__data" aria-labelledby="data-title">
        <h2 id="data-title">{{ t('settings.data') }}</h2>
        <p>{{ t('settings.dataHint') }}</p>
        <fl-data-controls />
      </section>
    </div>
  `,
})
export class GeneralSettingsComponent {
  protected readonly state = inject(AppStateService);
  protected readonly t = inject(I18nService).t;
  protected readonly locales = SUPPORTED_LOCALES;
  protected readonly labels = LOCALE_LABELS;
  protected chooseLocale(event: Event): void {
    void this.state.setLocale((event.target as HTMLSelectElement).value as Locale);
  }
  protected chooseTheme(theme: ThemePreference): void {
    void this.state.setTheme(theme);
  }
  protected toggleMaterial(): void {
    void this.state.setShowMaterialText(!this.state.showMaterialText());
  }
}
