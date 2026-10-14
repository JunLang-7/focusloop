import {
  Component,
  ElementRef,
  afterRenderEffect,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
  viewChildren,
} from '@angular/core';
import type { OnDestroy, OnInit, Signal } from '@angular/core';
import { Router } from '@angular/router';
import type { MicroTask, MicroTaskKind, StuckReason } from '@focusloop/shared-types';
import { STUCK_REASONS, applyTaskOrder } from '@focusloop/shared-types';
import { AppStateService } from '../core/app-state.service';
import {
  DEFAULT_FOCUS_MINUTES,
  addMinute,
  createFocusTimer,
  pause as pauseTimer,
  reset as resetTimer,
  resume as resumeTimer,
  start as startTimer,
  tick as tickTimer,
} from '../core/focus-timer';
import { focusClockValue } from '../core/focus-clock-value';
import { I18nService } from '../core/i18n/i18n.service';
import { STATE_KEYS, STUCK_REASON_KEYS, kindLabel } from '../core/i18n/labels';
import { formatDuration } from '../core/format';
import { formatSpan } from '../core/insights-view';
import { KIND_GLYPHS, buildPlan } from '../core/session-plan';
import { keepsRail, type FocusPhase } from '../core/focus-phase';
import { FocusTimerService } from '../core/focus-timer.service';
import { PLAN_INITIAL_OPEN, nextPlanOpen, type PlanEvent } from '../core/plan-visibility';
import { reorder, sameOrder } from '../core/task-order';
import { helpRequestPayload } from '../core/stuck-picker';
import {
  answerTooLong,
  canCheckAnswer,
  canCheckQuiz,
  quizOptionMark,
  quizVerdictKey,
  stepAnswerView,
} from '../core/step-answer';
import type { MessageKey } from '../core/i18n/messages.en';
import { TutorPanelComponent } from '../components/tutor-panel.component';
import { FocusNoticeComponent } from '../components/focus-notice.component';
import { AgentPanelComponent } from '../components/agent-panel.component';

const CLOCK_RADIUS = 86;
const CLOCK_CIRCUMFERENCE = 2 * Math.PI * CLOCK_RADIUS;

/**
 * The clearance the notice keeps from whatever sits at the bottom of the stage.
 *
 * The plan trigger and its open sheet are controls the learner pressed, so the notice's top edge
 * cutting into a row of them reads as a broken control rather than as a cramped one. This is the
 * distance between the two boxes once the stage has been scrolled to lift the lower one clear.
 */
const NOTICE_GAP = 16;

