import { Component, computed, effect, inject, signal } from '@angular/core';
import type { OnDestroy, OnInit } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import type { Subscription } from 'rxjs';
import { filter } from 'rxjs';
import {
  SIDEBAR_INITIAL_MODE,
  collapseSidebar,
  expandSidebar,
  leaveFocusScreen,
  type SidebarMode,
} from './core/sidebar-state';
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
import { AgentContextPanelComponent } from './components/agent-context-panel.component';
import { SimulatorBarComponent } from './components/simulator-bar.component';

/** The theme preference is a closed vocabulary too. */
const THEME_KEYS: Record<ThemePreference, MessageKey> = {
  system: 'theme.system',
  light: 'theme.light',
  dark: 'theme.dark',
};

/**
 * How long the peeked sidebar lingers after the pointer leaves. Long enough that the
 * gap between the recall button and the sidebar's own controls does not flicker it
 * shut, short enough that "move away and it is gone" still reads as instant.
 */
const PEEK_CLOSE_DELAY_MS = 150;

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
    AgentContextPanelComponent,
    SimulatorBarComponent,
  ],
  template: `
    <div
      class="shell"
      [class.is-collapsed]="sidebar() === 'collapsed'"
      [class.is-forced-open]="sidebar() === 'open'"
      [class.is-peeking]="peeking()"
    >
      <aside
        class="sidebar"
        (mouseenter)="keepPeek()"
        (mouseleave)="peekEnd()"
        (click)="pinIfPeeking()"
      >
        <div class="brand">
          <span class="brand__mark">FL</span>
          <div class="brand__text">
            <strong>FocusLoop</strong>
            <small>{{ t('app.tagline') }}</small>
          </div>
          <button
            type="button"
            class="sidebar__toggle"
            data-testid="sidebar-toggle"
            [attr.aria-label]="t(toggleKey())"
            [title]="t(toggleKey())"
            (click)="toggle()"
          >
            <!--
              The sidebar glyph — a panel outline with its own edge drawn in — rather than
              an arrow. An arrow has to point somewhere, and this control goes a different
              way in each state; the label carries that direction (see toggleKey below)
              while the icon stays the thing the button acts on.
            -->
            <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
              <rect x="1.5" y="2.5" width="13" height="11" rx="2.5" />
              <path d="M6.25 2.5v11" />
            </svg>
          </button>
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
            <p class="muted small footer__meta" data-testid="run-mode">
              {{ info.providerModel }} · {{ runModeLabel(info) }} · v{{ info.appVersion }}
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

      <!--
        The recall button. It is a grid child but position: fixed takes it out of flow,
        so the collapsed grid cannot move it. Visibility is CSS-driven — the same
        body:has(...) wiring that hides the sidebar decides when this exists — so the
        shell never needs to know which phase the focus screen is in. Hovering it peeks
        the sidebar out as an overlay; clicking it pins the sidebar open.
      -->
      <button
        type="button"
        class="sidebar-fab"
        data-testid="sidebar-expand"
        [attr.aria-label]="t('app.sidebar.expand')"
        [title]="t('app.sidebar.expand')"
        (mouseenter)="peekStart()"
        (mouseleave)="peekEnd()"
        (click)="expand()"
      >
        <span aria-hidden="true">FL</span>
      </button>
    </div>

    <fl-agent-panel />
    <fl-resume-card />
    <fl-agent-context-panel />
    <fl-simulator-bar />
  `,
})
export class AppComponent implements OnInit, OnDestroy {
  private readonly stateService = inject(AppStateService);
  private readonly i18n = inject(I18nService);
  private readonly router = inject(Router);
  private unsubscribe: (() => void) | null = null;
  private routerSubscription: Subscription | null = null;
  private peekTimer: ReturnType<typeof setTimeout> | null = null;

  protected readonly state = this.stateService.state;
  protected readonly runtime = this.stateService.runtime;
  protected readonly lastError = this.stateService.lastError;
  protected readonly locale = this.stateService.locale;
  protected readonly locales = SUPPORTED_LOCALES;
  protected readonly theme = this.stateService.theme;
  protected readonly themes = THEME_PREFERENCES;
  protected readonly themeKeys = THEME_KEYS;
  protected readonly today = this.stateService.todayInsights;

  /**
   * Whether the sidebar is folded away. The focus screen drives its half of this from
   * the DOM (`body:has(...)` in the stylesheet), so the shell only stores what the user
   * asked for and never needs to know which phase the focus timer is in.
   */
  protected readonly sidebar = signal<SidebarMode>(SIDEBAR_INITIAL_MODE);

