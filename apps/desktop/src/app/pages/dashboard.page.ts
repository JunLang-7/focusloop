import { Component, computed, inject, signal } from '@angular/core';
import {
  INSIGHT_RANGES,
  type BridgeInfo,
  type DailyActivity,
  type InsightRange,
  type LearningState,
} from '@focusloop/shared-types';
import { AppStateService } from '../core/app-state.service';
import { I18nService, type MessageKey } from '../core/i18n/i18n.service';
import { ACTION_KEYS, STATE_KEYS } from '../core/i18n/labels';
import {
  STATE_COLORS,
  busiestDay,
  donutSegments,
  formatSpan,
  heatLevel,
  heatmapLeadingBlanks,
  percentLabel,
  shortDate,
  sortedShares,
  weekdayIndex,
} from '../core/insights-view';
import { formatDuration, formatLatency } from '../core/format';

const RANGE_KEYS: Record<InsightRange, MessageKey> = {
  session: 'dashboard.range.session',
  today: 'dashboard.range.today',
  week: 'dashboard.range.week',
  all: 'dashboard.range.all',
};

const WEEKDAYS: readonly MessageKey[] = [
  'weekday.0',
  'weekday.1',
  'weekday.2',
  'weekday.3',
  'weekday.4',
  'weekday.5',
  'weekday.6',
];

const DONUT_RADIUS = 42;

