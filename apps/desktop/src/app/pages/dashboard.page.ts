import { Component, computed, inject, signal } from '@angular/core';
import type { BridgeInfo } from '@focusloop/shared-types';
import { AppStateService } from '../core/app-state.service';
import { I18nService } from '../core/i18n/i18n.service';
import { ACTION_KEYS } from '../core/i18n/labels';
import { formatDuration, formatLatency } from '../core/format';

/** Screen 5 of 5: does the intervention actually help? */
@Component({
  selector: 'fl-dashboard',
  standalone: true,
  template: `
    <header class="page-head">
      <div>
        <p class="eyebrow">{{ t('dashboard.eyebrow') }}</p>
        <h1>{{ summary()?.courseTitle ?? t('dashboard.noSession') }}</h1>
        <p class="muted small">{{ t('dashboard.subtitle') }}</p>
      </div>
      <button type="button" class="btn" (click)="refresh()">{{ t('dashboard.refresh') }}</button>
    </header>

    @if (summary(); as value) {
      <section class="grid grid--4">
        <div class="card stat-card">
          <span class="stat__label">{{ t('dashboard.duration') }}</span>
          <strong data-testid="duration">{{ duration() }}</strong>
        </div>
        <div class="card stat-card">
          <span class="stat__label">{{ t('dashboard.tasks') }}</span>
          <strong data-testid="tasks">{{ value.tasksCompleted }} / {{ value.tasksTotal }}</strong>
        </div>
        <div class="card stat-card">
          <span class="stat__label">{{ t('dashboard.interruptions') }}</span>
          <strong data-testid="interruptions">{{ value.interruptCount }}</strong>
        </div>
        <div class="card stat-card">
          <span class="stat__label">{{ t('dashboard.latency') }}</span>
          <strong data-testid="latency">{{ latency() }}</strong>
        </div>
      </section>

      <section>
        <h2 class="section-title">{{ t('dashboard.outcomes') }}</h2>
        <table class="table">
          <thead>
            <tr>
              <th>{{ t('dashboard.col.action') }}</th>
              <th>{{ t('dashboard.col.shown') }}</th>
              <th>{{ t('dashboard.col.accepted') }}</th>
              <th>{{ t('dashboard.col.dismissed') }}</th>
              <th>{{ t('dashboard.col.completed') }}</th>
            </tr>
          </thead>
          <tbody>
            @for (row of value.interventionOutcomes; track row.action) {
              <tr>
                <td>{{ actionLabel(row.action) }}</td>
                <td>{{ row.total }}</td>
                <td>{{ row.accepted }}</td>
                <td>{{ row.dismissed }}</td>
                <td>{{ row.tasksCompleted }}</td>
              </tr>
            }
          </tbody>
        </table>
      </section>

      <section>
        <h2 class="section-title">{{ t('dashboard.bridge') }}</h2>
        <div class="card">
          @if (bridge(); as info) {
            @if (info.running) {
              <p class="muted small">
                {{ bridgeListening(info) }}
              </p>
              <p class="muted small">{{ t('dashboard.bridge.hint') }}</p>
              <pre class="token" data-testid="bridge-token">{{ info.token }}</pre>
            } @else {
              <p class="muted small">{{ t('dashboard.bridge.stopped') }}</p>
            }
          } @else {
            <p class="muted small">{{ t('dashboard.bridge.unavailable') }}</p>
          }
        </div>
      </section>

      <section>
        <h2 class="section-title">{{ t('dashboard.events') }}</h2>
        <ul class="timeline">
          @for (event of recentEvents(); track event.id) {
            <li>
              <span class="muted small">{{ at(event.at) }}</span>
              <strong>{{ event.type }}</strong>
              <span class="muted small">{{ event.source }}</span>
            </li>
          } @empty {
            <li class="muted">{{ t('dashboard.events.none') }}</li>
          }
        </ul>
      </section>
    }
  `,
})
export class DashboardPage {
  private readonly state = inject(AppStateService);
  private readonly i18n = inject(I18nService);

  protected readonly t = this.i18n.t;
  protected readonly summary = computed(() => this.state.dashboard());
  protected readonly recentEvents = computed(() => [...this.state.recentEvents()].reverse());
  protected readonly bridge = signal<BridgeInfo | null>(null);

  constructor() {
    void this.loadBridge();
  }

  private async loadBridge(): Promise<void> {
    this.bridge.set(await this.state.loadBridgeInfo());
  }

  protected actionLabel(action: string): string {
    const key = ACTION_KEYS[action as keyof typeof ACTION_KEYS];
    return key === undefined ? action : this.t(key);
  }

  protected bridgeListening(info: BridgeInfo): string {
    return this.t('dashboard.bridge.listening', {
      url: info.url,
      version: String(info.protocolVersion),
      connections: String(info.connections),
    });
  }

  protected duration(): string {
    return formatDuration(this.summary()?.sessionDurationMs ?? 0);
  }

  protected latency(): string {
    return formatLatency(this.summary()?.averageResumeLatencyMs ?? null);
  }

  protected at(iso: string): string {
    const date = new Date(iso);
    return Number.isNaN(date.getTime())
      ? '—'
      : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  protected refresh(): void {
    void this.state.refresh();
    void this.loadBridge();
  }
}
