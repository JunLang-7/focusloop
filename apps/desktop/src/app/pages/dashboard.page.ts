import { Component, computed, inject, signal } from '@angular/core';
import {
  INSIGHT_RANGES,
  type BridgeInfo,
  type DailyActivity,
  type InsightRange,
  type InterventionOutcomeSummary,
  type LearningState,
  type RescueOutcomeSummary,
} from '@focusloop/shared-types';
import { AppStateService } from '../core/app-state.service';
import { I18nService, type MessageKey } from '../core/i18n/i18n.service';
import { ACTION_KEYS, EVENT_SOURCE_KEYS, EVENT_TYPE_KEYS, STATE_KEYS } from '../core/i18n/labels';
import { groupEvents, type EventGroup } from '../core/events-view';
import {
  STATE_COLORS,
  acceptedPercent,
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

      <section>
        <h2 class="section-title">{{ t('dashboard.outcomes') }}</h2>
        <div class="card">
          @if (outcomeRows().length === 0) {
            <p class="muted small">{{ t('dashboard.outcomes.none') }}</p>
          } @else {
            <!--
              #22: this was a five-column table for at most eight rows of small integers, which made the
              reader do the comparison in their head. One row per action, as a bar: the question is "which
              of these helped", and a bar answers it at a glance. The counts stay as text beside it, so
              nothing the table carried is lost.
            -->
            <div class="bars" data-testid="outcome-rows">
              @for (row of outcomeRows(); track row.action) {
                <div class="bar" data-testid="outcome-row">
                  <div class="bar__head">
                    <span class="bar__name">{{ actionLabel(row.action) }}</span>
                    <span class="muted small" data-testid="outcome-share">
                      {{ outcomeShare(row) }}
                    </span>
                  </div>
                  <div
                    class="bar__track"
                    role="progressbar"
                    [attr.aria-label]="
                      t('dashboard.outcomes.shareAria', { action: actionLabel(row.action) })
                    "
                    [attr.aria-valuenow]="acceptedPercent(row)"
                    [attr.aria-valuetext]="outcomeValueText(row)"
                    aria-valuemin="0"
                    aria-valuemax="100"
                  >
                    <span class="bar__fill" [style.width.%]="acceptedPercent(row)"></span>
                  </div>
                  <!--
                    The sample size is written out, not implied. A row with one card otherwise reads as a
                    100% success rate, and the difference between "always" and "once" is the whole point of
                    these numbers.
                  -->
                  <p class="muted small bar__counts" data-testid="outcome-counts">
                    {{ outcomeCounts(row) }}
                  </p>
                </div>
              }
            </div>
          }
        </div>
      </section>

      <section>
        <h2 class="section-title">{{ t('dashboard.rescues') }}</h2>
        <div class="card">
          @if (rescueRows().length === 0) {
            <p class="muted small">{{ t('dashboard.rescues.none') }}</p>
          } @else {
            <!--
              Only rescues the learner took up: a dismissed card tried nothing, so it has no result. The
              rate leaves out the ones still inside their window, and the sample is written out for the
              same reason the intervention bars do it.
            -->
            <div class="bars" data-testid="rescue-rows">
              @for (row of rescueRows(); track row.action) {
                <div class="bar" data-testid="rescue-row" [attr.data-action]="row.action">
                  <div class="bar__head">
                    <span class="bar__name">{{ actionLabel(row.action) }}</span>
                    <span class="muted small" data-testid="rescue-rate">{{ rescueRate(row) }}</span>
                  </div>
                  <p class="muted small bar__counts" data-testid="rescue-counts">
                    {{ rescueCounts(row) }}
                  </p>
                </div>
              }
            </div>
          }
        </div>
      </section>
    }

    <section>
      <h2 class="section-title">{{ t('dashboard.bridge') }}</h2>
      <div class="card">
        @if (bridge(); as info) {
          @if (info.running) {
            <!--
              #135: the socket address, the protocol version, the connection count and the token are
              behind a deliberate request. A learner opens this screen for their continuity numbers,
              so nothing from the machinery is rendered until they ask for it - and asking has to be
              possible, because connecting the extension needs both the address and the token.
              The region sits *after* its trigger, with aria-controls pointing back at it: a screen
              reader is told the content appeared and where, and the button does not move out from
              under the pointer that just clicked it.
            -->
            <button
              type="button"
              class="btn btn--small"
              data-testid="bridge-reveal"
              aria-controls="bridge-details"
              [attr.aria-expanded]="bridgeRevealed()"
              (click)="toggleBridge()"
            >
              {{ t(bridgeRevealed() ? 'dashboard.bridge.hide' : 'dashboard.bridge.reveal') }}
            </button>
            @if (bridgeRevealed()) {
              <div id="bridge-details">
                <p class="muted small">{{ bridgeListening(info) }}</p>
                <p class="muted small">{{ t('dashboard.bridge.hint') }}</p>
                <pre class="token" data-testid="bridge-token">{{ info.token }}</pre>
              </div>
            }
          } @else {
            <p class="muted small" data-testid="bridge-stopped">
              {{ t('dashboard.bridge.stopped') }}
            </p>
          }
        } @else {
          <p class="muted small" data-testid="bridge-unavailable">
            {{ t('dashboard.bridge.unavailable') }}
          </p>
        }
      </div>
    </section>

    <section>
      <h2 class="section-title">{{ t('dashboard.events') }}</h2>
      <ul class="timeline">
        @for (group of eventGroups(); track group.id) {
          <li data-testid="timeline-row">
            <span class="muted small timeline__at">{{ timeLabel(group) }}</span>
            <!--
              #8: the row reads as history, not as the event log. EVENT_TYPE_KEYS and EVENT_SOURCE_KEYS
              are exhaustive over the closed vocabularies, so the wording exists in both languages by
              construction - and the exact name stays on the title attribute, because the audit detail is
              the reason this list is worth keeping.
            -->
            <strong [attr.title]="group.type">{{ eventTypeLabel(group.type) }}</strong>
            @if (group.count > 1) {
              <!--
                The multiplication sign is the shorthand; the accessible name is the
                spoken form. The count is the reason this row exists, so it must not be
                visual-only.
              -->
              <span class="timeline__count muted" [attr.aria-label]="timesLabel(group.count)">
                ×{{ group.count }}
              </span>
            }
            <span class="muted small timeline__source" [attr.title]="group.source">{{
              eventSourceLabel(group.source)
            }}</span>
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

  /** Rescues the learner never took up have no result to show. */
  protected readonly rescueRows = computed(() =>
    (this.summary()?.rescueOutcomes ?? []).filter((row) => row.accepted > 0),
  );
  /** Policies that were never shown are rows of zeros — noise, not information. */
  protected readonly outcomeRows = computed(() =>
    (this.summary()?.interventionOutcomes ?? []).filter((row) => row.total > 0),
  );
  protected readonly range = this.state.insightRange;
  /**
   * Newest run first. Reversing first means the log reads top-down as most-recent-first,
   * which is the only order an audit tail is useful in.
   */
  protected readonly eventGroups = computed(() =>
    groupEvents([...this.state.recentEvents()].reverse()),
  );
  protected readonly bridge = signal<BridgeInfo | null>(null);
  /**
   * Whether the bridge's machinery is on screen. Off until asked for: the learner reads this page for
   * their continuity numbers, and the address, protocol, connection count and token are for whoever
   * is connecting the extension (#135). Asking is a choice, and it can be taken back.
   */
  protected readonly bridgeRevealed = signal(false);
  protected toggleBridge(): void {
    this.bridgeRevealed.update((shown) => !shown);
  }

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

  /**
   * How often this action was accepted, as a whole percent from the one function that rounds it.
   *
   * The row states this number three times - here, as the bar's width, and as `aria-valuenow` - which is
   * why they all come from `acceptedPercent` rather than each formatting the share itself.
   */
  protected acceptedPercent(row: InterventionOutcomeSummary): number {
    return acceptedPercent(row.accepted, row.total);
  }

  /**
   * The share as the row states it: one number, the same one the bar draws.
   *
   * Built here rather than in the template because `t` takes strings and this component's markup is a
   * template literal: a nested backtick would end it, and the compiler reports the failure on a line that
   * has nothing to do with the cause.
   */
  protected outcomeShare(row: InterventionOutcomeSummary): string {
    return this.t('dashboard.outcomes.share', { percent: `${this.acceptedPercent(row)}%` });
  }

  /**
   * The counts the table used to carry, as one line.
   *
   * Built here rather than in the template because `t` takes strings and this component's markup is a
   * template literal: a nested backtick would end it, and the compiler reports the failure on a line
   * that has nothing to do with the cause.
   */
  protected outcomeCounts(row: InterventionOutcomeSummary): string {
    return this.t('dashboard.outcomes.counts', {
      accepted: String(row.accepted),
      dismissed: String(row.dismissed),
      completed: String(row.tasksCompleted),
      total: String(row.total),
    });
  }

  /**
   * What the bar reads out as its value: the share, and the sample size it is a share *of*.
   *
   * `aria-valuetext` replaces `aria-valuenow` in the announcement, so stating only the counts there would
   * drop the very number the bar is about; stating the whole counts line would repeat the paragraph below
   * and still lose the share.
   */
  protected outcomeValueText(row: InterventionOutcomeSummary): string {
    return this.t('dashboard.outcomes.valueText', {
      percent: `${this.acceptedPercent(row)}%`,
      total: String(row.total),
    });
  }

  /** "Helped 2 of 3", or the plain statement that nothing has been judged yet. */
  protected rescueRate(row: RescueOutcomeSummary): string {
    const evaluated = row.accepted - row.pending;
    return evaluated === 0
      ? this.t('dashboard.rescues.rateNone')
      : this.t('dashboard.rescues.rate', {
          succeeded: String(row.succeeded),
          evaluated: String(evaluated),
        });
  }

  protected rescueCounts(row: RescueOutcomeSummary): string {
    return this.t('dashboard.rescues.counts', {
      accepted: String(row.accepted),
      repeated: String(row.repeatedHelp),
      expired: String(row.expired),
      pending: String(row.pending),
    });
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

  /**
   * The history's wording for what happened.
   *
   * The fallback keeps the raw vocabulary visible rather than blanking the row: every type in
   * `LEARNING_EVENT_TYPES` is in the map, so reaching it means a record naming something this build does
   * not know, and an unfamiliar word is more useful in an audit tail than an empty one.
   */
  protected eventTypeLabel(type: string): string {
    const key = EVENT_TYPE_KEYS[type as keyof typeof EVENT_TYPE_KEYS];
    return key === undefined ? type : this.t(key);
  }

  /** Where it came from - the app was told, or the browser said so. */
  protected eventSourceLabel(source: string): string {
    const key = EVENT_SOURCE_KEYS[source as keyof typeof EVENT_SOURCE_KEYS];
    return key === undefined ? source : this.t(key);
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

  /**
   * The row's time, and a span only when the run is wider than a single instant.
   *
   * `00:17:06` printed twice would be noise, and the demo's three-event run happens
   * inside one second, so the span only earns its place on a genuinely spread-out run.
   */
  protected timeLabel(group: EventGroup): string {
    const newest = this.at(group.newestAt);
    if (group.count === 1) return newest;
    const oldest = this.at(group.oldestAt);
    return oldest === newest ? newest : `${oldest}–${newest}`;
  }

  protected timesLabel(count: number): string {
    return this.t('dashboard.events.times', { count: `${count}` });
  }

  private at(iso: string): string {
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
