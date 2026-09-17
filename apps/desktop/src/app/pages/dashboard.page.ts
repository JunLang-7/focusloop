import { Component, computed, inject, signal } from '@angular/core';
import type { BridgeInfo } from '@focusloop/shared-types';
import { AppStateService } from '../core/app-state.service';
import { formatDuration, formatLatency } from '../core/format';

/** Screen 5 of 5: does the intervention actually help? */
@Component({
  selector: 'fl-dashboard',
  standalone: true,
  template: `
    <header class="page-head">
      <div>
        <p class="eyebrow">Dashboard</p>
        <h1>{{ summary()?.courseTitle ?? 'No session yet' }}</h1>
        <p class="muted small">Only the numbers that tell you whether continuation worked.</p>
      </div>
      <button type="button" class="btn" (click)="refresh()">Refresh</button>
    </header>

    @if (summary(); as value) {
      <section class="grid grid--4">
        <div class="card stat-card">
          <span class="stat__label">Session duration</span>
          <strong data-testid="duration">{{ duration() }}</strong>
        </div>
        <div class="card stat-card">
          <span class="stat__label">Micro tasks</span>
          <strong data-testid="tasks">{{ value.tasksCompleted }} / {{ value.tasksTotal }}</strong>
        </div>
        <div class="card stat-card">
          <span class="stat__label">Interruptions</span>
          <strong data-testid="interruptions">{{ value.interruptCount }}</strong>
        </div>
        <div class="card stat-card">
          <span class="stat__label">Avg resume latency</span>
          <strong data-testid="latency">{{ latency() }}</strong>
        </div>
      </section>

      <section>
        <h2 class="section-title">Intervention outcomes</h2>
        <table class="table">
          <thead>
            <tr>
              <th>Action</th>
              <th>Shown</th>
              <th>Accepted</th>
              <th>Dismissed</th>
              <th>Task then completed</th>
            </tr>
          </thead>
          <tbody>
            @for (row of value.interventionOutcomes; track row.action) {
              <tr>
                <td>{{ row.action }}</td>
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
        <h2 class="section-title">Browser bridge</h2>
        <div class="card">
          @if (bridge(); as info) {
            @if (info.running) {
              <p class="muted small">
                Listening on <code>{{ info.url }}</code> · protocol v{{ info.protocolVersion }} ·
                {{ info.connections }} connected
              </p>
              <p class="muted small">
                Paste this token into the FocusLoop Bridge extension. It changes every launch and is
                only valid on this machine.
              </p>
              <pre class="token" data-testid="bridge-token">{{ info.token }}</pre>
            } @else {
              <p class="muted small">
                The bridge is not running. The Demo Event Simulator covers the same path.
              </p>
            }
          } @else {
            <p class="muted small">Bridge status unavailable.</p>
          }
        </div>
      </section>

      <section>
        <h2 class="section-title">Recent events</h2>
        <ul class="timeline">
          @for (event of recentEvents(); track event.id) {
            <li>
              <span class="muted small">{{ at(event.at) }}</span>
              <strong>{{ event.type }}</strong>
              <span class="muted small">{{ event.source }}</span>
            </li>
          } @empty {
            <li class="muted">No events recorded yet.</li>
          }
        </ul>
      </section>
    }
  `,
})
export class DashboardPage {
  private readonly state = inject(AppStateService);

  protected readonly summary = computed(() => this.state.dashboard());
  protected readonly recentEvents = computed(() => [...this.state.recentEvents()].reverse());
  protected readonly bridge = signal<BridgeInfo | null>(null);

  constructor() {
    void this.loadBridge();
  }

  private async loadBridge(): Promise<void> {
    this.bridge.set(await this.state.loadBridgeInfo());
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