/**
 * Screen 5 of 5: does the intervention actually help?
 *
 * Two scopes live on this page and they are deliberately kept apart. The window
 * section answers "how have I been doing lately" and is driven by the aggregated
 * insights; the session section answers "how is this session going" and is driven
 * by the live session summary. Mixing them would make every number ambiguous.
 */
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
      <button type="button" class="btn" data-testid="refresh" (click)="refresh()">
        {{ t('dashboard.refresh') }}
      </button>
    </header>

    <!-- ------------------------------------------------------- the window -->
    <section class="window">
      <div class="segmented" role="group" [attr.aria-label]="t('dashboard.range.label')">
        @for (option of ranges; track option) {
          <button
            type="button"
            class="segmented__btn"
            [class.is-active]="option === range()"
            [attr.aria-pressed]="option === range()"
            [attr.data-testid]="'range-' + option"
            (click)="selectRange(option)"
          >
            {{ t(rangeKeys[option]) }}
          </button>
        }
      </div>

      @if (insights(); as data) {
        <div class="hero">
          <div class="hero__item">
            <span class="hero__label">{{ t('dashboard.hero.total') }}</span>
            <strong class="hero__value" data-testid="insights-total">
              {{ span(data.totalMs) }}
            </strong>
          </div>
          <div class="hero__item">
            <span class="hero__label">{{ t('dashboard.hero.daily') }}</span>
            <strong class="hero__value hero__value--muted" data-testid="insights-daily">
              {{ span(data.dailyAverageMs) }}
            </strong>
            <span class="muted small">
              {{ daysLabel(data.activeDays) }}
            </span>
          </div>
        </div>

        <div class="insights">
          <!-- ------------------------------------------------ state donut -->
          <div class="panel">
            <h3 class="panel__title">{{ t('dashboard.states.title') }}</h3>
            @if (segments().length === 0) {
              <p class="muted small">{{ t('dashboard.activity.empty') }}</p>
            } @else {
              <div class="donut-row">
                <div class="donut">
                  <svg
                    viewBox="0 0 100 100"
                    role="img"
                    [attr.aria-label]="t('dashboard.states.title')"
                  >
                    <circle class="donut__track" cx="50" cy="50" [attr.r]="radius" />
                    <g transform="rotate(-90 50 50)">
                      @for (segment of segments(); track segment.state) {
                        <circle
                          cx="50"
                          cy="50"
                          fill="none"
                          stroke-linecap="butt"
                          stroke-width="13"
                          [attr.r]="radius"
                          [attr.stroke]="segment.color"
                          [attr.stroke-dasharray]="segment.dashArray"
                          [attr.stroke-dashoffset]="segment.dashOffset"
                        />
                      }
                    </g>
                  </svg>
                  <!--
                    The ring already answers "how much time"; the centre answers
                    "how much of it was on task", which is the number that matters
                    and is not repeated anywhere else on the page.
                  -->
                  <div class="donut__center">
                    <strong data-testid="focus-ratio">{{ percent(focusRatio()) }}</strong>
                    <span class="muted small">{{ t('dashboard.focusRatio') }}</span>
                  </div>
                </div>

                <ul class="legend">
                  @for (share of stateShares(); track share.state) {
                    <li>
                      <span class="legend__dot" [style.background]="color(share.state)"></span>
                      <span class="legend__label">{{ stateLabel(share.state) }}</span>
                      <span class="legend__pct">{{ percent(share.share) }}</span>
                      <span class="muted small legend__time">{{ span(share.durationMs) }}</span>
                    </li>
                  }
                </ul>
              </div>
            }
          </div>

          <!-- ---------------------------------------------- daily activity -->
          <div class="panel">
            <h3 class="panel__title">{{ t('dashboard.activity.title') }}</h3>
            @if (data.maxDailyMs === 0) {
              <p class="muted small">{{ t('dashboard.activity.empty') }}</p>
            } @else {
              <div class="heat">
                <div class="heat__grid">
                  @for (blank of blanks(); track $index) {
                    <span class="heat__cell is-blank"></span>
                  }
                  @for (day of data.daily; track day.date) {
                    <span
                      class="heat__day"
                      [attr.data-testid]="'heat-' + day.date"
                      [title]="dayTitle(day)"
                    >
                      <span class="heat__cell" [attr.data-level]="level(day.durationMs)"></span>
                      <span class="heat__label">{{ weekdayLabel(day.date) }}</span>
                    </span>
                  }
                </div>
                <p class="muted small heat__scale">
                  <span class="heat__cell" data-level="0"></span>
                  <span class="heat__cell" data-level="1"></span>
                  <span class="heat__cell" data-level="2"></span>
                  <span class="heat__cell" data-level="3"></span>
                  <span class="heat__cell" data-level="4"></span>
                  {{ t('dashboard.activity.hint') }}
                </p>
                @if (busiest(); as top) {
                  <p class="muted small">{{ busiestLabel(top) }}</p>
                }

                <div class="heat__facts">
                  <div class="heat__fact">
                    <span class="muted small">{{ t('dashboard.window.tasks') }}</span>
                    <strong data-testid="insights-tasks">{{ data.tasksCompleted }}</strong>
                  </div>
                  <div class="heat__fact">
                    <span class="muted small">{{ t('dashboard.window.interruptions') }}</span>
                    <strong data-testid="insights-interruptions">
                      {{ data.interruptions }}
                    </strong>
                  </div>
                  <div class="heat__fact">
                    <span class="muted small">{{ t('dashboard.window.sessions') }}</span>
                    <strong>{{ data.sessionCount }}</strong>
                  </div>
                </div>
              </div>
            }
          </div>
        </div>

        <!-- ------------------------------------------------- course totals -->
        @if (data.courseShares.length > 1) {
          <div class="panel">
            <h3 class="panel__title">{{ t('dashboard.courses.title') }}</h3>
            <div class="bars">
              @for (course of data.courseShares; track course.courseId) {
                <div class="bar">
                  <div class="bar__head">
                    <span class="bar__name">{{ course.title }}</span>
                    <span class="muted small">
                      {{ span(course.durationMs) }} · {{ percent(course.share) }}
                    </span>
                  </div>
                  <div class="bar__track">
                    <span class="bar__fill" [style.width.%]="course.share * 100"></span>
                  </div>
                </div>
              }
            </div>
          </div>
        }
      } @else {
        <p class="muted small">{{ t('dashboard.activity.empty') }}</p>
      }
    </section>

    <!-- ------------------------------------------------------ this session -->
    @if (summary(); as value) {
      <section>
        <h2 class="section-title">{{ t('dashboard.session.title') }}</h2>
        <div class="grid grid--4">
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
        </div>
      </section>

      <section>
        <h2 class="section-title">{{ t('dashboard.outcomes') }}</h2>
        <div class="card">
          @if (outcomeRows().length === 0) {
            <p class="muted small">{{ t('dashboard.outcomes.none') }}</p>
          } @else {
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
                @for (row of outcomeRows(); track row.action) {
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
          }
        </div>
      </section>
    }

    <section>
      <h2 class="section-title">{{ t('dashboard.bridge') }}</h2>
      <div class="card">
        @if (bridge(); as info) {
          @if (info.running) {
            <p class="muted small">{{ bridgeListening(info) }}</p>
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
  `,
})
export class DashboardPage {
  private readonly state = inject(AppStateService);
  private readonly i18n = inject(I18nService);

  protected readonly t = this.i18n.t;

  protected readonly ranges = INSIGHT_RANGES;
  protected readonly weekdays = WEEKDAYS;
  protected readonly rangeKeys = RANGE_KEYS;
  protected readonly radius = DONUT_RADIUS;

  protected readonly summary = computed(() => this.state.dashboard());
  protected readonly insights = this.state.insights;

  /** Policies that were never shown are rows of zeros — noise, not information. */
  protected readonly outcomeRows = computed(() =>
    (this.summary()?.interventionOutcomes ?? []).filter((row) => row.total > 0),
  );
  protected readonly range = this.state.insightRange;
  protected readonly recentEvents = computed(() => [...this.state.recentEvents()].reverse());
  protected readonly bridge = signal<BridgeInfo | null>(null);

  protected readonly stateShares = computed(() => sortedShares(this.insights()?.stateShares ?? []));
  protected readonly segments = computed(() => donutSegments(this.stateShares(), DONUT_RADIUS));

  /**
   * Share of the window spent on task. `RESUMING` counts: the learner has already
   * accepted the way back in. `DISTRACTED` and `INTERRUPTED` are the states this
   * product exists to shorten, so they are deliberately excluded.
   */
  protected readonly focusRatio = computed(() => {
    const shares = this.insights()?.stateShares ?? [];
    const total = shares.reduce((sum, item) => sum + item.durationMs, 0);
    if (total === 0) return 0;
    const engaged = shares
      .filter((item) => item.state === 'FOCUSED' || item.state === 'RESUMING')
      .reduce((sum, item) => sum + item.durationMs, 0);
    return engaged / total;
  });

  /**
   * Weekday-aligned padding is only worth it once the window is longer than a
   * week. A single week reads better as one labelled row than as a ragged grid
   * with a column of holes in front of it.
   */
  protected readonly blanks = computed(() => {
    const daily = this.insights()?.daily ?? [];
    const count = daily.length > 7 ? heatmapLeadingBlanks(daily) : 0;
    // A real array: `@for` needs something iterable, not a count.
    return new Array<number>(count).fill(0);
  });

  protected readonly busiest = computed(() => busiestDay(this.insights()?.daily ?? []));

  constructor() {
    void this.loadBridge();
    void this.state.loadInsights(this.state.insightRange());
  }

  private async loadBridge(): Promise<void> {
    this.bridge.set(await this.state.loadBridgeInfo());
  }

  protected selectRange(range: InsightRange): void {
    void this.state.loadInsights(range);
  }

  protected span(ms: number): string {
    return formatSpan(ms, this.t);
  }

  /** Templates cannot reach the global `String`, so the conversion lives here. */
  protected daysLabel(days: number): string {
    return days === 1
      ? this.t('dashboard.hero.over.one')
      : this.t('dashboard.hero.over.other', { days: `${days}` });
  }

  protected weekdayLabel(date: string): string {
    const key = WEEKDAYS[weekdayIndex(date)] ?? 'weekday.0';
    return this.t(key);
  }

  protected busiestLabel(day: DailyActivity): string {
    return this.t('dashboard.activity.busiest', {
      date: shortDate(day.date),
      time: this.span(day.durationMs),
    });
  }

  protected percent(share: number): string {
    return percentLabel(share);
  }

  protected level(durationMs: number): number {
    return heatLevel(durationMs, this.insights()?.maxDailyMs ?? 0);
  }

  protected color(state: LearningState): string {
    return STATE_COLORS[state];
  }

  protected stateLabel(state: LearningState): string {
    return this.t(STATE_KEYS[state]);
  }

  protected dayTitle(day: DailyActivity): string {
    return `${day.date} · ${this.span(day.durationMs)}`;
  }

  protected actionLabel(action: string): string {
    const key = ACTION_KEYS[action as keyof typeof ACTION_KEYS];
    return key === undefined ? action : this.t(key);
  }

  protected bridgeListening(info: BridgeInfo): string {
    return this.t('dashboard.bridge.listening', {
      url: info.url,
      version: `${info.protocolVersion}`,
      connections: `${info.connections}`,
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
    void this.state.loadInsights(this.state.insightRange());
    void this.loadBridge();
  }
}
