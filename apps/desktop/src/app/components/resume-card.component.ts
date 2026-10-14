import { Component, computed, effect, inject, input, signal, viewChild } from '@angular/core';
import type { ElementRef, OnDestroy } from '@angular/core';
import type { ResumeCardView } from '@focusloop/shared-types';
import { AppStateService } from '../core/app-state.service';
import { I18nService } from '../core/i18n/i18n.service';
import type { MessageKey } from '../core/i18n/messages.en';
import { focusableWithin, nextIndex } from '../core/focus-trap';
import {
  answerTooLong,
  canCheckAnswer,
  canCheckQuiz,
  quizOptionMark,
  quizVerdictKey,
  stepAnswerView,
} from '../core/step-answer';

/**
 * Screen 4 of 5. This is the product: it restores the learner's cognitive
 * position instead of asking them to remember where they were.
 */
@Component({
  selector: 'fl-resume-card',
  standalone: true,
  template: `
    @if (card(); as view) {
      <div
        class="overlay"
        [attr.role]="inline() ? 'region' : 'dialog'"
        [attr.aria-modal]="inline() ? null : 'true'"
        [attr.aria-label]="t('resume.aria')"
        (keydown)="onKeydown($event)"
      >
        <!--
          The card is focusable so it can hold focus when it opens: the dialog is announced
          before its controls are reached, and focus is provably inside the aria-modal region
          rather than left on the page behind it.
        -->
        <div class="resume" #panel tabindex="-1">
          <header class="resume__header">
            <p class="eyebrow">{{ t('resume.welcome') }}</p>
            <h2>{{ title(view) }}</h2>
            <p class="muted">{{ context(view) }}</p>
          </header>

          @if (view.card.currentStep; as step) {
            <p class="resume__step" data-testid="resume-step">
              <strong>{{ t('resume.currentStep') }}</strong> {{ step }}
            </p>
          }

          @if (view.card.refresher; as refresher) {
            <p class="resume__refresher" data-testid="resume-refresher">
              {{ i18n.translate(refresher) }}
            </p>
          }

          <!--
            The check-in, and the only place a learner who has just come back can say what they
            remember before the app takes their word for it.

            **Not in the notice.** On the focus screen the step itself is right below the card and
            carries the same box and the same question; two identical fields on one screen would ask
            the learner to write their answer twice. Every other route has the card and no step, so
            this is where the interaction belongs — the same component, the same vocabulary, one
            place to write.

            A quiz step gets the question the course already holds, graded in the main process like
            every other quiz. Any other step gets the box, and what they write is recorded as their
            answer for the step — the TASK_ANSWERED event — whether or not they finish it now. That is
            the whole point: until this existed, prose written on the way into a question lived only in
            the tutor's in-memory transcript and an agent could never be shown it.
          -->
          @if (recall(); as step) {
            <section class="resume__recall step-answer" data-testid="resume-recall">
              @if (step.quiz; as quiz) {
                <h3>{{ t('resume.recall.title') }}</h3>
                <p class="step-answer__question" data-testid="recall-question">
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
                      [attr.data-testid]="'recall-option-' + $index"
                      [attr.data-mark]="optionMark($index)"
                      [class.is-chosen]="choice() === $index"
                      [attr.aria-pressed]="choice() === $index"
                      (click)="choose($index)"
                    >
                      {{ option }}
                    </button>
                  }
                </div>
                <div class="step-answer__actions">
                  <button
                    type="button"
                    class="btn btn--small btn--primary"
                    data-testid="recall-check"
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
                    data-testid="recall-verdict"
                  >
                    {{ t(quizVerdictKey(result.correct)) }}
                  </p>
                  <p class="muted" data-testid="recall-explanation">
                    {{ t('focus.quiz.why') }}: {{ result.explanation }}
                  </p>
                }
              } @else {
                <h3>{{ t('resume.recall.title') }}</h3>
                <!-- The box and its button on one line: on the card the box is a sentence or two, and a
                     button on its own row below it costs a row of the notice for nothing. -->
                <div class="step-answer__row">
                  <textarea
                    id="resume-recall"
                    class="step-answer__input"
                    rows="2"
                    [attr.maxlength]="step.maxCharacters"
                    [placeholder]="t('focus.answer.placeholder.recall')"
                    data-testid="recall-input"
                    [value]="answer()"
                    (input)="onAnswerInput($event)"
                  ></textarea>
                  <div class="step-answer__actions">
                    <button
                      type="button"
                      class="btn btn--small btn--primary"
                      data-testid="recall-record"
                      [disabled]="!recordable()"
                      (click)="record()"
                    >
                      {{ t('resume.recall.save') }}
                    </button>
                    <button
                      type="button"
                      class="btn btn--small btn--quiet"
                      data-testid="recall-attach"
                      (click)="attach()"
                    >
                      {{ t('focus.answer.attach') }}
                    </button>
                  </div>
                </div>
                @if (sourceNote(); as note) {
                  <!-- One slot, one line: the hint says what to do until a file has been read, and then
                       the note says what was read. -->
                  <p class="muted" role="status" data-testid="recall-source-note">
                    {{ t(note.key, note.params) }}
                  </p>
                } @else {
                  <p class="muted">{{ t('resume.recall.hint') }}</p>
                }
                @if (answerTooLong()) {
                  <p class="step-answer__error" role="alert" data-testid="recall-too-long">
                    {{ t('focus.answer.tooLong', { count: answerLimit() }) }}
                  </p>
                }
                @if (recorded()) {
                  <p class="muted" role="status" data-testid="recall-recorded">
                    {{ t('resume.recall.recorded') }}
                  </p>
                }
              }
            </section>
          }

          <div class="resume__grid">
            <section>
              <h3>{{ t('resume.done') }}</h3>
              @if (view.card.completed.length === 0) {
                <p class="muted">{{ t('resume.nothingDone') }}</p>
              } @else {
                <ul data-testid="resume-done">
                  @for (item of view.card.completed; track item) {
                    <li>{{ item }}</li>
                  }
                </ul>
              }
            </section>

            <section>
              <h3>{{ t('resume.open') }}</h3>
              @if (view.card.unresolved.length === 0) {
                <p class="muted">{{ t('resume.nothingOpen') }}</p>
              } @else {
                <ul data-testid="resume-open">
                  @for (item of view.card.unresolved; track item) {
                    <li>{{ item }}</li>
                  }
                </ul>
              }
            </section>
          </div>

          <!--
            Where you were, and the check-in.
            The next step stays even though the step below spells it out: after a MICRO_START or a
            SIMPLIFY the card's own estimate is the narrowed task's (AG5.6), and that number is what a
            learner plans the next few minutes around — the one thing on this card that must not be
            replaced by the step's own.
          -->
          <p class="resume__next">
            <strong>{{ t('resume.nextStep') }}</strong> {{ nextAction(view) }}
            <span class="pill">{{ minutes(view.card.estimatedMinutes) }}</span>
          </p>

          <footer class="resume__actions">
            <button
              type="button"
              class="btn btn--primary"
              data-testid="resume-continue"
              (click)="continue()"
            >
              {{ t('resume.continue') }}
            </button>
            <button
              type="button"
              class="btn btn--ghost"
              data-testid="resume-dismiss"
              (click)="dismiss()"
            >
              {{ t('resume.dismiss') }}
            </button>
          </footer>
        </div>
      </div>
    }
  `,
})
export class ResumeCardComponent implements OnDestroy {
  private readonly state = inject(AppStateService);
  protected readonly i18n = inject(I18nService);

