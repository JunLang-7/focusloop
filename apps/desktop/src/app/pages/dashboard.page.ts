import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  INSIGHT_RANGES,
  type DailyActivity,
  type InsightRange,
  type LearningState,
} from '@focusloop/shared-types';
import { AppStateService } from '../core/app-state.service';
import { I18nService, type MessageKey } from '../core/i18n/i18n.service';
import { STATE_KEYS } from '../core/i18n/labels';
import {
  STATE_COLORS,
  busiestDay,
  donutSegments,
  focusRatio,
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
 * Screen 5 of 5: how is the learner doing - in the window they asked about, and in this session.
 *
 * Two scopes live on this page and they are deliberately kept apart. The window
 * section answers "how have I been doing lately" and is driven by the aggregated
 * insights; the session section answers "how is this session going" and is driven
 * by the live session summary. Mixing them would make every number ambiguous.
 *
 * What is deliberately *not* here: the week's evidence, the extension's pairing details and the event
 * log. None of them is a number the learner acts on while studying, and a page that answers two
 * questions is easier to read than one that answers five - they live on the screen this one links to
 * (`pages/more.page.ts`).
 */
@Component({
  selector: 'fl-dashboard',
  standalone: true,
  imports: [RouterLink],
  template: `
    <header class="page-head">
      <div>
        <p class="eyebrow">{{ t('dashboard.eyebrow') }}</p>
        <h1>{{ summary()?.courseTitle ?? t('dashboard.noSession') }}</h1>
        <p class="muted small">{{ t('dashboard.subtitle') }}</p>
      </div>
      <div class="row">
        <!-- The week, the bridge and the log are one click away rather than on this page. -->
        <a class="btn" routerLink="/more" data-testid="dashboard-more">{{ t('dashboard.more') }}</a>
        <button type="button" class="btn" data-testid="refresh" (click)="refresh()">
          {{ t('dashboard.refresh') }}
        </button>
      </div>
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
              <!--
                A footnote to both columns rather than a third one. The donut row is a flex row with the
                ring on a fixed basis and the legend growing; a paragraph placed inside it took a line to
                itself and pushed the legend off the ring's row. Below the row it spans the panel, which
                is what a note about both columns should do.
              -->
              <p class="muted small" data-testid="focus-ratio-hint">
                {{ t('dashboard.focusRatio.hint') }}
              </p>
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
                  <!--
                    The habit figure, and the one number here that is not windowed: a seven-day window
                    would cap a three-week streak at seven. It lives beside the heatmap because it is
                    the heatmap's sentence — the same days, counted in a row.
                  -->
                  <div class="heat__fact">
                    <span class="muted small">{{ t('dashboard.window.streak') }}</span>
                    <strong data-testid="insights-streak">{{ data.streakDays }}</strong>
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

      <!--
        Apart from the four above, because they answer a different question: not how this run is going,
        but what happened after it was interrupted - and they are drawn from the session's resume
        outcomes rather than from its own counts.
      -->
      <section>
        <h2 class="section-title">{{ t('dashboard.resume.title') }}</h2>
        <div class="grid grid--pair">
          <div class="card stat-card">
            <span class="stat__label">{{ t('dashboard.reengageRate') }}</span>
            <strong data-testid="reengage-rate">{{ reengageRate() }}</strong>
            <span class="muted small" data-testid="reengage-sample">{{ reengageSample() }}</span>
          </div>
          <div class="card stat-card">
            <span class="stat__label">{{ t('dashboard.progressRate') }}</span>
            <strong data-testid="progress-rate">{{ progressRate() }}</strong>
            <span class="muted small" data-testid="progress-sample">{{ progressSample() }}</span>
          </div>
        </div>
      </section>
    }
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

  protected readonly range = this.state.insightRange;

  protected readonly stateShares = computed(() => sortedShares(this.insights()?.stateShares ?? []));
  protected readonly segments = computed(() => donutSegments(this.stateShares(), DONUT_RADIUS));

  /** Share of the window spent on task. What counts as focus lives in `focusRatio`. */
  protected readonly focusRatio = computed(() => focusRatio(this.insights()?.stateShares ?? []));

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
    void this.state.loadInsights(this.state.insightRange());
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

  protected duration(): string {
    return formatDuration(this.summary()?.sessionDurationMs ?? 0);
  }

  protected latency(): string {
    return formatLatency(this.summary()?.averageResumeLatencyMs ?? null);
  }

  protected reengageRate(): string {
    const rate = this.summary()?.resumeOutcomes.reengageRate ?? null;
    return rate === null ? '—' : percentLabel(rate);
  }

  protected progressRate(): string {
    const rate = this.summary()?.resumeOutcomes.progressRate ?? null;
    return rate === null ? '—' : percentLabel(rate);
  }

  protected reengageSample(): string {
    const summary = this.summary()?.resumeOutcomes;
    if (summary === undefined || summary.reengageRate === null) {
      return this.t('dashboard.reengageRate.sample', {
        reengaged: '0',
        evaluated: '0',
        stalled: '0',
        pending: '0',
      });
    }
    return this.t('dashboard.reengageRate.sample', {
      reengaged: `${summary.reengaged}`,
      evaluated: `${summary.accepted - summary.pending}`,
      stalled: `${summary.stalledAgain}`,
      pending: `${summary.pending}`,
    });
  }

  protected progressSample(): string {
    const summary = this.summary()?.resumeOutcomes;
    if (summary === undefined || summary.progressRate === null) {
      return this.t('dashboard.progressRate.sample', {
        progressed: '0',
        evaluated: '0',
        pending: '0',
      });
    }
    return this.t('dashboard.progressRate.sample', {
      progressed: `${summary.progressed}`,
      evaluated: `${summary.accepted - summary.pending}`,
      pending: `${summary.pending}`,
    });
  }

  protected refresh(): void {
    void this.state.refresh();
    void this.state.loadInsights(this.state.insightRange());
  }
}
