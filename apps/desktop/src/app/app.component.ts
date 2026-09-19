import { Component, computed, effect, inject, signal } from '@angular/core';
import type { OnDestroy, OnInit } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import {
  SUPPORTED_LOCALES,
  THEME_PREFERENCES,
  type LearningState,
  type Locale,
  type StateShare,
  type ThemePreference,
} from '@focusloop/shared-types';
import { AppStateService } from './core/app-state.service';
import { I18nService, LOCALE_LABELS, type MessageKey } from './core/i18n/i18n.service';
import { STATE_KEYS } from './core/i18n/labels';
import { applyLanguage } from './core/language';
import { STATE_COLORS, percentLabel, formatSpan, visibleShares } from './core/insights-view';
import { applyTheme, resolveTheme } from './core/theme';
import { ResumeCardComponent } from './components/resume-card.component';
import { AgentPanelComponent } from './components/agent-panel.component';
import { SimulatorBarComponent } from './components/simulator-bar.component';

/** The theme preference is a closed vocabulary too. */
const THEME_KEYS: Record<ThemePreference, MessageKey> = {
  system: 'theme.system',
  light: 'theme.light',
  dark: 'theme.dark',
};

/**
 * The shell every screen renders inside: navigation, the sidebar's ambient summary, the language and
 * theme controls, and the single subscription to events the main process pushes.
 */
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

        <!--
          Three nav links cannot fill 500px, and a hole in the middle of the chrome
          reads as unfinished. This is the one number that earns permanent space: how
          today is going. It is always the "today" window, independently of whichever
          window the dashboard has selected, and it is pinned above the state chip so
          the bottom of the sidebar is a cluster rather than one lonely pill.
        -->
        <section class="today">
          <div class="today__head">
            <span class="muted small">{{ t('app.today') }}</span>
            <strong class="today__total" data-testid="today-total">{{ totalLabel() }}</strong>
          </div>

          @if (today(); as data) {
            @if (ribbon().length === 0) {
              <p class="muted small today__empty">{{ t('app.today.empty') }}</p>
            } @else {
              <!--
                One band per state that actually has time. The dashboard's donut answers
                the same question in detail; this answers it at a glance.
              -->
              <div class="today__ribbon" role="img" [attr.aria-label]="t('app.today.ribbon')">
                @for (band of ribbon(); track band.state) {
                  <span
                    class="today__band"
                    [style.width.%]="band.share * 100"
                    [style.background]="color(band.state)"
                    [title]="bandTitle(band)"
                  ></span>
                }
              </div>

              <p class="muted small today__meta" data-testid="today-meta">
                {{ tasksLabel(data.tasksCompleted) }} ·
                {{ interruptionsLabel(data.interruptions) }}
              </p>
            }
          }
        </section>

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

          <div class="locale" role="group" [attr.aria-label]="t('app.theme.switch')">
            <span class="muted small">{{ t('app.theme') }}</span>
            <div class="locale__options">
              @for (option of themes; track option) {
                <button
                  type="button"
                  class="btn btn--small locale__btn"
                  [class.is-active]="option === theme()"
                  [attr.aria-pressed]="option === theme()"
                  [attr.data-testid]="'theme-' + option"
                  (click)="chooseTheme(option)"
                >
                  {{ t(themeKeys[option]) }}
                </button>
              }
            </div>
          </div>

          <div class="locale" role="group" [attr.aria-label]="t('app.material.switch')">
            <span class="muted small">{{ t('app.material') }}</span>
            <div class="locale__options">
              <button
                type="button"
                class="btn btn--small locale__btn"
                [class.is-active]="showMaterialText()"
                [attr.aria-pressed]="showMaterialText()"
                data-testid="material-text-toggle"
                (click)="toggleMaterialText()"
              >
                {{ t(showMaterialText() ? 'app.material.on' : 'app.material.off') }}
              </button>
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
  protected readonly theme = this.stateService.theme;
  protected readonly themes = THEME_PREFERENCES;
  protected readonly themeKeys = THEME_KEYS;
  protected readonly today = this.stateService.todayInsights;

  /** Only the states today actually contains, largest first. */
  protected readonly ribbon = computed(() => visibleShares(this.today()?.stateShares ?? []));

  /** The OS preference, re-read whenever it changes, used only for `system`. */
  private readonly prefersLight = signal(false);

  protected readonly t = this.i18n.t;

  /**
   * The renderer keeps no language state of its own: the store owns the choice,
   * `AppStateService.locale` mirrors it, and this effect is the single place that pushes
   * it into the translator and onto `<html lang>`. One direction, so the two cannot
   * disagree — and a screen reader is told which voice to use.
   */
  private readonly syncLocale = effect(() => {
    const locale = this.locale();
    this.i18n.set(locale);
    applyLanguage(document.documentElement, locale);
  });

  /**
   * One place resolves the preference into a concrete theme and writes it to the
   * document. Components never touch theming, and `system` keeps following the OS
   * because `prefersLight` is a signal rather than a one-off read.
   */
  private readonly syncTheme = effect(() =>
    applyTheme(document.documentElement, resolveTheme(this.theme(), this.prefersLight())),
  );

  constructor() {
    const query = window.matchMedia('(prefers-color-scheme: light)');
    this.prefersLight.set(query.matches);
    query.addEventListener('change', (event) => this.prefersLight.set(event.matches));
  }

  ngOnInit(): void {
    void this.stateService.loadSettings().then((settings) => {
      this.stateService.locale.set(settings.locale);
      this.stateService.theme.set(settings.theme);
      this.stateService.showMaterialText.set(settings.showMaterialText);
    });
    void this.stateService.refresh();
    this.unsubscribe = this.stateService.subscribeToEvents();
  }

  ngOnDestroy(): void {
    this.unsubscribe?.();
    this.syncLocale.destroy();
    this.syncTheme.destroy();
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

  protected chooseTheme(theme: ThemePreference): void {
    void this.stateService.setTheme(theme);
  }

  protected readonly showMaterialText = this.stateService.showMaterialText;

  /**
   * The learner's own call, not a default: the tasks stand on their own, and the text they were
   * generated from is there for whoever wants to read it in place.
   */
  protected toggleMaterialText(): void {
    void this.stateService.setShowMaterialText(!this.showMaterialText());
  }

  protected span(ms: number): string {
    return formatSpan(ms, this.t);
  }

  /**
   * An em dash, not wording.
   *
   * It covers two cases with one glyph: the block is always rendered so the sidebar
   * cannot jump when the first summary lands, and a day with no time in it is already
   * explained by the sentence underneath — `Today 0s` above `Nothing recorded today.`
   * says the same thing twice.
   */
  protected totalLabel(): string {
    const data = this.today();
    if (data === null || data.totalMs === 0) return '—';
    return this.span(data.totalMs);
  }

  protected color(state: LearningState): string {
    return STATE_COLORS[state];
  }

  /** A tooltip is the only place the band's exact state and share can be read. */
  protected bandTitle(share: StateShare): string {
    return `${this.t(STATE_KEYS[share.state])} · ${percentLabel(share.share)}`;
  }

  protected tasksLabel(count: number): string {
    return count === 1
      ? this.t('app.today.tasks.one', { n: `${count}` })
      : this.t('app.today.tasks.other', { n: `${count}` });
  }

  protected interruptionsLabel(count: number): string {
    return count === 1
      ? this.t('app.today.interruptions.one', { n: `${count}` })
      : this.t('app.today.interruptions.other', { n: `${count}` });
  }
}