  /** In the focus notice slot this is non-modal: no overlay, focus theft or Tab trap. */
  readonly inline = input(false);
  protected readonly t = this.i18n.t;
  protected readonly card = this.state.resumeCard;

  /**
   * The check-in: what the step the learner is coming back to asks for, or nothing.
   *
   * The same `stepAnswerView` the focus page uses, so the card, the notice and the step cannot drift
   * into asking different things. The quiz half is null for every step that does not ask a question,
   * which is what decides between the options and the box.
   */
  protected readonly recall = computed(() =>
    stepAnswerView(this.state.currentCourse(), this.state.currentTask()),
  );

  /* One box, three surfaces: the step, the notice above it, and this card. See `AppStateService`. */
  protected readonly answer = this.state.stepAnswer;
  protected readonly choice = this.state.stepChoice;
  protected readonly verdict = this.state.stepVerdict;
  /** Set once the learner's own words have landed in the log, which is what the line under the box says. */
  protected readonly recorded = signal(false);
  /** Where the last attached file's text came from, or why nothing came. */
  protected readonly sourceNote = this.state.answerSourceNote;

  protected readonly answerLimit = computed(() => {
    const view = this.recall();
    return view === null ? '' : `${view.maxCharacters}`;
  });

  protected readonly answerTooLong = computed(() => {
    const view = this.recall();
    return view !== null && answerTooLong(this.answer(), view.maxCharacters);
  });

  protected readonly recordable = computed(
    () => this.recall()?.quiz === null && canCheckAnswer(this.answer()) && !this.answerTooLong(),
  );

  protected readonly quizCheckable = computed(
    () => this.verdict() === null && canCheckQuiz(this.choice()),
  );

  private readonly panel = viewChild<ElementRef<HTMLElement>>('panel');

  /** Which card the box belongs to: one check-in per checkpoint, whatever else re-renders. */
  private readonly recallFor = computed(() => this.card()?.timing.checkpointId ?? null);

  /**
   * The recorded line belongs to the checkpoint it was written for.
   *
   * Keyed on the checkpoint and not on the card object, because the card is rebuilt on every snapshot
   * reload — answering a quiz reloads one — and a reset on identity would wipe the verdict in the same
   * frame that set it, and the learner's half-written sentence along with it. A later checkpoint is a
   * later step, so the shared box is cleared for it: the answer belongs to the step in front of the
   * learner, and leaving the previous one there would put their own words about something else under a
   * heading that names this step.
   */
  private readonly resetRecall = effect(() => {
    this.recallFor();
    this.recorded.set(false);
    this.state.clearStepAnswer();
  });

