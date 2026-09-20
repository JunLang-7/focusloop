import { Component, computed, effect, inject, signal, viewChild } from '@angular/core';
import type { ElementRef, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import type { MicroTask, MicroTaskKind, StuckReason } from '@focusloop/shared-types';
import { STUCK_REASONS } from '@focusloop/shared-types';
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
import { STATE_KEYS, STUCK_REASON_KEYS, kindLabel } from '../core/i18n/labels';
import { formatDuration } from '../core/format';
import { formatSpan } from '../core/insights-view';
import { KIND_GLYPHS, buildPlan } from '../core/session-plan';
import { keepsRail, type FocusPhase } from '../core/focus-phase';
import { PLAN_INITIAL_OPEN, nextPlanOpen, type PlanEvent } from '../core/plan-visibility';
import { helpRequestPayload } from '../core/stuck-picker';

const CLOCK_RADIUS = 86;
const CLOCK_CIRCUMFERENCE = 2 * Math.PI * CLOCK_RADIUS;

/** Screen 3 of 5: a quiet, single-task focus workspace. */
@Component({
  selector: 'fl-focus',
  standalone: true,
  /*
   * Both of these belong to the document rather than to this element. The plan panel is not a
   * modal, so by the time the learner changes their mind, focus may be anywhere on the page — and a
   * click that lands outside the panel never reaches it at all.
   */
  host: {
    '(document:keydown.escape)': 'onEscape()',
    '(document:click)': 'onDocumentClick($event)',
  },
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
                <!--
                  The reason is asked for here, because this is the only place it can come from. What
                  the agent should do next turns on which kind of stuck this is — shrink the task,
                  explain it another way, or stop — and the learning state cannot tell those apart.

                  Escape closes it again. "I would rather not say" is a real answer and deliberately
                  not the way back, so without that a learner who opened this by mistake would have to
                  send an event to escape — which is the interruption this control exists to avoid.
                -->
                @if (stuckOpen()) {
                  <div
                    class="stuck-reasons"
                    role="group"
                    tabindex="-1"
                    #stuckGroup
                    data-testid="stuck-reasons"
                    [attr.aria-label]="t('focus.stuck.aria')"
                  >
                    @for (reason of stuckReasons; track reason) {
                      <button
                        type="button"
                        class="btn btn--small"
                        [attr.data-testid]="'stuck-' + reason"
                        (click)="sayStuck(currentTask.id, reason)"
                      >
                        {{ t(STUCK_REASON_KEYS[reason]) }}
                      </button>
                    }
                    <!--
                      "I would rather not say" is a real answer and not a cancel button: it sends the
                      same request as before this existed, and the policy falls through to the state
                      rules for it.
                    -->
                    <button
                      type="button"
                      class="btn btn--small btn--quiet"
                      data-testid="stuck-unsaid"
                      (click)="sayStuck(currentTask.id, null)"
                    >
                      {{ t('focus.stuck.unsaid') }}
                    </button>
                  </div>
                } @else {
                  <button
                    type="button"
                    class="btn btn--quiet"
                    #stuckTrigger
                    data-testid="focus-stuck"
                    (click)="openStuck()"
                  >
                    {{ t('focus.stuck') }}
                  </button>
                }
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

          <!--
            The open state is owned by the component, in core/plan-visibility.ts. While the browser
            held it, the summary that raised the card was also the only thing that could lower it:
            Escape did nothing, a click elsewhere did nothing, and starting a step left the card
            over the task.
          -->
          <section class="focus-plan" #planRoot [attr.data-open]="planOpen() ? '' : null">
            <button
              type="button"
              class="focus-plan__summary"
              #planTrigger
              data-testid="focus-plan-toggle"
              aria-controls="focus-plan-panel"
              [attr.aria-expanded]="planOpen()"
              (click)="togglePlan()"
            >
              <span>{{ planOpen() ? t('focus.hidePlan') : t('focus.showPlan') }}</span>
              @if (plan().blocks.length > 0) {
                <span class="muted small" data-testid="plan-remaining">{{
                  remaining(plan().totalMinutes)
                }}</span>
              }
            </button>

            @if (planOpen()) {
              <div class="focus-plan__panel" id="focus-plan-panel">
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
              </div>
            }
          </section>
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
  private readonly planOpenState = signal(PLAN_INITIAL_OPEN);
  protected readonly planOpen = this.planOpenState.asReadonly();
  private readonly planRoot = viewChild<ElementRef<HTMLElement>>('planRoot');
  private readonly planTrigger = viewChild<ElementRef<HTMLButtonElement>>('planTrigger');
  private readonly stuckTrigger = viewChild<ElementRef<HTMLButtonElement>>('stuckTrigger');
  private readonly stuckGroup = viewChild<ElementRef<HTMLElement>>('stuckGroup');

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

  /** Set by the two ways out of the chooser: both destroy the focused element, so both owe it on. */
  private stuckReturnFocus = false;
  /** Cleared when the chooser closes. While it is set, focus has already been moved into the group. */
  private stuckFocusMoved = false;

  /**
   * Moving focus in and out of the chooser, which only exists while it is open.
   *
   * An effect rather than a call inside the handler or the template, because both ends of this are
   * elements that do not exist at the moment the change is made: opening replaces the trigger with the
   * group, and closing replaces the group with the trigger. Focusing either one from a handler reads a
   * `viewChild` that is still empty, and the focus goes nowhere — which is what the e2e caught when
   * this was a synchronous `focus()` in `dismissStuck`.
   *
   * Focus goes to the group rather than to the first reason. The group carries the label that asks the
   * question, so the question is what gets announced, and nothing is pre-selected for the learner.
   * This is the arrangement the resume card uses, and its comment gives the reason it is not optional:
   * without moving focus in, the keyboard is left on the page behind.
   *
   * Every close hands the focus back, whichever of the two it was. A first version returned it only on
   * Escape, on the grounds that after answering, the learner's attention is on the suggestion that just
   * appeared — which is an argument against moving focus *to the suggestion*, not for leaving it on the
   * body, and the review was right to call it out.
   */
  private readonly manageStuckFocus = effect(() => {
    if (this.stuckOpen()) {
      const group = this.stuckGroup()?.nativeElement;
      if (group !== undefined && !this.stuckFocusMoved) {
        this.stuckFocusMoved = true;
        group.focus();
      }
      return;
    }

    this.stuckFocusMoved = false;
    const trigger = this.stuckTrigger()?.nativeElement;
    if (this.stuckReturnFocus && trigger !== undefined) {
      this.stuckReturnFocus = false;
      trigger.focus();
    }
  });

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

  protected togglePlan(): void {
    this.applyPlanEvent('toggle');
  }

  /**
   * Escape, which belongs to whatever is open. The chooser first: it is the more recent thing the
   * learner raised, and closing the plan underneath it would leave six buttons over a screen the
   * learner has just asked to tidy up.
   */
  protected onEscape(): void {
    if (this.stuckOpen()) {
      this.dismissStuck();
      return;
    }
    this.dismissPlan();
  }

  /** Escape out of the chooser: focus goes back to the control that opened it, not into the void. */
  protected dismissStuck(): void {
    this.stuckReturnFocus = true;
    this.stuckOpen.set(false);
  }

  /** Escape. Focus goes back to the trigger so the keyboard is not left with nowhere to be. */
  protected dismissPlan(): void {
    if (!this.planOpen()) return;
    this.applyPlanEvent('escape');
    this.planTrigger()?.nativeElement.focus();
  }

  /**
   * A click anywhere outside the plan closes it. The click that opened it is inside `planRoot`,
   * so it is ignored here rather than immediately closing what it just opened.
   */
  protected onDocumentClick(event: MouseEvent): void {
    if (!this.planOpen()) return;
    const target = event.target as Node | null;
    if (target !== null && this.planRoot()?.nativeElement.contains(target) === true) return;
    this.applyPlanEvent('outside');
  }

  private applyPlanEvent(event: PlanEvent): void {
    this.planOpenState.update((isOpen) => nextPlanOpen(isOpen, event));
  }

  protected async startQuick(taskId: string): Promise<void> {
    await this.start(taskId, DEFAULT_FOCUS_MINUTES);
  }
  protected async start(taskId: string, minutes?: number): Promise<void> {
    // Starting a step uncovers it: the plan is not the learner's to tidy up first.
    this.applyPlanEvent('start');
    /*
     * The chooser belongs to the step it was opened on, so it goes with it. Left alone it is a question
     * about a step that is no longer on screen — and because it covers the trigger, the learner cannot
     * even ask about the new one.
     *
     * This is the only place the chooser is closed for a task change, and it is enough. Finishing a step
     * and ending a session both take the running-task branch away, so the chooser is unmounted by the
     * phase change; `start` is where that branch comes back. Closing it in those two as well looked
     * defensive and was worse than useless — the extra reset in `complete` made the e2e assertion below
     * pass while this line was deleted, so the guard the test was supposed to be covering was hidden by
     * a copy of itself that nothing needed.
     */
    this.stuckOpen.set(false);
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
    // The next step is previewed without the plan laid back over it.
    this.applyPlanEvent('finish');
    await this.state.dispatch('TASK_COMPLETED', { taskId });
    this.clearTimer();
    this.timer.set(createFocusTimer());
    this.completedView.set(true);
  }
  protected readonly STUCK_REASON_KEYS = STUCK_REASON_KEYS;
  protected readonly stuckReasons = STUCK_REASONS;
  protected readonly stuckOpen = signal(false);

  protected openStuck(): void {
    this.stuckOpen.set(true);
  }

  /**
   * Records why the learner says they are stuck, and asks for help.
   *
   * A reason of `null` means they would rather not say. That sends the same event this control sent
   * before the reasons existed, which is an answer rather than a cancellation — the policy falls
   * through to the state rules for it.
   *
   * The chooser closes first: the request is a thing that has happened, and leaving six buttons on
   * screen over the task afterwards would be the interruption the agent is meant to avoid.
   *
   * Focus goes back to the trigger, the same as on Escape, and for the same reason: the button that was
   * pressed is destroyed by the close, so without this the keyboard is left on the body — and the
   * learner who needs the suggestion most is the one who cannot reach it, because the rest of the page
   * now stands between them and "Show me". The suggestion itself is `role="status"`, so it is announced
   * whether or not it holds the focus; the trigger is simply the nearest stable place to stand.
   */
  protected async sayStuck(taskId: string, reason: StuckReason | null): Promise<void> {
    this.stuckReturnFocus = true;
    this.stuckOpen.set(false);
    await this.state.dispatch('HELP_REQUESTED', helpRequestPayload(taskId, reason));
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
    this.manageStuckFocus.destroy();
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
