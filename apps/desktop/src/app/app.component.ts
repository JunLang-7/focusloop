import { Component, HostListener, NgZone, computed, effect, inject, signal } from '@angular/core';
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
import type { LearningState, StateShare } from '@focusloop/shared-types';
import { AppStateService } from './core/app-state.service';
import { AmbientSoundService } from './core/ambient-sound.service';
import { I18nService, type MessageKey } from './core/i18n/i18n.service';
import { ReminderService } from './core/reminder.service';
import { STATE_KEYS } from './core/i18n/labels';
import { applyLanguage } from './core/language';
import { STATE_COLORS, percentLabel, formatSpan, visibleShares } from './core/insights-view';
import { applyTheme, resolveTheme } from './core/theme';
import { isFocusRoute } from './core/focus-notice';
import { isSettingsShortcut } from './core/settings-shortcut';
import { installScrollSpeed } from './core/scroll-speed';
import { ResumeCardComponent } from './components/resume-card.component';
import { ProposalConfirmComponent } from './components/proposal-confirm.component';
import { AgentPanelComponent } from './components/agent-panel.component';
import {
  SettingsDialogComponent,
  type SettingsSection,
} from './components/settings-dialog.component';
import { OnboardingDialogComponent } from './components/onboarding-dialog.component';

const PEEK_CLOSE_DELAY_MS = 150;

