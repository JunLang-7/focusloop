import { Component, inject } from '@angular/core';
import type { OnDestroy, OnInit } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import type { LearningState } from '@focusloop/shared-types';
import { AppStateService } from './core/app-state.service';
import { ResumeCardComponent } from './components/resume-card.component';
import { AgentPanelComponent } from './components/agent-panel.component';
import { SimulatorBarComponent } from './components/simulator-bar.component';

const STATE_LABELS: Record<LearningState, string> = {
  READY: 'Ready',
  INITIATION_FRICTION: 'Getting started',
  FOCUSED: 'Focused',
  CONFUSED: 'Confused',
  OVERLOADED: 'Overloaded',
  DISTRACTED: 'Away',
  INTERRUPTED: 'Interrupted',
  RESUMING: 'Resuming',
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
            <small>learning continuity</small>
          </div>
        </div>

        <nav class="nav">
          <a routerLink="/home" routerLinkActive="is-active">Home</a>
          <a routerLink="/focus" routerLinkActive="is-active">Focus Session</a>
          <a routerLink="/dashboard" routerLinkActive="is-active">Dashboard</a>
        </nav>

        <div class="sidebar__footer">
          <div class="state-chip" [attr.data-state]="state()">
            <span class="state-chip__dot"></span>{{ stateLabel() }}
          </div>
          @if (runtime(); as info) {
            <p class="muted small">{{ info.providerModel }}</p>
            <p class="muted small">{{ info.providerOffline ? 'offline mode' : 'network mode' }}</p>
            <p class="muted small">v{{ info.appVersion }}</p>
          } @else {
            <p class="muted small">connecting…</p>
          }
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
  private unsubscribe: (() => void) | null = null;

  protected readonly state = this.stateService.state;
  protected readonly runtime = this.stateService.runtime;
  protected readonly lastError = this.stateService.lastError;

  ngOnInit(): void {
    void this.stateService.refresh();
    this.unsubscribe = this.stateService.subscribeToEvents();
  }

  ngOnDestroy(): void {
    this.unsubscribe?.();
  }

  protected stateLabel(): string {
    return STATE_LABELS[this.state()] ?? this.state();
  }
}
