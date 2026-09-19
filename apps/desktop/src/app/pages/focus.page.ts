import { Component, computed, inject, signal } from '@angular/core';
import type { OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import type { MicroTask, MicroTaskKind } from '@focusloop/shared-types';
import { AppStateService } from '../core/app-state.service';
import {
  DEFAULT_FOCUS_MINUTES,
  addMinute,
  createFocusTimer,
  formatFocusTime,
  pause as pauseTimer,
  reset as resetTimer,
  resume as resumeTimer,
  start as startTimer,
  tick as tickTimer,
  type FocusTimerState,
} from '../core/focus-timer';
import { I18nService } from '../core/i18n/i18n.service';
import { STATE_KEYS, kindLabel } from '../core/i18n/labels';
import { formatDuration } from '../core/format';
import { formatSpan } from '../core/insights-view';
import { KIND_GLYPHS, buildPlan } from '../core/session-plan';
import { keepsRail, type FocusPhase } from '../core/focus-phase';

const CLOCK_RADIUS = 86;
const CLOCK_CIRCUMFERENCE = 2 * Math.PI * CLOCK_RADIUS;

/** Screen 3 of 5: a quiet, single-task focus workspace. */
@Component({
  selector: 'fl-focus',
  standalone: true,
  template: `
    @if (snapshot(); as current) {
      <div class="focus-workspace" [attr.data-phase]="phase()" [attr.data-rail]="railAttr()">
        <header class="focus-stage__topbar">
          <div class="focus-stage__identity">
            <p class="eyebrow">{{ t('focus.eyebrow') }}</p>
            <h1>{{ current.courseTitle ?? t('focus.untitled') }}</h1>
          </div>
          <div class="focus-stage__actions">
            <span
              class="focus-stage__state"
              data-testid="state"
              [attr.data-state]="current.session.state"
            >
              {{ stateLabel() }}
            </span>
            <button type="button" class="btn btn--ghost" data-testid="end-session" (click)="end()">
              {{ t('focus.end') }}
            </button>
          </div>
        </header>

        <main class="focus-stage">
          <div class="focus-progress-strip" aria-label="{{ t('focus.progress') }}">
            <span class="focus-progress-strip__item">
              <span class="focus-progress-strip__label">{{ t('focus.progress') }}</span>
              <strong data-testid="tasks-completed"
                >{{ current.progress.completedTasks }} / {{ current.progress.totalTasks }}</strong
              >
            </span>
            <span class="focus-progress-strip__item">
              <span class="focus-progress-strip__label">{{ t('focus.elapsed') }}</span>
              <strong data-testid="elapsed">{{ elapsed() }}</strong>
            </span>
            <span
              class="focus-progress-strip__meter"
              role="progressbar"
              [attr.aria-label]="t('focus.progress')"
              aria-valuemin="0"
              [attr.aria-valuenow]="current.progress.completedTasks"
              [attr.aria-valuemax]="current.progress.totalTasks"
              [attr.aria-valuetext]="
                current.progress.completedTasks + ' / ' + current.progress.totalTasks
              "
            >
              <span
                class="focus-progress-strip__fill"
                [style.width.%]="current.progress.completionRatio * 100"
              ></span>
            </span>
          </div>

          @if (phase() === 'ready') {
            @if (nextTask(); as upcoming) {
              <section class="focus-task focus-task--ready" aria-labelledby="focus-ready-title">
                <p class="eyebrow">{{ t('focus.nextTask') }}</p>
                <h2 id="focus-ready-title" data-testid="task-title">{{ upcoming.title }}</h2>
                <p class="focus-task__instructions">{{ upcoming.instructions }}</p>
                <div class="focus-task__meta">
                  <span class="chip" data-testid="task-kind">{{ kind(upcoming.kind) }}</span>
                  <span class="muted small">{{ estimate(upcoming.estimatedMinutes) }}</span>
                </div>
                <div class="focus-task__action-row">
                  <button
                    type="button"
                    class="btn btn--primary"
                    data-testid="start-task"
                    (click)="startQuick(upcoming.id)"
                  >
                    {{ t('focus.startThree') }}
                  </button>
                  <span class="focus-task__time-note">{{ t('focus.readyHint') }}</span>
                </div>
              </section>
            } @else {
              <section class="focus-task focus-task--empty">
                <p class="muted">{{ t('focus.allDone') }}</p>
              </section>
            }
          } @else if (phase() === 'complete') {
            <section class="focus-task focus-task--complete" aria-labelledby="focus-complete-title">
              <p class="eyebrow">{{ t('focus.completeEyebrow') }}</p>
              <h2 id="focus-complete-title">{{ t('focus.completedTitle') }}</h2>
              @if (nextTask(); as upcoming) {
                <p class="focus-task__next-label">{{ t('focus.nextTask') }}</p>
                <p class="focus-task__next-title" data-testid="task-title">{{ upcoming.title }}</p>
                <div class="focus-task__action-row">
                  <button
                    type="button"
                    class="btn btn--primary"
                    data-testid="start-task"
                    (click)="startQuick(upcoming.id)"
                  >
                    {{ t('focus.continueNext') }}
                  </button>
                </div>
              } @else {
                <p class="focus-task__instructions">{{ t('focus.allDone') }}</p>
              }
            </section>
          } @else if (task(); as currentTask) {
            <section class="focus-task focus-task--active" aria-labelledby="focus-task-title">
              <div class="focus-task__copy">
                <p class="eyebrow">{{ t('focus.currentTask') }}</p>
                <h2 id="focus-task-title" data-testid="task-title">{{ currentTask.title }}</h2>
                <p class="focus-task__instructions">{{ currentTask.instructions }}</p>
                <div class="focus-task__meta">
                  <span class="chip" data-testid="task-kind">{{ kind(currentTask.kind) }}</span>
                  <span class="muted small">{{ estimate(currentTask.estimatedMinutes) }}</span>
                </div>
              </div>
              <div class="focus-clock" role="timer" [attr.aria-label]="t('focus.timerAria')">
                <svg class="focus-clock__svg" viewBox="0 0 200 200" aria-hidden="true">
                  <circle
                    class="focus-clock__track"
                    cx="100"
                    cy="100"
                    [attr.r]="CLOCK_RADIUS"
                  ></circle>
                  <circle
                    class="focus-clock__progress"
                    cx="100"
                    cy="100"
                    [attr.r]="CLOCK_RADIUS"
                    [attr.stroke-dasharray]="CLOCK_CIRCUMFERENCE"
                    [attr.stroke-dashoffset]="clockDashOffset()"
                  ></circle>
                </svg>
                <span class="focus-clock__value">{{ clockValue() }}</span>
                @if (phase() === 'paused') {
                  <span class="focus-clock__status">{{ t('focus.paused') }}</span>
                } @else if (phase() === 'expired') {
                  <span class="focus-clock__status">{{ t('focus.timeUp') }}</span>
                }
              </div>
              <div class="focus-controls">
                @if (phase() === 'paused' || phase() === 'expired') {
                  <button type="button" class="btn btn--primary" (click)="resume()">
                    {{ phase() === 'expired' ? t('focus.addMinute') : t('focus.resume') }}
                  </button>
                } @else {
                  <button type="button" class="btn" (click)="pause()">
                    {{ t('focus.pause') }}
                  </button>
                }
                <button type="button" class="btn btn--quiet" (click)="addMinuteToTimer()">
                  {{ t('focus.addMinute') }}
                </button>
                <button type="button" class="btn btn--quiet" (click)="needHelp(currentTask.id)">
                  {{ t('focus.stuck') }}
                </button>
                <button
                  type="button"
                  class="btn btn--primary"
                  data-testid="complete-task"
                  (click)="complete(currentTask.id)"
                >
                  {{ t('focus.complete') }}
                </button>
              </div>
            </section>
          }

          <details class="focus-plan">
            <summary class="focus-plan__summary" data-testid="focus-plan-toggle">
              <span>{{ t('focus.showPlan') }}</span>
              @if (plan().blocks.length > 0) {
                <span class="muted small" data-testid="plan-remaining">{{
                  remaining(plan().totalMinutes)
                }}</span>
              }
            </summary>
            @if (plan().blocks.length === 0) {
              <p class="muted">{{ t('focus.allDone') }}</p>
            } @else {
              <ul class="plan focus-plan__timeline" [style.height.px]="plan().height">
                @for (block of plan().blocks; track block.id) {
                  <li
                    class="plan__block focus-plan__block"
                    data-testid="plan-block"
                    [attr.data-kind]="block.kind"
                    [style.top.px]="block.offset"
                    [style.height.px]="block.height"
                  >
                    <span class="plan__glyph" aria-hidden="true">{{ glyph(block.kind) }}</span
                    ><span class="plan__title">{{ block.title }}</span
                    ><span class="muted small plan__estimate">{{
                      shortEstimate(block.minutes)
                    }}</span>
                    <button
                      type="button"
                      class="btn btn--small"
                      data-testid="start-task"
                      (click)="start(block.id)"
                    >
                      {{ t('focus.startTask') }}
                    </button>
                  </li>
                }
              </ul>
            }
          </details>
        </main>
      </div>
    } @else {
      <div class="focus-workspace" data-phase="ready">
        <section class="focus-task focus-task--empty">
          <h1>{{ t('focus.none.title') }}</h1>
          <p class="muted">{{ t('focus.none.body') }}</p>
          <button type="button" class="btn btn--primary" (click)="back()">
            {{ t('focus.none.browse') }}
          </button>
        </section>
      </div>
    }
  `,
})
export class FocusPage implements OnDestroy {
  private readonly state = inject(AppStateService);
  private readonly router = inject(Router);
  private readonly i18n = inject(I18nService);
  private timerHandle: ReturnType<typeof setInterval> | null = null;
  private timer = signal<FocusTimerState>(createFocusTimer());
  private readonly completedView = signal(false);

  protected readonly t = this.i18n.t;
  protected readonly snapshot = this.state.snapshot;
  protected readonly task = this.state.currentTask;
  protected readonly CLOCK_RADIUS = CLOCK_RADIUS;
  protected readonly CLOCK_CIRCUMFERENCE = CLOCK_CIRCUMFERENCE;
  protected readonly phase = computed<FocusPhase>(() => {
    if (this.snapshot() === null) return 'ready';
    if (this.completedView()) return 'complete';
    const local = this.timer().phase;
    if (local !== 'ready') return local;
    const sessionState = this.snapshot()?.session.state;
    return this.task() !== null && (sessionState === 'FOCUSED' || sessionState === 'RESUMING')
      ? 'active'
      : 'ready';
  });
  /**
   * Whether the shell narrows to a rail. The policy is `keepsRail` in core/focus-phase.ts, so it
   * is unit-tested without rendering this page; the stylesheet only matches `[data-rail]`.
   */
  protected readonly rail = computed(() => keepsRail(this.phase()));
  /** An empty attribute is present; `null` removes it, which is what the stylesheet keys on. */
  protected readonly railAttr = computed(() => (this.rail() ? '' : null));
  protected readonly plan = computed(() => buildPlan(this.openTasks()));
  protected readonly nextTask = computed<MicroTask | null>(() => this.openTasks()[0] ?? null);

  protected glyph(kind: MicroTaskKind): string {
    return KIND_GLYPHS[kind];
  }
  protected remaining(minutes: number): string {
    return this.t('focus.plan.remaining', { time: formatSpan(minutes * 60_000, this.t) });
  }
  protected shortEstimate(minutes: number): string {
    return this.t('course.minutes', { minutes: `${minutes}` });
  }
  protected stateLabel(): string {
    return this.t(STATE_KEYS[this.state.state()]);
  }
  protected kind(value: string): string {
    return kindLabel(value, this.t);
  }
  protected estimate(minutes: number): string {
    return this.t('focus.taskMeta', { minutes: `${minutes}` });
  }
  protected elapsed(): string {
    return formatDuration(this.snapshot()?.progress.elapsedMs ?? 0);
  }
  protected clockValue(): string {
    const milliseconds =
      this.timer().remainingMs ||
      (this.phase() === 'active' ? (this.task()?.estimatedMinutes ?? 0) * 60_000 : 0);
    return formatFocusTime(milliseconds);
  }
  protected clockDashOffset(): number {
    return this.phase() === 'complete' ? 0 : CLOCK_CIRCUMFERENCE * (1 - this.timer().progress);
  }

  protected async startQuick(taskId: string): Promise<void> {
    await this.start(taskId, DEFAULT_FOCUS_MINUTES);
  }
  protected async start(taskId: string, minutes?: number): Promise<void> {
    await this.state.dispatch('TASK_STARTED', { taskId });
    const task = this.findTask(taskId);
    this.completedView.set(false);
    this.timer.set(
      startTimer(resetTimer(minutes ?? Math.max(1, task?.estimatedMinutes ?? 1)), Date.now()),
    );
    this.startInterval();
  }
  protected pause(): void {
    this.timer.update((value) => pauseTimer(value, Date.now()));
    this.clearTimer();
  }
  protected resume(): void {
    if (this.timer().phase === 'expired') {
      this.addMinuteToTimer();
      return;
    }
    this.timer.update((value) => resumeTimer(value, Date.now()));
    this.startInterval();
  }
  protected addMinuteToTimer(): void {
    this.timer.update((value) => addMinute(value, Date.now()));
    this.startInterval();
  }
  protected async complete(taskId: string): Promise<void> {
    await this.state.dispatch('TASK_COMPLETED', { taskId });
    this.clearTimer();
    this.timer.set(createFocusTimer());
    this.completedView.set(true);
  }
  protected async needHelp(taskId: string): Promise<void> {
    await this.state.dispatch('HELP_REQUESTED', { taskId });
  }
  protected async end(): Promise<void> {
    this.clearTimer();
    await this.state.endSession('user');
  }
  protected back(): void {
    void this.router.navigate(['/home']);
  }
  ngOnDestroy(): void {
    this.clearTimer();
  }

  protected openTasks(): readonly MicroTask[] {
    const course = this.state.currentCourse();
    const snapshot = this.snapshot();
    if (course === null || snapshot === null) return [];
    const done = new Set(snapshot.session.completedTaskIds);
    return course.microTasks.filter(
      (item) => !done.has(item.id) && item.id !== snapshot.session.currentTaskId,
    );
  }
  private findTask(taskId: string): MicroTask | null {
    return this.state.currentCourse()?.microTasks.find((item) => item.id === taskId) ?? null;
  }
  private startInterval(): void {
    this.clearTimer();
    this.timerHandle = setInterval(
      () => this.timer.update((value) => tickTimer(value, Date.now())),
      250,
    );
  }
  private clearTimer(): void {
    if (this.timerHandle !== null) {
      clearInterval(this.timerHandle);
      this.timerHandle = null;
    }
  }
}