  /** What had focus before the card opened, so it can be handed back on close. */
  private returnFocusTo: HTMLElement | null = null;

  /**
   * `aria-modal="true"` is a promise that the rest of the page is inert. Claiming it without
   * moving focus in leaves a keyboard user on the page behind the overlay, unable to reach
   * the card's own buttons or to close it at all.
   */
  private readonly manageFocus = effect(() => {
    if (this.inline()) return;
    const panel = this.panel()?.nativeElement;

    if (this.card() !== null && panel !== undefined) {
      this.returnFocusTo ??= document.activeElement as HTMLElement | null;
      panel.focus();
      return;
    }

    if (this.card() === null && this.returnFocusTo !== null) {
      this.returnFocusTo.focus();
      this.returnFocusTo = null;
    }
  });

  ngOnDestroy(): void {
    this.manageFocus.destroy();
    this.resetRecall.destroy();
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (this.inline()) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      this.dismiss();
      return;
    }

    if (event.key !== 'Tab') return;

    const panel = this.panel()?.nativeElement;
    if (panel === undefined) return;

    // Tab stays inside. A Tab that escaped to the page behind the overlay is what made the
    // `aria-modal` claim false.
    const items = focusableWithin(panel);
    const target = nextIndex(
      items.indexOf(document.activeElement as HTMLElement),
      items.length,
      event.shiftKey,
    );
    if (target === -1) return;

    event.preventDefault();
    items[target]?.focus();
  }

  protected title(view: ResumeCardView): string {
    return this.i18n.translate(view.card.title);
  }

  protected context(view: ResumeCardView): string {
    return this.i18n.translate(view.card.lastContext);
  }

  protected nextAction(view: ResumeCardView): string {
    return this.i18n.translate(view.card.nextAction);
  }

  /** Templates cannot reach the global `String`, so the conversion lives here. */
  protected minutes(value: number): string {
    return this.t('resume.minutes', { minutes: `${value}` });
  }

  protected continue(): void {
    void this.resume();
  }

  protected dismiss(): void {
    void this.state.dismissResume();
  }

  protected onAnswerInput(event: Event): void {
    this.answer.set((event.target as HTMLTextAreaElement).value);
  }

  protected choose(index: number): void {
    this.choice.set(index);
    /*
     * A new choice invalidates the verdict it replaces: the mark belongs to the answer on screen, and
     * leaving "Right — that is the answer" up while the learner changes their mind about which option
     * is theirs would certify an answer they have already withdrawn. The same rule as the step's box.
     */
    this.verdict.set(null);
  }

  /** Which mark an option carries once there is a verdict: the one that was right, or the one chosen. */
  protected optionMark(index: number): 'none' | 'right' | 'wrong' {
    return quizOptionMark(this.verdict(), this.choice(), index);
  }

  protected quizVerdictKey(correct: boolean): MessageKey {
    return quizVerdictKey(correct);
  }

  /** Asks for a file and puts its text in the box, which is the same box the step below writes into. */
  protected attach(): void {
    void this.state.attachAnswerSource();
  }

  /**
   * Answers the step's quiz, through the same call the step's own screen uses.
   *
   * Graded in the main process, never here: the renderer is not given the key, and the verdict the
   * learner is shown is the same value that became their `QUIZ_CORRECT` or `QUIZ_INCORRECT` event. That
   * is why a wrong answer recorded on this card moves the learning state exactly as one answered on the
   * focus screen would — it is evidence about the same session, and it arrives in the same shape.
   */
  protected async checkQuiz(): Promise<void> {
    const taskId = this.state.currentTask()?.id;
    const index = this.choice();
    if (taskId === undefined || index === null) return;
    const response = await this.state.answerQuiz(taskId, index);
    if (response !== null) this.verdict.set(response.quiz);
  }

  /**
   * Records what the learner wrote, as their answer for the step.
   *
   * Awaited, so the line under the box is only shown once the words are actually in the log: this
   * product's promises are about what it kept, and a confirmation printed before the write is a
   * confirmation of nothing.
   */
  protected async record(): Promise<void> {
    if (!this.recordable()) return;
    this.recorded.set(await this.writeAnswer());
  }

  /**
   * Which is also why Continue writes first: an answer typed and then left behind by the button beside
   * it would be prose the learner produced and the app silently dropped. Pressing Continue with
   * something in the box records it, and pressing it with nothing in the box is the ordinary resume.
   */
  private async resume(): Promise<void> {
    if (this.recordable()) await this.writeAnswer();
    await this.state.acceptResume();
  }

  /** The write itself, reporting whether it landed. */
  private async writeAnswer(): Promise<boolean> {
    const taskId = this.state.currentTask()?.id;
    const text = this.answer().trim();
    if (taskId === undefined || text === '') return false;
    return (await this.state.dispatch('TASK_ANSWERED', { taskId, text })) !== null;
  }
}
