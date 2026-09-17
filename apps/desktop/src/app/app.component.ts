import { Component, effect, inject } from '@angular/core';
import type { OnDestroy, OnInit } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { SUPPORTED_LOCALES, type LearningState, type Locale } from '@focusloop/shared-types';
import { AppStateService } from './core/app-state.service';
import { I18nService, LOCALE_LABELS, type MessageKey } from './core/i18n/i18n.service';
import { ResumeCardComponent } from './components/resume-card.component';
import { AgentPanelComponent } from './components/agent-panel.component';
import { SimulatorBarComponent } from './components/simulator-bar.component';

/**
 * Learning states are a closed vocabulary, so their labels are translation keys
 * rather than strings. Adding a state without wording is a type error.
 */
const STATE_KEYS: Record<LearningState, MessageKey> = {
  READY: 'state.READY',
  INITIATION_FRICTION: 'state.INITIATION_FRICTION',
  FOCUSED: 'state.FOCUSED',
  CONFUSED: 'state.CONFUSED',
  OVERLOADED: 'state.OVERLOADED',
  DISTRACTED: 'state.DISTRACTED',
  INTERRUPTED: 'state.INTERRUPTED',
  RESUMING: 'state.RESUMING',
};

@Component({
  selector: 'fl-app',
  standalone: true,
  imports: [
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    ResumeCardComponent,
    AgentPanelComponent,
    SimulatorBarComponent,
  ],
  template: `
    <div class="shell">
      <aside class="sidebar">
        <div class="brand">
          <span class="brand__mark">FL</span>
          <div class="brand__text">
            <strong>FocusLoop</strong>
            <small>{{ t('app.tagline') }}</small>
          </div>
        </div>

        <nav class="nav">
          <a routerLink="/home" routerLinkActive="is-active">{{ t('app.nav.home') }}</a>
          <a routerLink="/focus" routerLinkActive="is-active">{{ t('app.nav.focus') }}</a>
          <a routerLink="/dashboard" routerLinkActive="is-active">{{ t('app.nav.dashboard') }}</a>
        </nav>

        <div class="sidebar__footer">
          <div class="state-chip" [attr.data-state]="state()">
            <span class="state-chip__dot"></span>{{ stateLabel() }}
          </div>
          @if (runtime(); as info) {
            <p class="muted small footer__meta">
              {{ info.providerModel }} ·
              {{ t(info.providerOffline ? 'app.mode.offline' : 'app.mode.network') }} · v{{
                info.appVersion
              }}
            </p>
          } @else {
            <p class="muted small">{{ t('app.connecting') }}</p>
          }

          <div class="locale" role="group" [attr.aria-label]="t('app.language.switch')">
            <span class="muted small">{{ t('app.language') }}</span>
            <div class="locale__options">
              @for (option of locales; track option) {
                <button
                  type="button"
                  class="btn btn--small locale__btn"
                  [class.is-active]="option === locale()"
                  [attr.aria-pressed]="option === locale()"
                  [attr.data-testid]="'locale-' + option"
                  (click)="choose(option)"
                >
                  {{ label(option) }}
                </button>
              }
            </div>
          </div>
        </div>
      </aside>

      <main class="content">
        @if (lastError(); as error) {
          <div class="banner banner--error" role="alert">{{ error }}</div>
        }
        <router-outlet />
      </main>
    </div>

    <fl-agent-panel />
    <fl-resume-card />
    <fl-simulator-bar />
  `,
})
export class AppComponent implements OnInit, OnDestroy {
  private readonly stateService = inject(AppStateService);
  private readonly i18n = inject(I18nService);
  private unsubscribe: (() => void) | null = null;

  protected readonly state = this.stateService.state;
  protected readonly runtime = this.stateService.runtime;
  protected readonly lastError = this.stateService.lastError;
  protected readonly locale = this.stateService.locale;
  protected readonly locales = SUPPORTED_LOCALES;

  protected readonly t = this.i18n.t;

  /**
   * The renderer keeps no language state of its own: the store owns the choice,
   * `AppStateService.locale` mirrors it, and this effect is the single place that
   * pushes it into the translator. One direction, so the two cannot disagree.
   */
  private readonly syncLocale = effect(() => this.i18n.set(this.locale()));

  ngOnInit(): void {
    void this.stateService.loadSettings().then((locale) => this.stateService.locale.set(locale));
    void this.stateService.refresh();
    this.unsubscribe = this.stateService.subscribeToEvents();
  }

  ngOnDestroy(): void {
    this.unsubscribe?.();
    this.syncLocale.destroy();
  }

  protected stateLabel(): string {
    const current = this.state();
    return this.t(STATE_KEYS[current] ?? 'state.READY');
  }

  protected label(locale: Locale): string {
    return LOCALE_LABELS[locale];
  }

  protected choose(locale: Locale): void {
    void this.stateService.setLocale(locale);
  }
}