/** Sidebar navigation and status; preferences live in a separate native settings window. */
@Component({
  selector: 'fl-app',
  standalone: true,
  imports: [
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    ResumeCardComponent,
    AgentPanelComponent,
    ProposalConfirmComponent,
    SettingsDialogComponent,
    OnboardingDialogComponent,
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
          <img class="brand__mark" src="assets/icon.png" alt="" width="40" height="40" />
          <div class="brand__text">
            <img
              class="brand__wordmark brand__wordmark--light"
              src="assets/wordmark-light.png"
              alt="FocusLoop"
            /><img
              class="brand__wordmark brand__wordmark--dark"
              src="assets/wordmark-dark.png"
              alt="FocusLoop"
            /><small>{{ t('app.tagline') }}</small>
          </div>
          <button
            type="button"
            class="sidebar__toggle"
            data-testid="sidebar-toggle"
            [attr.aria-label]="t(toggleKey())"
            [title]="t(toggleKey())"
            (click)="toggle()"
          >
            <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
              <rect x="1.5" y="2.5" width="13" height="11" rx="2.5" />
              <path d="M6.25 2.5v11" />
            </svg>
          </button>
        </div>
        <nav class="nav" [attr.aria-label]="t('app.navigation')">
          <a
            routerLink="/home"
            routerLinkActive="is-active"
            ariaCurrentWhenActive="page"
            data-testid="nav-home"
            >{{ t('app.nav.home') }}</a
          >
          <a
            routerLink="/focus"
            routerLinkActive="is-active"
            ariaCurrentWhenActive="page"
            data-testid="nav-focus"
            >{{ t('app.nav.focus') }}</a
          >
          <a
            routerLink="/dashboard"
            routerLinkActive="is-active"
            ariaCurrentWhenActive="page"
            data-testid="nav-dashboard"
            >{{ t('app.nav.dashboard') }}</a
          >
        </nav>
        <section class="today">
          <div class="today__head">
            <span class="muted small">{{ t('app.today') }}</span
            ><strong class="today__total" data-testid="today-total">{{ totalLabel() }}</strong>
          </div>
          @if (today(); as data) {
            @if (ribbon().length === 0) {
              <p class="muted small today__empty">{{ t('app.today.empty') }}</p>
            } @else {
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
                {{ tasksLabel(data.tasksCompleted) }} · {{ interruptionsLabel(data.interruptions) }}
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
              {{ runModeLabel(info) }} · v{{ info.appVersion }}
            </p>
          } @else {
            <p class="muted small">{{ t('app.connecting') }}</p>
          }
          <div class="model-entry" data-testid="model-entry">
            <button
              type="button"
              class="btn btn--small model-entry__toggle"
              data-testid="model-entry-toggle"
              aria-haspopup="dialog"
              [attr.aria-label]="t('settings.models')"
              (click)="openSettings('models', $event)"
            >
              <span class="model-entry__state" [attr.data-state]="modelState()">{{
                t(modelLabelKey())
              }}</span
              ><span class="muted small model-entry__name">{{ model()?.providerModel }}</span>
            </button>
          </div>
          <button
            type="button"
            class="sidebar-settings"
            data-testid="nav-settings"
            aria-haspopup="dialog"
            [attr.aria-expanded]="settingsOpen()"
            [attr.aria-label]="t('settings.title')"
            [attr.aria-keyshortcuts]="settingsPlatform() === 'darwin' ? 'Meta+,' : 'Control+,'"
            [title]="t('settings.title') + ' (' + settingsShortcutLabel() + ')'"
            (click)="openSettings('general', $event)"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="m9 3-.6 2-1.8 1-2-.5-2 3.5 1.4 1.5v2l-1.4 1.5 2 3.5 2-.5 1.8 1 .6 2h4l.6-2 1.8-1 2 .5 2-3.5-1.4-1.5v-2l1.4-1.5-2-3.5-2 .5-1.8-1L13 3Z"
              />
              <circle cx="11" cy="11" r="3" /></svg
            >{{ t('settings.title')
            }}<span
              class="sidebar-settings__shortcut"
              [class.is-joined]="settingsPlatform() !== 'darwin'"
              aria-hidden="true"
            >
              @for (key of settingsShortcutKeys(); track $index) {
                <kbd>{{ key }}</kbd>
              }
            </span>
          </button>
        </div>
      </aside>
      <main class="content">
        @if (lastError(); as error) {
          <div class="banner banner--error" role="alert">{{ error }}</div>
        }
        <router-outlet />
      </main>
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
        <img src="assets/icon.png" alt="" width="40" height="40" />
      </button>
    </div>
    @if (!onFocusRoute()) {
      <fl-agent-panel /><fl-resume-card />
    }
    <fl-proposal-confirm />
    @if (settingsOpen()) {
      <fl-settings-dialog [initialSection]="settingsInitialSection()" (closed)="closeSettings()" />
    }
    <!--
      The first-run questionnaire, once the stored settings have actually been read. Gating on
      settingsReady is what keeps it from flashing on every launch: the defaults look exactly like a
      first run until the answer arrives.
    -->
    @if (settingsReady() && !onboarded()) {
      <fl-onboarding />
    }
  `,
})
export class AppComponent implements OnInit, OnDestroy {
  private readonly stateService = inject(AppStateService);
  private readonly i18n = inject(I18nService);
  private readonly router = inject(Router);
  private readonly zone = inject(NgZone);
  private readonly reminder = inject(ReminderService);
  private uninstallScrollSpeed: (() => void) | null = null;
  protected readonly currentUrl = signal(this.router.url);
  protected readonly onFocusRoute = computed(() => isFocusRoute(this.currentUrl()));
  protected readonly settingsOpen = signal(false);
  protected readonly settingsInitialSection = signal<SettingsSection>('general');
  private settingsOpener: HTMLElement | null = null;
  private unsubscribe: (() => void) | null = null;
  private routerSubscription: Subscription | null = null;
  private peekTimer: ReturnType<typeof setTimeout> | null = null;
  protected readonly state = this.stateService.state;
  /** Read by the template to gate the first-run questionnaire; the service itself stays private. */
  protected readonly settingsReady = this.stateService.settingsReady;
  protected readonly onboarded = this.stateService.onboarded;
  protected readonly runtime = this.stateService.runtime;
  protected readonly settingsPlatform = computed(() => {
    const platform = this.runtime()?.platform;
    if (platform !== undefined && platform.length > 0) return platform;
    const userAgent = navigator.userAgent;
    if (/Mac|iPhone|iPad/.test(userAgent)) return 'darwin';
    if (/Windows/.test(userAgent)) return 'win32';
    return 'linux';
  });
  protected readonly settingsShortcutKeys = computed<readonly string[]>(() =>
    this.settingsPlatform() === 'darwin' ? ['⌘', ','] : ['Ctrl', '+', ','],
  );
  protected readonly settingsShortcutLabel = computed(() => this.settingsShortcutKeys().join(''));
  protected readonly lastError = this.stateService.lastError;
  protected readonly locale = this.stateService.locale;
  protected readonly theme = this.stateService.theme;
  protected readonly today = this.stateService.todayInsights;
  protected readonly model = this.stateService.model;
  protected readonly modelState = computed<'offline' | 'degraded' | 'connected' | 'configured'>(
    () => {
      const model = this.model();
      if (model === null || model.offline) return 'offline';
      if (model.degraded) return 'degraded';
      return model.verified ? 'connected' : 'configured';
    },
  );
  protected readonly modelLabelKey = computed(() => {
    switch (this.modelState()) {
      case 'connected':
        return 'app.model.connected' as const;
      case 'configured':
        return 'app.model.configured' as const;
      case 'degraded':
        return 'app.model.degraded' as const;
      default:
        return 'app.model.offline' as const;
    }
  });
  protected readonly sidebar = signal<SidebarMode>(SIDEBAR_INITIAL_MODE);
  protected readonly peeking = signal(false);
  protected readonly ribbon = computed(() => visibleShares(this.today()?.stateShares ?? []));
  protected readonly toggleKey = computed<MessageKey>(() =>
    this.sidebar() === 'collapsed' ? 'app.sidebar.expand' : 'app.sidebar.collapse',
  );
  private readonly prefersLight = signal(false);
  protected readonly t = this.i18n.t;
  private readonly syncLocale = effect(() => {
    const locale = this.locale();
    this.i18n.set(locale);
    applyLanguage(document.documentElement, locale);
  });
  private readonly syncTheme = effect(() =>
    applyTheme(document.documentElement, resolveTheme(this.theme(), this.prefersLight())),
  );
  constructor() {
    inject(AmbientSoundService);
    const query = window.matchMedia('(prefers-color-scheme: light)');
    this.prefersLight.set(query.matches);
    query.addEventListener('change', (event) => this.prefersLight.set(event.matches));
  }
  ngOnInit(): void {
    this.uninstallScrollSpeed = this.zone.runOutsideAngular(() => installScrollSpeed(document));
    void this.stateService.loadSettings().then((settings) => {
      this.stateService.locale.set(settings.locale);
      this.stateService.theme.set(settings.theme);
      this.stateService.showMaterialText.set(settings.showMaterialText);
      this.stateService.ambientSound.set(settings.ambientSound);
      this.stateService.reminderEnabled.set(settings.reminderEnabled);
      this.stateService.reminderTime.set(settings.reminderTime);
      this.stateService.onboarded.set(settings.onboarded);
      this.stateService.settingsReady.set(true);
      this.stateService.clockFormat.set(settings.clockFormat);
    });
    void this.stateService.refresh();
    // Starts the daily reminder's timer. Its first check runs before settings have loaded, which is
    // harmless — the default is off — and the interval reads the enabled state on every check.
    this.reminder.start();
    this.unsubscribe = this.stateService.subscribeToEvents();
    this.routerSubscription = this.router.events
      .pipe(filter((event): event is NavigationEnd => event instanceof NavigationEnd))
      .subscribe(() => {
        this.endPeek();
        const wasFocus = this.onFocusRoute();
        this.currentUrl.set(this.router.url);
        if (wasFocus !== isFocusRoute(this.router.url)) this.sidebar.update(leaveFocusScreen);
      });
  }
  ngOnDestroy(): void {
    this.reminder.stop();
    this.uninstallScrollSpeed?.();
    this.unsubscribe?.();
    this.routerSubscription?.unsubscribe();
    this.clearPeekTimer();
    this.syncLocale.destroy();
    this.syncTheme.destroy();
  }
  @HostListener('document:keydown', ['$event'])
  protected settingsKeydown(event: KeyboardEvent): void {
    if (!isSettingsShortcut(event, this.settingsPlatform())) return;
    event.preventDefault();
    // Repeated requests keep the selected tab, unsaved draft and nested confirmation intact.
    // Never put settings over another modal or steal that modal's keyboard focus.
    if (
      this.settingsOpen() ||
      document.querySelector('dialog[open], [role="dialog"][aria-modal="true"]')
    )
      return;
    this.openSettings('general');
  }
  protected openSettings(section: SettingsSection, event?: Event): void {
    const opener = event?.currentTarget ?? document.activeElement;
    this.settingsOpener = opener instanceof HTMLElement ? opener : null;
    this.settingsInitialSection.set(section);
    this.settingsOpen.set(true);
  }
  protected closeSettings(): void {
    this.settingsOpen.set(false);
    queueMicrotask(() => this.settingsOpener?.focus());
  }
  protected collapse(): void {
    this.endPeek();
    this.sidebar.update(collapseSidebar);
  }
  protected toggle(): void {
    if (this.sidebar() === 'collapsed') this.expand();
    else this.collapse();
  }
  protected expand(): void {
    this.endPeek();
    this.sidebar.update(expandSidebar);
  }
  protected peekStart(): void {
    this.clearPeekTimer();
    this.peeking.set(true);
  }
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
    return this.t(STATE_KEYS[this.state()] ?? 'state.READY');
  }
  protected runModeLabel(info: {
    readonly providerOffline: boolean;
    readonly providerDegraded: boolean;
  }): string {
    if (info.providerOffline) return this.t('app.mode.offline');
    if (info.providerDegraded) return this.t('app.mode.degraded');
    return this.t('app.mode.network');
  }
  protected span(ms: number): string {
    return formatSpan(ms, this.t);
  }
  protected totalLabel(): string {
    const data = this.today();
    return data === null || data.totalMs === 0 ? '—' : this.span(data.totalMs);
  }
  protected color(state: LearningState): string {
    return STATE_COLORS[state];
  }
  protected bandTitle(share: StateShare): string {
    return `${this.t(STATE_KEYS[share.state])} · ${percentLabel(share.share)}`;
  }
  protected tasksLabel(count: number): string {
    return this.t(count === 1 ? 'app.today.tasks.one' : 'app.today.tasks.other', { n: `${count}` });
  }
  protected interruptionsLabel(count: number): string {
    return this.t(count === 1 ? 'app.today.interruptions.one' : 'app.today.interruptions.other', {
      n: `${count}`,
    });
  }
}