/** Screen 3 of 5: a quiet, single-task focus workspace. */
@Component({
  selector: 'fl-focus',
  standalone: true,
  imports: [TutorPanelComponent, FocusNoticeComponent, AgentPanelComponent],
  /*
   * Both of these belong to the document rather than to this element. The plan panel is not a
   * modal, so by the time the learner changes their mind, focus may be anywhere on the page — and a
   * click that lands outside the panel never reaches it at all.
   */
  host: {
    '(document:keydown.escape)': 'onEscape($event)',
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
            <!--
              The ambient layer (#57), in the session's own row rather than beside the task.

              Two rules decide this. The research document's: sound never takes the task's level, so it
              is a quiet control and not a second primary. And #77's: the task box has a height contract
              against the notice's reserved row, so a control that is decoration must not be inside it —
              the first attempt was, and both the notice geometry and the tutor panel's placement said so.
            -->
            <button
              type="button"
              class="btn btn--quiet ambient-toggle"
              data-testid="ambient-toggle"
              [title]="t('focus.ambient.hint')"
              [class.is-active]="ambientSound()"
              [attr.aria-pressed]="ambientSound()"
              (click)="toggleAmbient()"
            >
              {{ t(ambientSound() ? 'focus.ambient.on' : 'focus.ambient.off') }}
            </button>
            <button type="button" class="btn btn--ghost" data-testid="end-session" (click)="end()">
              {{ t('focus.end') }}
            </button>
          </div>
        </header>

        <!--
          tabindex="-1": the stage is where the keyboard is handed back to when the notice's own decision
          unmounts the slot, which is the one thing that can remove the element holding focus without
          putting it anywhere else. Programmatically focusable, never in the tab order.
        -->
        <main class="focus-stage" #stage tabindex="-1">
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
                <!--
                  The agent has something to say in this phase too — an overloaded session is a fact about
                  the session and not about the step — so every phase's box carries the card, and the empty
                  case renders nothing at all. See the running step's copy for why it is here and not in the
                  bottom slot.
                -->
                <fl-agent-panel />
              </section>
            } @else {
              <section class="focus-task focus-task--empty">
                <p class="muted">{{ t('focus.allDone') }}</p>
                <!-- Every phase's box carries the card, including the one with nothing left to start. -->
                <fl-agent-panel />
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
              <fl-agent-panel />
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

                <!--
                  What the step asks the learner to produce, and the one place they can say it.

                  Without this the only thing a completion carried was the task id: the checkpoint's
                  "mastered" list, the quiz events the state machine listens for and everything a model
                  could be told about the session were all built on a button press. So a quiz step shows
                  its question and its options and is graded in the main process, and every other step
                  offers a box whose text travels with the completion and can be handed to the tutor.
                -->
                @if (answerView(); as step) {
                  <div class="step-answer" data-testid="step-answer">
                    @if (step.quiz; as quiz) {
                      <p class="eyebrow">{{ t('focus.quiz.title') }}</p>
                      <p class="step-answer__question" data-testid="quiz-question">
                        {{ quiz.question }}
                      </p>
                      <div
                        class="step-answer__options"
                        role="group"
                        [attr.aria-label]="t('focus.quiz.options')"
                      >
                        @for (option of quiz.options; track $index) {
                          <button
                            type="button"
                            class="btn step-answer__option"
                            [attr.data-testid]="'quiz-option-' + $index"
                            [attr.data-mark]="optionMark($index)"
                            [class.is-chosen]="choice() === $index"
                            [attr.aria-pressed]="choice() === $index"
                            (click)="chooseOption($index)"
                          >
                            {{ option }}
                          </button>
                        }
                      </div>
                      <div class="step-answer__actions">
                        <button
                          type="button"
                          class="btn btn--small btn--primary"
                          data-testid="quiz-check"
                          [disabled]="!quizCheckable()"
                          (click)="checkQuiz()"
                        >
                          {{ t('focus.quiz.check') }}
                        </button>
                      </div>
                      @if (verdict(); as result) {
                        <p
                          class="step-answer__verdict"
                          [attr.data-correct]="result.correct"
                          role="status"
                          data-testid="quiz-verdict"
                        >
                          {{ t(verdictKey(result.correct)) }}
                        </p>
                        <p class="muted small" data-testid="quiz-explanation">
                          {{ t('focus.quiz.why') }}: {{ result.explanation }}
                        </p>
                      }
                    } @else {
                      <label class="eyebrow" for="step-answer">
                        {{ t('focus.answer.title') }}
                      </label>
                      <!--
                        The box and its two buttons on one line: the button that asks the tutor and the one
                        that brings a file in both belong to the box, and a strip of its own under the box
                        cost a row of the task card for two controls that fit beside it.
                      -->
                      <div class="step-answer__row">
                        <textarea
                          id="step-answer"
                          class="step-answer__input"
                          rows="3"
                          [attr.maxlength]="step.maxCharacters"
                          [placeholder]="t(step.placeholderKey)"
                          data-testid="step-answer-input"
                          [value]="answer()"
                          (input)="onAnswerInput($event)"
                        ></textarea>
                        <div class="step-answer__actions">
                          <button
                            type="button"
                            class="btn btn--small"
                            data-testid="answer-check"
                            [disabled]="!answerCheckable()"
                            (click)="checkAnswer()"
                          >
                            {{ t('focus.answer.check') }}
                          </button>
                          <!--
                            Bring your own words with you. A learner who wrote the answer in Word, has the
                            PDF of their notes, or photographed a whiteboard should not retype any of it —
                            and all four readers run on this machine, with no model and no network.
                          -->
                          <button
                            type="button"
                            class="btn btn--small btn--quiet"
                            data-testid="answer-attach"
                            (click)="attachAnswer()"
                          >
                            {{ t('focus.answer.attach') }}
                          </button>
                        </div>
                      </div>
                      <!--
                        One line, always reserved: the explanation until a file has been read, then what was
                        read. Reading a file cannot move the box or the buttons beside it.
                      -->
                      @if (sourceNote(); as note) {
                        <p
                          class="muted small step-answer__hint step-answer__source"
                          role="status"
                          data-testid="answer-source-note"
                        >
                          {{ t(note.key, note.params) }}
                        </p>
                      } @else {
                        <p class="muted small step-answer__hint">
                          {{ t('focus.answer.hint') }}
                        </p>
                      }
                      @if (answerTooLong()) {
                        <p class="step-answer__error" role="alert" data-testid="answer-too-long">
                          {{ t('focus.answer.tooLong', { count: answerLimit() }) }}
                        </p>
                      }
                    }
                  </div>
                }
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
                <!--
                  The tutor sits beside the stuck control rather than inside it, because they answer
                  different questions: "why am I stuck" is a fact about the learner that the policy acts
                  on, and "what is this" is a question they asked. The panel decides whether it is offered
                  at all, from the session and the current task.
                -->
                <fl-tutor-panel />
                <!--
                  What the agent decided, in the row that asked for it.

                  It used to be a strip pinned over the bottom of the screen (the focus notice), with three
                  quick choices that were the stuck reasons over again. A suggestion about *this step*
                  belongs with the step: replied to where the question was asked, in the flow of the box
                  rather than over it, and it cannot cover the controls because it is one of them. The
                  nothing-to-say case renders nothing at all.
                -->
                <fl-agent-panel />
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
                  <!--
                    What the column is, said in words: one block per task, the estimate written on the
                    row. The number is read from the row rather than from the block's length, so the
                    line only has to name the two things the learner is looking at.
                  -->
                  <p class="focus-plan__legend" data-testid="plan-legend">
                    {{ t('focus.plan.legend') }}
                  </p>
                  <ul
                    class="plan focus-plan__timeline"
                    #planTrack
                    [style.height.px]="plan().height"
                    [attr.data-dragging]="dragging() === null ? null : ''"
                  >
                    @for (block of plan().blocks; track block.id; let index = $index) {
                      <li
                        class="plan__block focus-plan__block"
                        data-testid="plan-block"
                        [attr.data-kind]="block.kind"
                        [attr.data-dragging]="dragging() === block.id ? '' : null"
                        [attr.data-drop]="dropIndex() === index ? '' : null"
                        [style.top.px]="block.offset"
                        [style.height.px]="block.height"
                      >
                        <!--
                          One control for both paths: the grip is a button so the keyboard can reach it
                          and the pointer can take hold of it. Arrow keys move the row one place; the
                          pointer drags it. See gripKey and gripDown below.
                        -->
                        <button
                          type="button"
                          class="plan__grip"
                          data-testid="plan-grip"
                          #planGrip
                          aria-describedby="plan-grip-help"
                          [attr.data-task-id]="block.id"
                          [attr.aria-label]="gripLabel(block.title)"
                          (keydown)="gripKey($event, index)"
                          (pointerdown)="gripDown($event, index, block.id)"
                          (pointermove)="gripMove($event)"
                          (pointerup)="gripUp($event)"
                          (pointercancel)="gripCancel()"
                        ></button>
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
                  <!--
                    Both are off screen. The help is the grip's description rather than part of its
                    name, so a screen reader says "Reorder …" and can be asked for the rest. The status
                    is what makes a keyboard move audible: the row changes place, and nothing else on
                    the screen would say so.
                  -->
                  <p class="visually-hidden" id="plan-grip-help">{{ t('focus.plan.gripHelp') }}</p>
                  <p class="visually-hidden" role="status" data-testid="reorder-status">
                    {{ moved() }}
                  </p>
                }
              </div>
            }
          </section>
        </main>
        <fl-focus-notice #noticeRoot />
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
export class FocusPage implements OnDestroy, OnInit {
  private readonly state = inject(AppStateService);
  private readonly focusTimer = inject(FocusTimerService);
  private readonly router = inject(Router);
  private readonly i18n = inject(I18nService);
  private timerHandle: ReturnType<typeof setInterval> | null = null;
  private handledRescuePause = 0;
  private handledRescueContinue = 0;
  private readonly completedView = signal(false);
  private readonly planOpenState = signal(PLAN_INITIAL_OPEN);
  protected readonly planOpen = this.planOpenState.asReadonly();
  private readonly planRoot = viewChild<ElementRef<HTMLElement>>('planRoot');
  /** The track the blocks are laid out in, measured rather than reasoned about while dragging. */
  private readonly planTrack = viewChild<ElementRef<HTMLElement>>('planTrack');
  private readonly planTrigger = viewChild<ElementRef<HTMLButtonElement>>('planTrigger');
  /** Every row's grip, so the one that was moved can be found again by its task rather than by index. */
  private readonly gripRefs = viewChildren<ElementRef<HTMLButtonElement>>('planGrip');
  private readonly stuckTrigger = viewChild<ElementRef<HTMLButtonElement>>('stuckTrigger');
  private readonly stuckGroup = viewChild<ElementRef<HTMLElement>>('stuckGroup');
  /**
   * The bottom slot, which the stage has to stop short of.
   *
   * `read: ElementRef` rather than the plain template reference: on a component element the reference is
   * the component instance, so `nativeElement` was undefined and every measurement below returned without
   * doing anything — this slot is a component, where the plan's is a `<section>`. `read` is what decides
   * the type Angular hands back, hence the annotation rather than a type argument.
   */
  private readonly noticeRoot: Signal<ElementRef<HTMLElement> | undefined> = viewChild(
    'noticeRoot',
    { read: ElementRef },
  );
  /** Where the keyboard lands when the notice's decision unmounts the slot: see `handBackAfterNotice`. */
  private readonly stage = viewChild<ElementRef<HTMLElement>>('stage');
  /** Watching the bottom row's box, not its state: see `watchNoticeSize`. */
  private noticeObserver: ResizeObserver | null = null;

  protected readonly t = this.i18n.t;
  protected readonly snapshot = this.state.snapshot;
  protected readonly task = this.state.currentTask;
  protected readonly ambientSound = this.state.ambientSound;
  private readonly timer = this.focusTimer.state;
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

  /** A learner accepted a BREAK plan, so pause the local focus clock until Continue. */
  private readonly followRescueTimer = effect(() => {
    const pauseRequest = this.state.rescuePauseRequest();
    const continueRequest = this.state.rescueContinueRequest();
    if (pauseRequest > this.handledRescuePause) {
      this.handledRescuePause = pauseRequest;
      untracked(() => this.pause());
    }
    if (continueRequest > this.handledRescueContinue) {
      this.handledRescueContinue = continueRequest;
      untracked(() => this.resume());
    }
  });

  /** Keep the local commitment coherent when the lazy focus page is entered or rebuilt. */
  private readonly syncTimer = effect(() => {
    const snapshot = this.snapshot();
    untracked(() => {
      this.focusTimer.sync(snapshot?.session.id, snapshot?.session.currentTaskId, Date.now());
      if (this.focusTimer.state().phase === 'active' && this.timerHandle === null) {
        this.startInterval();
      } else if (this.focusTimer.state().phase !== 'active') {
        this.clearTimer();
      }
    });
  });

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
    return focusClockValue(this.timer(), this.phase(), this.task()?.estimatedMinutes ?? 0);
  }
  protected clockDashOffset(): number {
    return this.phase() === 'complete' ? 0 : CLOCK_CIRCUMFERENCE * (1 - this.timer().progress);
  }

  protected togglePlan(): void {
    this.applyPlanEvent('toggle');
  }

  /**
   * The row being dragged, from the moment the pointer takes hold of its grip.
   *
   * The whole drag lives in these three signals rather than in the DOM: `from` is fixed when the
   * pointer goes down (so the move is a single from/to pair, not a chain of nudges that could
   * accumulate), `dropIndex` is what the indicator draws, and `dragging` names the row to dim.
   */
  private readonly dragFrom = signal<number | null>(null);
  private readonly dragId = signal<string | null>(null);
  protected readonly dragging = this.dragId.asReadonly();
  protected readonly dropIndex = signal<number | null>(null);
  /** What the last move was, in words, for the live region. Empty until the first one. */
  protected readonly moved = signal('');
  /**
   * The row the keyboard is owed, for `restoreGripFocus` to honour after the next render.
   *
   * A sequence number rather than the id alone, so two moves of the same row are two requests: an
   * effect keyed on the value would not re-run for the second one, and a learner who pressed the key
   * twice would be left wherever the first render put them.
   */
  private readonly focusGripRequest = signal<{ taskId: string; seq: number } | null>(null);
  private focusGripSeq = 0;
  private handledFocusGripSeq = 0;

  protected gripLabel(title: string): string {
    return this.t('focus.plan.reorder', { title });
  }

  /**
   * Taking hold of a row.
   *
   * The capture is what makes the drag survive the pointer leaving the grip — and it is also why the
   * grip keeps the whole gesture: `pointerup` is delivered to the element that captured, wherever the
   * pointer happens to be, so the drop cannot land on a row that never saw the press.
   *
   * Focus is moved to the grip deliberately. Without it, a drag ends with focus wherever it was before
   * the press, and the keyboard half of this feature is unreachable from the row the learner just
   * moved. It is not `preventDefault`-ing the press, so a plain click still behaves like a click.
   */
  protected gripDown(event: PointerEvent, index: number, id: string): void {
    if (event.button !== 0) return;
    this.dragFrom.set(index);
    this.dragId.set(id);
    this.dropIndex.set(index);
    const grip = event.currentTarget;
    if (grip instanceof HTMLElement) {
      grip.setPointerCapture(event.pointerId);
      grip.focus();
    }
  }

  /**
   * Where the row would land.
   *
   * Measured against the rendered rows rather than accumulated from pointer deltas. That keeps the
   * target correct when the timeline itself is scrolled or when narrow layouts let titles wrap.
   */
  protected gripMove(event: PointerEvent): void {
    if (this.dragFrom() === null) return;
    const track = this.planTrack()?.nativeElement;
    if (track === undefined) return;
    const blocks = [...track.querySelectorAll<HTMLElement>('.focus-plan__block')];
    if (blocks.length === 0) return;
    const underPointer = blocks.findIndex((block) => {
      const bounds = block.getBoundingClientRect();
      return event.clientY >= bounds.top && event.clientY <= bounds.bottom;
    });
    if (underPointer >= 0) {
      this.dropIndex.set(underPointer);
      return;
    }
    const nearest = blocks.reduce(
      (best, block, index) => {
        const bounds = block.getBoundingClientRect();
        const distance = Math.abs(event.clientY - (bounds.top + bounds.height / 2));
        return distance < best.distance ? { index, distance } : best;
      },
      { index: 0, distance: Number.POSITIVE_INFINITY },
    );
    this.dropIndex.set(nearest.index);
  }

  /**
   * Letting go.
   *
   * The drop target is read before the drag state is cleared, because `dropIndex` is the only record
   * of it. A release on the row it started on is not a move, and `reorder` would return the same list
   * anyway — this returns early so that no event is written for a drag that changed nothing.
   */
  protected gripUp(event: PointerEvent): void {
    const from = this.dragFrom();
    const to = this.dropIndex();
    if (
      event.currentTarget instanceof HTMLElement &&
      event.currentTarget.hasPointerCapture(event.pointerId)
    ) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    this.gripCancel();
    if (from === null || to === null || to === from) return;
    void this.moveTask(from, to);
  }

  /** A cancelled drag — Escape, or the platform taking the pointer away — leaves the order alone. */
  protected gripCancel(): void {
    this.dragFrom.set(null);
    this.dragId.set(null);
    this.dropIndex.set(null);
  }

  /**
   * The keyboard half, on the grip itself.
   *
   * Arrow keys rather than buttons: two more controls per row would be four targets in a 34px block
   * and a tab stop each, and the row is already the thing being moved. `preventDefault` is only taken
   * when the key is one this handles, so Escape during a drag cancels the drag and Escape at rest
   * still closes the panel (`onEscape` checks `defaultPrevented`).
   *
   * Enter and Space move the row down, and with Shift up. A `<button>` that does nothing when it is
   * activated is a dead end for anyone whose interface is Tab-and-activate, and arrows alone assume a
   * keyboard: with a move in one direction any order is still reachable - you move the rows above it
   * down instead - so plain activation completes the path rather than half of it. Shift adds the other
   * direction for the people who already have the key under a finger.
   */
  protected gripKey(event: KeyboardEvent, index: number): void {
    if (event.key === 'Escape' && this.dragFrom() !== null) {
      event.preventDefault();
      this.gripCancel();
      return;
    }
    const activation = event.key === 'Enter' || event.key === ' ' ? 1 : 0;
    const step =
      event.key === 'ArrowUp'
        ? -1
        : event.key === 'ArrowDown'
          ? 1
          : activation === 0
            ? 0
            : event.shiftKey
              ? -1
              : 1;
    if (step === 0) return;
    event.preventDefault();
    void this.moveTask(index, index + step);
  }

  /**
   * Records the new order and leaves everything else alone.
   *
   * Not a `TASK_STARTED` and not a state change: what the learner did is say which task they mean to
   * do first, and the running task is untouched — including when the row they moved was pointed at the
   * one they are on.
   */
  private async moveTask(from: number, to: number): Promise<void> {
    const tasks = this.openTasks();
    const order = tasks.map((task) => task.id);
    const next = reorder(order, from, to);
    if (next === order) return;

    /*
     * A type guard rather than a runtime one: `reorder` returns the list unchanged unless `from` is a
     * valid index, so by this line `tasks[from]` is always there. It is written out because the
     * alternative is a `!`, and that would become a lie the moment the contract changed.
     */
    const task = tasks[from];
    if (task === undefined) return;

    await this.state.dispatch('TASKS_REORDERED', { order: next });
    /*
     * Asked of the session, not of the call's resolution. `AppStateService.run` catches a failed IPC
     * call and reports it in the banner, so a rejected write resolves normally - announcing it here
     * would describe a move that never landed, and moving the keyboard would put it on a row that is
     * not where the learner is looking. Reading the order back is also the only check that covers the
     * write landing while its response was lost.
     */
    if (!sameOrder(next, this.snapshot()?.session.taskOrder)) return;
    this.moved.set(
      this.t('focus.plan.moved', {
        title: task.title,
        position: String(to + 1),
        total: String(next.length),
      }),
    );
    this.focusGripSeq += 1;
    this.focusGripRequest.set({ taskId: task.id, seq: this.focusGripSeq });
  }

  /**
   * Puts the keyboard back on the row that was just moved.
   *
   * It does not stay there by itself, and the difference matters: `@for` re-inserts the moved row
   * rather than recreating it, and Chromium drops focus when a focused node is re-inserted. This was
   * measured rather than assumed - the e2e assertion that the grip was still focused failed with
   * "inactive" until this existed. Without it a keyboard user loses their place on every move, and the
   * second move needs the mouse they were avoiding.
   *
   * An `afterRenderEffect`, not an `effect`, and the difference is the whole reason this works: it is
   * invoked when the application finishes rendering, so the rows are in their new order by the time the
   * grip is looked up. An `effect` runs during change detection, which is before the render - it worked
   * on this machine and lost the focus on the macOS runner, where the focused row was re-inserted
   * *after* the focus had been given. That is the kind of timing argument this does not have to win:
   * the phase is the framework's contract rather than something inferred from a measurement. The
   * lookup is by task id rather than by position, because the position is the thing that just changed,
   * and the sequence number is what makes a second move of the same row a second request.
   */
  private readonly restoreGripFocus = afterRenderEffect(() => {
    const request = this.focusGripRequest();
    if (request === null || request.seq <= this.handledFocusGripSeq) return;
    this.handledFocusGripSeq = request.seq;
    untracked(() => {
      const grip = this.gripRefs().find(
        (ref) => ref.nativeElement.dataset['taskId'] === request.taskId,
      );
      grip?.nativeElement.focus();
    });
  });

  /**
   * Escape, which belongs to whatever is open. The chooser first: it is the more recent thing the
   * learner raised, and closing the plan underneath it would leave six buttons over a screen the
   * learner has just asked to tidy up.
   */
  protected onEscape(event: Event): void {
    if (event.defaultPrevented) return;
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

  private readonly onWindowResize = (): void => {
    // The notice's own height does not change with the window, but the room it takes from the stage
    // does, so the same check runs again.
    this.liftStepClearOfNotice();
  };

  /**
   * Keeps the step clear of the notice row, scrolling only the stage when that row is present.
   *
   * Observed rather than run on the slot's own changes, because what matters is the row's *height*, and
   * the row is filled in passes: the decision, its sentence, its buttons and its fold each arrive on their
   * own, so the first frame that has a notice in it is usually a notice that is still zero pixels tall.
   * Measured then, the intersection is negative, nothing moves, and the height the learner actually ends
   * up looking at is never measured at all. A resize observer is the version of this that cannot miss it.
   */
  private readonly watchNoticeSize = afterRenderEffect(() => {
    const element = this.noticeRoot()?.nativeElement ?? null;
    if (element === null) return;
    untracked(() => {
      if (this.noticeObserver === null) {
        this.noticeObserver = new ResizeObserver(() => this.liftStepClearOfNotice());
      }
      this.noticeObserver.disconnect();
      this.noticeObserver.observe(element);
      this.liftStepClearOfNotice();
    });
  });

  /**
   * Where the keyboard goes when the notice's own decision empties the slot.
   *
   * The slot's decision is destroying its last control: the card's Continue button is what had focus, and
   * the whole notice unmounts behind it — so the notice's own `reclaimKeyboard` has nothing left to put
   * focus on, and without this the learner's keyboard is on `<body>` and the next Tab restarts at the top
   * of the document. It used to be masked: answering the card fell through to the agent's offer, so the
   * slot stayed mounted and kept the focus. The stage is the landmark that is always there, and it carries
   * the running step's name.
   *
   * Only when the keyboard is actually orphaned, and only on the falling edge: a learner who moved focus
   * into the step themselves keeps it, and arriving on the screen with no notice never moves anything.
   */
  private noticeWasUp = false;
  private readonly handBackAfterNotice = effect(() => {
    if (this.state.resumeCard() !== null) {
      this.noticeWasUp = true;
      return;
    }
    if (!this.noticeWasUp) return;
    this.noticeWasUp = false;
    queueMicrotask(() => {
      const active = document.activeElement;
      if (active !== null && active !== document.body) return;
      this.stage()?.nativeElement.focus();
    });
  });

  /**
   * Lifts the stage's floor clear of the notice row, scrolling only the stage when that row is present.
   *
   * The floor is the plan — its open sheet when the learner has it open, its trigger otherwise — rather
   * than the step. The step is above the plan, so clearing the plan clears the step too; measuring only the
   * step was true while the plan never shared the screen with the notice, and opening the sheet under one
   * put every row of it behind the notice, so the tap looked like it had done nothing.
   *
   * It stays put when the floor already clears with `NOTICE_GAP`: a tall window is not thrown up the screen
   * for nothing, a run that finds nothing covered changes nothing, and once the floor is clear the
   * intersection is negative, so the next frame's measurement moves nothing.
   */
  private liftStepClearOfNotice(): void {
    const notice = this.noticeRoot()?.nativeElement;
    const stage = this.stage()?.nativeElement ?? null;
    const plan = this.planRoot()?.nativeElement;
    if (notice === undefined || stage === null || plan === undefined) return;
    const panel = plan.querySelector<HTMLElement>('.focus-plan__panel');
    const floor = panel ?? plan;
    const covered =
      floor.getBoundingClientRect().bottom + NOTICE_GAP - notice.getBoundingClientRect().top;
    if (covered <= 0) return;
    /*
     * With the sheet closed the plan trigger is the floor, and the step's title is what must not be spent
     * to clear it: on a window shorter than the app's own minimum the two cannot both have the room, and a
     * control the learner has not asked for yet can wait for a scroll while the title cannot. With the sheet
     * open the learner *did* ask for the plan, so the cap comes off and the step is free to leave the screen.
     */
    const step = panel === null ? stage.querySelector<HTMLElement>('.focus-task') : null;
    const title = step?.querySelector<HTMLElement>('[data-testid="task-title"]') ?? null;
    const headroom =
      title === null
        ? covered
        : title.getBoundingClientRect().top - stage.getBoundingClientRect().top;
    const lift = Math.min(covered, Math.max(0, headroom));
    if (lift > 0) stage.scrollTop += lift;
  }

  /**
   * Opening or closing the plan moves the stage's floor, and the notice's own height does not change.
   *
   * The resize observer above only watches the notice's box, so it cannot see the sheet arrive underneath
   * it; without this the rows landed behind the notice and the learner had to scroll a scroller they did
   * not know was there to read what they had just opened. Only while a notice is up: with the bottom row
   * empty there is nothing to clear and the plan lays itself out as it always did.
   */
  private readonly watchPlanForNotice = afterRenderEffect(() => {
    // Tracked: the open/closed state is the change this effect exists for.
    const open = this.planOpen();
    untracked(() => {
      if (this.noticeRoot()?.nativeElement === undefined) return;
      if (open) {
        this.liftStepClearOfNotice();
      } else {
        this.revealStepAfterPlan();
      }
    });
  });

  /**
   * Goes back to the step when the sheet closes over a notice.
   *
   * Opening the sheet scrolls the stage to bring its rows out from under the notice, which on a short
   * window is a long way up; staying there would leave the learner looking at the bottom of a step whose
   * title they cannot see. The step's top is where they were reading, so that is what the close puts back.
   * The lift runs afterwards because a step taller than the stage is one the step itself still has to
   * yield on, and the plan's own floor is what decides how far.
   */
  private revealStepAfterPlan(): void {
    const stage = this.stage()?.nativeElement;
    if (stage === undefined) return;
    const step = stage.querySelector<HTMLElement>('.focus-task');
    if (step === null) return;
    stage.scrollTop += step.getBoundingClientRect().top - stage.getBoundingClientRect().top;
    this.liftStepClearOfNotice();
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
    const sessionId = this.snapshot()?.session.id;
    if (sessionId === undefined) return;
    const now = Date.now();
    // Claim the timer's owner before starting it. A pending snapshot effect may
    // otherwise see a new task and reset an already-running clock to "ready".
    this.focusTimer.sync(sessionId, taskId, now);
    const task = this.findTask(taskId);
    this.completedView.set(false);
    // The box, the chosen option and the verdict belong to the step they were made on.
    this.clearStepAnswer();
    this.focusTimer.set(
      startTimer(resetTimer(minutes ?? Math.max(1, task?.estimatedMinutes ?? 1)), now),
    );
    this.startInterval();
  }
  protected pause(): void {
    this.focusTimer.update((value) => pauseTimer(value, Date.now()));
    this.clearTimer();
  }
  protected resume(): void {
    if (this.timer().phase === 'expired') {
      this.addMinuteToTimer();
      return;
    }
    this.focusTimer.update((value) => resumeTimer(value, Date.now()));
    this.startInterval();
  }
  protected addMinuteToTimer(): void {
    this.focusTimer.update((value) => addMinute(value, Date.now()));
    this.startInterval();
  }
  protected async complete(taskId: string): Promise<void> {
    // The next step is previewed without the plan laid back over it.
    this.applyPlanEvent('finish');
    /*
     * The learner's own words go with the completion when there are any, and the field is left out
     * entirely when there are not: "they finished it and said nothing" and "they wrote nothing" are the
     * same fact, and the engine keeps them as one by dropping a blank answer rather than storing it.
     *
     * The box is cleared with the step. A conversation left in the field would be carried onto the next
     * step by whoever forgets to clear it — and the answer belongs to the step it was written for.
     */
    const answer = this.answer().trim();
    await this.state.dispatch('TASK_COMPLETED', {
      taskId,
      ...(answer === '' ? {} : { answer }),
    });
    this.clearStepAnswer();
    this.clearTimer();
    this.focusTimer.set(createFocusTimer());
    this.completedView.set(true);
  }

  /**
   * The step's answer box and quiz, read from the course the step came out of.
   *
   * `null` while nothing is running, and the quiz half is null for every step that does not ask a
   * question — `stepAnswerView` is what decides that, and what keeps the key to the answer out of the
   * renderer's hands.
   */
  protected readonly answerView = computed(() =>
    stepAnswerView(this.state.currentCourse(), this.task()),
  );

  protected readonly answer = this.state.stepAnswer;
  protected readonly choice = this.state.stepChoice;
  protected readonly verdict = this.state.stepVerdict;
  /** Where the last attached file's text came from, or why nothing came. */
  protected readonly sourceNote = this.state.answerSourceNote;

  protected readonly answerTooLong = computed(() => {
    const view = this.answerView();
    return view !== null && answerTooLong(this.answer(), view.maxCharacters);
  });

  /** The bound as text, for the one line that names it — the template cannot interpolate one itself. */
  protected readonly answerLimit = computed(() => {
    const view = this.answerView();
    return view === null ? '' : `${view.maxCharacters}`;
  });

  /**
   * What the tutor is asked about, which is the text in the box and nothing else.
   *
   * `CHECK_MY_ANSWER` is the mode that quotes the learner's own words back at them, so the box and the
   * mode belong together: the step's button asks the tutor to check *this*, rather than asking a
   * question about the step in general.
   */
  protected readonly answerCheckable = computed(
    () =>
      this.answerView()?.quiz === null && canCheckAnswer(this.answer()) && !this.answerTooLong(),
  );

  protected readonly quizCheckable = computed(
    () => this.verdict() === null && canCheckQuiz(this.choice()),
  );

  protected onAnswerInput(event: Event): void {
    this.answer.set((event.target as HTMLTextAreaElement).value);
  }

  protected chooseOption(index: number): void {
    this.choice.set(index);
    // A new choice invalidates the verdict it replaces: the marks belong to the answer on screen.
    this.verdict.set(null);
  }

  /** Which mark an option carries once there is a verdict: the one that was right, or the one chosen. */
  protected optionMark(index: number): 'right' | 'wrong' | 'none' {
    return quizOptionMark(this.verdict(), this.choice(), index);
  }

  protected verdictKey(correct: boolean): MessageKey {
    return quizVerdictKey(correct);
  }

  /**
   * Sends the chosen option to the main process, which is the only thing that knows the answer.
   *
   * A refusal (the engine's `quiz-not-answerable`, or a bridge failure) leaves the step exactly as it
   * was: no verdict is set, so the button stays pressable and the learner can try again. The error
   * itself is the service's business — it is already in the banner.
   */
  protected async checkQuiz(): Promise<void> {
    const task = this.task();
    const index = this.choice();
    if (task === null || index === null || !this.quizCheckable()) return;
    const response = await this.state.answerQuiz(task.id, index);
    if (response !== null) this.verdict.set(response.quiz);
  }

  /**
   * Hands the answer to the tutor, and records it first.
   *
   * The write comes first because the tutor's transcript is in memory in the main process and nothing
   * recovers value from it after the session ends: a learner who wrote a paragraph, asked for it to be
   * checked and then pressed Continue left the app knowing only that it had been asked. Recording
   * `TASK_ANSWERED` before the ask means the words are in the log — and in everything the agent is
   * shown — whether or not the exchange is ever finished or the step is ever marked done.
   *
   * Not awaited by the panel: the tutor call is the learner's own action and it should not wait on a
   * bookkeeping write. `requestTutorCheck` is what opens the box, and it does so in the same frame.
   */
  protected checkAnswer(): void {
    if (!this.answerCheckable()) return;
    const task = this.task();
    const text = this.answer().trim();
    if (task !== null) void this.state.dispatch('TASK_ANSWERED', { taskId: task.id, text });
    this.state.requestTutorCheck('CHECK_MY_ANSWER', text);
  }

  /**
   * Asks for a file and puts its text in the box, for the learner to edit and then send.
   *
   * The words land in the same box the keyboard writes into, rather than being sent anywhere directly: a
   * photograph is recognised by an engine that can be wrong, and the only way for the learner to notice
   * is to see the text before it is used.
   */
  protected attachAnswer(): void {
    void this.state.attachAnswerSource();
  }

  /** The box and its verdict belong to one step: nothing of them survives starting another. */
  private clearStepAnswer(): void {
    this.state.clearStepAnswer();
  }
  /**
   * The learner's own call, like the material text: the layer is offered rather than assumed, and
   * turning it on does not make it start on its own the next time the app opens.
   */
  protected toggleAmbient(): void {
    void this.state.setAmbientSound(!this.ambientSound());
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

  ngOnInit(): void {
    // Recheck the notice overlap after a resize; its measured height stays the same, but the stage room changes.
    window.addEventListener('resize', this.onWindowResize);
  }

  ngOnDestroy(): void {
    this.clearTimer();
    this.followRescueTimer.destroy();
    this.syncTimer.destroy();
    this.manageStuckFocus.destroy();
    this.restoreGripFocus.destroy();
    this.watchNoticeSize.destroy();
    this.handBackAfterNotice.destroy();
    this.noticeObserver?.disconnect();
    window.removeEventListener('resize', this.onWindowResize);
  }

  protected openTasks(): readonly MicroTask[] {
    const course = this.state.currentCourse();
    const snapshot = this.snapshot();
    if (course === null || snapshot === null) return [];
    const done = new Set(snapshot.session.completedTaskIds);
    const remaining = course.microTasks.filter(
      (item) => !done.has(item.id) && item.id !== snapshot.session.currentTaskId,
    );
    /*
     * The learner's order is applied last, and only to what survives the filter above. A task they have
     * finished is not in the list to be placed, and the running one is not there to be moved - which is
     * how "reordering does not change which task is current" holds without anyone having to check for
     * it (#23).
     */
    return applyTaskOrder(remaining, snapshot.session.taskOrder ?? []);
  }
  private findTask(taskId: string): MicroTask | null {
    return this.state.currentCourse()?.microTasks.find((item) => item.id === taskId) ?? null;
  }
  private startInterval(): void {
    this.clearTimer();
    this.timerHandle = setInterval(
      () => this.focusTimer.update((value) => tickTimer(value, Date.now())),
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
