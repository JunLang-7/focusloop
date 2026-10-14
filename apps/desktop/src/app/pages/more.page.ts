import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import type {
  BridgeInfo,
  InterventionOutcomeSummary,
  RescueOutcomeSummary,
} from '@focusloop/shared-types';
import { AppStateService } from '../core/app-state.service';
import { I18nService } from '../core/i18n/i18n.service';
import { ACTION_KEYS, EVENT_SOURCE_KEYS, EVENT_TYPE_KEYS } from '../core/i18n/labels';
import { groupEvents, type EventGroup } from '../core/events-view';
import { formatClock } from '../core/format';
import { acceptedPercent } from '../core/insights-view';
import { suggestionRowViews } from '../core/memory-view';
import { reflectionView } from '../core/reflection-view';

/**
 * The record the dashboard leaves off.
 *
 * Five panels live here rather than on screen 5: the week as counts with their evidence (AG6.5) and the
 * preferences it suggests confirming (AG6.6), the intervention and rescue results (#22), the browser
 * bridge's pairing details (#135), and the folded event log (#8). None of them is something the learner
 * reads while deciding what to do next, and the dashboard is for the numbers that say whether
 * continuation worked — so they stay, one click away, instead of crowding it.
 *
 * It has to be a screen rather than a dialog for the same reason the dashboard was one: a change offer
 * is confirmed in a modal, and the log is what says whether it was applied *while that modal is open*.
 */
@Component({
  selector: 'fl-more',
  standalone: true,
  imports: [RouterLink],
  template: `
    <header class="page-head">
      <div>
        <p class="eyebrow">{{ t('more.eyebrow') }}</p>
        <h1>{{ t('more.title') }}</h1>
        <p class="muted small">{{ t('more.subtitle') }}</p>
      </div>
      <a class="btn" routerLink="/dashboard" data-testid="more-back">{{ t('more.back') }}</a>
    </header>

    <!--
      The week, as counts with their evidence (AG6.5): every line names the rows behind it and the
      window it counts; an empty week says so rather than printing seven honest zeros.
    -->
    <section data-testid="reflection-section">
      <h2 class="section-title">{{ t('app.reflection.title') }}</h2>
      @if (reflection(); as week) {
        @if (week.isEmpty) {
          <p class="muted small" data-testid="reflection-empty">{{ t('app.reflection.empty') }}</p>
        } @else {
          @if (week.stats.length > 0) {
            <p class="eyebrow">{{ t('app.reflection.stats') }}</p>
            <ul class="data-rows" data-testid="reflection-stats">
              @for (stat of week.stats; track stat.key) {
                <li data-testid="reflection-stat-row">
                  <strong>{{ t(stat.labelKey) }}</strong>
                  <span>{{ stat.value }}</span>
                  <span class="muted small">{{ t(stat.evidenceKey, stat.evidenceParams) }}</span>
                </li>
              }
            </ul>
          }
          @if (week.claims.length > 0) {
            <p class="eyebrow">{{ t('app.reflection.claims') }}</p>
            <ul class="data-rows" data-testid="reflection-claims">
              @for (claim of week.claims; track claim.scope) {
                <li data-testid="reflection-claim">
                  <strong>{{ t(claim.scopeKey) }}</strong>
                  <span class="muted small">{{ claim.valueText }}</span>
                  <span class="muted small">{{ t(claim.evidenceKey, claim.evidenceParams) }}</span>
                </li>
              }
            </ul>
          }
        }
      }
      <!--
        The candidates, one row each (AG6.6): scope, the value as a line, and the evidence that
        produced it — the same row function the stored preferences use, so a suggestion cannot
        read lighter than what confirming it will store. No rows below the sample: the engine
        never derives them, and nothing here invents one.
      -->
      @if (preferenceNotice(); as notice) {
        <p class="muted small" role="status" data-testid="suggestion-notice">{{ t(notice) }}</p>
      }
      @if (suggestions().length > 0) {
        <p class="eyebrow">{{ t('app.reflection.suggestions') }}</p>
        <ul class="data-rows" data-testid="suggestion-list">
          @for (suggestion of suggestions(); track suggestion.id) {
            <li data-testid="suggestion-row">
              <strong>{{ t(suggestion.scopeKey) }}</strong>
              <span class="muted small">{{ suggestion.valueText }}</span>
              <span class="muted small">{{
                t(suggestion.evidenceKey, suggestion.evidenceParams)
              }}</span>
              <button
                type="button"
                class="btn"
                data-testid="suggestion-confirm"
                [disabled]="stateBusy()"
                (click)="proposePreference(suggestion.id)"
              >
                {{ t('app.reflection.confirm') }}
              </button>
            </li>
          }
        </ul>
      }
    </section>

    @if (summary(); as value) {
      <section>
        <h2 class="section-title">{{ t('more.outcomes') }}</h2>
        <div class="card">
          @if (outcomeRows().length === 0) {
            <p class="muted small">{{ t('more.outcomes.none') }}</p>
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
                      t('more.outcomes.shareAria', { action: actionLabel(row.action) })
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
        <h2 class="section-title">{{ t('more.rescues') }}</h2>
        <div class="card">
          @if (rescueRows().length === 0) {
            <p class="muted small">{{ t('more.rescues.none') }}</p>
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
      <h2 class="section-title">{{ t('more.bridge') }}</h2>
      <div class="card">
        @if (bridge(); as info) {
          @if (info.running) {
            <!--
              #135: the socket address, the protocol version, the connection count and the token are
              behind a deliberate request. Nothing from the machinery is rendered until the learner
              asks for it - and asking has to be possible, because connecting the extension needs
              both the address and the token.
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
              {{ t(bridgeRevealed() ? 'more.bridge.hide' : 'more.bridge.reveal') }}
            </button>
            @if (bridgeRevealed()) {
              <div id="bridge-details">
                <p class="muted small">{{ bridgeListening(info) }}</p>
                <p class="muted small">{{ t('more.bridge.hint') }}</p>
                <pre class="token" data-testid="bridge-token">{{ info.token }}</pre>
              </div>
            }
          } @else {
            <p class="muted small" data-testid="bridge-stopped">{{ t('more.bridge.stopped') }}</p>
          }
        } @else {
          <p class="muted small" data-testid="bridge-unavailable">
            {{ t('more.bridge.unavailable') }}
          </p>
        }
      </div>
    </section>

    <section>
      <h2 class="section-title">{{ t('more.events') }}</h2>
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
          <li class="muted">{{ t('more.events.none') }}</li>
        }
      </ul>
    </section>
  `,
})
export class MorePage {
  private readonly state = inject(AppStateService);
  protected readonly t = inject(I18nService).t;