  /**
   * Whether the folded sidebar is currently peeking out as an overlay. Pure pointer
   * state — it exists only while the mouse is on (or just left) the recall button, so
   * it is never stored, never persisted, and meaningless to keyboard users, whose route
   * to the sidebar is clicking the button to pin it open.
   */
  protected readonly peeking = signal(false);

  /** Only the states today actually contains, largest first. */
  protected readonly ribbon = computed(() => visibleShares(this.today()?.stateShares ?? []));

  /**
   * The sidebar's own header button is a toggle, not a collapse button: docked it folds the
   * sidebar away, and folded it pins the hovered panel open. The label follows the mode, so
   * the button cannot announce the opposite of what a press does — a button that says
   * "collapse" in a panel that only goes the other way is how the peek reads as broken. The
   * icon is the sidebar itself, which is the same thing in both directions.
   */
  protected readonly toggleKey = computed<MessageKey>(() =>
    this.sidebar() === 'collapsed' ? 'app.sidebar.expand' : 'app.sidebar.collapse',
  );

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

    /*
     * A recall made through the floating button is a request for this focus session, not
     * a standing preference. Leaving the focus screen hands the choice back to `auto`,
     * so the next session folds the sidebar away again. A deliberate `collapsed` is left
     * alone — the user pressed collapse, not recall.
     */
    this.routerSubscription = this.router.events
      .pipe(filter((event): event is NavigationEnd => event instanceof NavigationEnd))
      .subscribe(() => {
        // A peek never survives a navigation: the click that moved screens was the
        // pointer's whole intent.
        this.endPeek();
        if (!this.router.url.startsWith('/focus')) {
          this.sidebar.update(leaveFocusScreen);
        }
      });
  }

  ngOnDestroy(): void {
    this.unsubscribe?.();
    this.routerSubscription?.unsubscribe();
    this.clearPeekTimer();
    this.syncLocale.destroy();
    this.syncTheme.destroy();
  }

  protected collapse(): void {
    this.endPeek();
    this.sidebar.update(collapseSidebar);
  }

  /** The header button's press, in whichever direction the sidebar is currently in. */
  protected toggle(): void {
    if (this.sidebar() === 'collapsed') {
      this.expand();
      return;
    }
    this.collapse();
  }

  protected expand(): void {
    this.endPeek();
    this.sidebar.update(expandSidebar);
  }

  /*
   * Hover-peek, the Codex pattern: resting the pointer on the recall button slides the
   * folded sidebar out over the content, and moving away takes it back. Two timings
   * matter and both are borrowed from prior art (the Obsidian quick-peek plugin): the
   * peek opens immediately, because the button is a deliberate target — but closing
   * waits PEEK_CLOSE_DELAY_MS, so the gap between leaving the button and entering the
   * overlay, and the small gaps between the sidebar's own controls, do not flicker it
   * shut.
   *
   * The button only opens the peek; the sidebar itself only cancels or schedules the
   * close. `mouseenter` on a visible sidebar must never set `peeking`, or a click on
   * the sidebar in its ordinary state would count as a peek and misroute pinning.
   */
  protected peekStart(): void {
    this.clearPeekTimer();
    this.peeking.set(true);
  }

  /** Entering the sidebar means the pointer made it out of the button: hold it open. */
  protected keepPeek(): void {
    this.clearPeekTimer();
  }

  protected peekEnd(): void {
    if (!this.peeking()) return;
    this.clearPeekTimer();
    this.peekTimer = setTimeout(() => {
      this.peeking.set(false);
      this.peekTimer = null;
    }, PEEK_CLOSE_DELAY_MS);
  }

  /** A click anywhere in a peeked sidebar pins it open — hover is a look, a click is a keep. */
  protected pinIfPeeking(): void {
    if (this.peeking()) this.expand();
  }

  private endPeek(): void {
    this.clearPeekTimer();
    this.peeking.set(false);
  }

  private clearPeekTimer(): void {
    if (this.peekTimer !== null) {
      clearTimeout(this.peekTimer);
      this.peekTimer = null;
    }
  }

  protected stateLabel(): string {
    const current = this.state();
    return this.t(STATE_KEYS[current] ?? 'state.READY');
  }

  /**
   * Offline beats degraded in the label: a mock provider is not a failed
   * primary, so "offline" is the honest reading when both would apply.
   */
  protected runModeLabel(info: {
    readonly providerOffline: boolean;
    readonly providerDegraded: boolean;
  }): string {
    if (info.providerOffline) return this.t('app.mode.offline');
    if (info.providerDegraded) return this.t('app.mode.degraded');
    return this.t('app.mode.network');
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