  /** The live session summary, which is what the intervention and rescue panels are drawn from. */
  protected readonly summary = computed(() => this.state.dashboard());

  /** Policies that were never shown are rows of zeros — noise, not information. */
  protected readonly outcomeRows = computed(() =>
    (this.summary()?.interventionOutcomes ?? []).filter((row) => row.total > 0),
  );

  /** Rescues the learner never took up have no result to show. */
  protected readonly rescueRows = computed(() =>
    (this.summary()?.rescueOutcomes ?? []).filter((row) => row.accepted > 0),
  );

  /**
   * Suggestions (AG6.6), rendered through the shared preference row — display only, and only what
   * reached its sample; the confirm flow (#236) is the one that will ever write.
   */
  protected readonly suggestions = computed(() => {
    const result = this.state.preferenceCandidates();
    return result === null || !result.ok
      ? []
      : suggestionRowViews(
          result.candidates,
          (iso) => (iso === null ? '—' : formatClock(iso)),
          new Date().toISOString(),
        );
  });

  /** The week as counts and claims — the pure view does the deciding, this only renders it (AG6.5). */
  protected readonly reflection = computed(() => {
    const week = this.state.weeklyReflection();
    return week === null
      ? null
      : reflectionView(week, (iso) => (iso === null ? '—' : formatClock(iso)));
  });

  /** Newest run first, so the log reads top-down as most-recent-first. */
  protected readonly eventGroups = computed(() =>
    groupEvents([...this.state.recentEvents()].reverse()),
  );

  protected readonly bridge = signal<BridgeInfo | null>(null);
  /**
   * Whether the bridge's machinery is on screen. Off until asked for: the address, protocol, connection
   * count and token are for whoever is connecting the extension (#135). Asking is a choice, and it can
   * be taken back.
   */
  protected readonly bridgeRevealed = signal(false);
  protected toggleBridge(): void {
    this.bridgeRevealed.update((shown) => !shown);
  }

  protected readonly preferenceNotice = this.state.preferenceNotice;
  protected readonly stateBusy = this.state.busy;

  protected async proposePreference(candidateId: string): Promise<void> {
    await this.state.proposePreference(candidateId);
  }

  constructor() {
    void this.loadBridge();
    /*
     * The week shares the insights lifecycle (AG6.5), so the read that fills this page is the same one
     * the dashboard makes on arrival - same range, same moment, no second source of truth.
     */
    void this.state.loadInsights(this.state.insightRange());
  }

  private async loadBridge(): Promise<void> {
    this.bridge.set(await this.state.loadBridgeInfo());
  }

  protected bridgeListening(info: BridgeInfo): string {
    return this.t('more.bridge.listening', {
      url: info.url,
      version: `${info.protocolVersion}`,
      connections: `${info.connections}`,
    });
  }

  protected actionLabel(action: string): string {
    const key = ACTION_KEYS[action as keyof typeof ACTION_KEYS];
    return key === undefined ? action : this.t(key);
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
    return this.t('more.outcomes.share', { percent: `${this.acceptedPercent(row)}%` });
  }

  /**
   * The counts the table used to carry, as one line.
   *
   * Built here rather than in the template because `t` takes strings and this component's markup is a
   * template literal: a nested backtick would end it, and the compiler reports the failure on a line
   * that has nothing to do with the cause.
   */
  protected outcomeCounts(row: InterventionOutcomeSummary): string {
    return this.t('more.outcomes.counts', {
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
    return this.t('more.outcomes.valueText', {
      percent: `${this.acceptedPercent(row)}%`,
      total: String(row.total),
    });
  }

  /** "Helped 2 of 3", or the plain statement that nothing has been judged yet. */
  protected rescueRate(row: RescueOutcomeSummary): string {
    const evaluated = row.accepted - row.pending;
    return evaluated === 0
      ? this.t('more.rescues.rateNone')
      : this.t('more.rescues.rate', {
          succeeded: String(row.succeeded),
          evaluated: String(evaluated),
        });
  }

  protected rescueCounts(row: RescueOutcomeSummary): string {
    return this.t('more.rescues.counts', {
      accepted: String(row.accepted),
      repeated: String(row.repeatedHelp),
      expired: String(row.expired),
      pending: String(row.pending),
    });
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
    return this.t('more.events.times', { count: `${count}` });
  }

  private at(iso: string): string {
    const date = new Date(iso);
    return Number.isNaN(date.getTime())
      ? '—'
      : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }
}
