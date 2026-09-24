import { Component, computed, effect, inject, signal, viewChild } from '@angular/core';
import type { ElementRef } from '@angular/core';
import type { TutorMode } from '@focusloop/shared-types';
import { AppStateService } from '../core/app-state.service';
import { I18nService } from '../core/i18n/i18n.service';
import {
  TUTOR_MODE_KEYS,
  TUTOR_MODE_ORDER,
  buildTutorView,
  tutorAnswerApplies,
  tutorEntryVisible,
  tutorPlaceholderKey,
  tutorSourceLine,
} from '../core/tutor-view';

/**
 * "Ask about this step" (AG3 step three).
 *
 * The entry point, the six modes, the question, and the one screen that stands in when there is no answer.
 * The decisions behind all of it — whether the entry is offered, how a reply is labelled, what a refusal
 * looks like, and where the "not included" list comes from — live in `core/tutor-view.ts` so they are
 * falsifiable without a window; this file is the markup that calls them.
 */
@Component({
  selector: 'fl-tutor-panel',
  standalone: true,
  template: `
    @if (visible()) {
      <div class="tutor">
        <button
          type="button"
          class="btn btn--small btn--ghost"
          data-testid="tutor-entry"
          #entry
          [attr.aria-expanded]="open()"
          (click)="toggle()"
        >
          {{ t('tutor.entry') }}
        </button>

        @if (open()) {
          <section
            class="tutor__panel"
            role="dialog"
            data-testid="tutor-panel"
            [attr.aria-label]="t('tutor.title')"
            (keydown.escape)="onEscape($event)"
          >
            <div class="tutor__modes">
              @for (mode of modes; track mode) {
                <button
                  type="button"
                  class="btn btn--small"
                  [attr.data-testid]="'tutor-mode-' + mode"
                  [class.btn--primary]="chosen() === mode"
                  [attr.aria-pressed]="chosen() === mode"
                  [disabled]="asking()"
                  (click)="choose(mode)"
                >
                  {{ modeKey(mode) }}
                </button>
              }
            </div>

            <label class="muted small" for="tutor-question">{{ t(placeholderKey()) }}</label>
            <textarea
              id="tutor-question"
              class="tutor__input"
              data-testid="tutor-question"
              #questionInput
              rows="3"
              [value]="question()"
              (input)="onInput($event)"
            ></textarea>

            <div class="tutor__actions">
              <button
                type="button"
                class="btn btn--small btn--primary"
                data-testid="tutor-ask"
                [disabled]="!canAsk()"
                (click)="ask()"
              >
                {{ asking() ? t('tutor.asking') : t('tutor.ask') }}
              </button>
              <button
                type="button"
                class="btn btn--small btn--ghost"
                data-testid="tutor-close"
                (click)="close()"
              >
                {{ t('tutor.close') }}
              </button>
            </div>

            @if (view(); as result) {
              <div class="tutor__result" role="status" data-testid="tutor-result">
                @if (result.status === 'answered') {
                  <p class="eyebrow" data-testid="tutor-answer-mode">{{ modeKey(result.mode) }}</p>
                  @for (part of result.parts; track $index) {
                    <p class="eyebrow">{{ t(part.key) }}</p>
                    <p class="tutor__text">{{ part.text }}</p>
                  }
                  <p class="muted small">{{ sourceLine() }}</p>
                } @else {
                  <p class="eyebrow">{{ t('tutor.noAnswer') }}</p>
                  <p class="tutor__text">{{ t(result.reasonKey) }}</p>
                  @if (result.conceptTitle) {
                    <p class="muted small">{{ t('tutor.concept') }}: {{ result.conceptTitle }}</p>
                  }
                  @if (result.taskTitle) {
                    <p class="muted small">{{ t('tutor.step') }}: {{ result.taskTitle }}</p>
                  }
                  @if (result.instructions) {
                    <p class="muted small">
                      {{ t('tutor.instructions') }}: {{ result.instructions }}
                    </p>
                  }
                  @if (result.excerpt.text.length > 0) {
                    <p class="tutor__text tutor__text--source">{{ result.excerpt.text }}</p>
                  }
                }

                @if (result.leftOut.length > 0) {
                  <p class="muted small">{{ t('tutor.leftOut') }}: {{ leftOut(result.leftOut) }}</p>
                }
              </div>
            }
          </section>
        }
      </div>
    }
  `,
})
export class TutorPanelComponent {
  private readonly state = inject(AppStateService);
  private readonly i18n = inject(I18nService);

  protected readonly t = this.i18n.t;
  protected readonly modes = TUTOR_MODE_ORDER;

  private readonly openState = signal(false);
  protected readonly open = this.openState.asReadonly();
  protected readonly chosen = signal<TutorMode | null>(null);
  protected readonly question = signal('');

  /**
   * Whether *this panel* is waiting, which is not the app-wide `busy`.
   *
   * `state.busy()` is set by every operation the service runs — completing a task, ending a session,
   * importing material — so binding Ask to it made the button read "Asking…" while the learner was doing
   * nothing of the sort. This is set around this one call and nothing else.
   */
  private readonly pending = signal(false);
  protected readonly asking = this.pending.asReadonly();

  private readonly entryButton = viewChild<ElementRef<HTMLButtonElement>>('entry');
  private readonly questionInput = viewChild<ElementRef<HTMLTextAreaElement>>('questionInput');

  protected readonly visible = computed(() =>
    tutorEntryVisible(this.state.snapshot(), this.state.currentTask()?.id ?? null),
  );

  /**
   * The answer, but only while it is about the step on screen.
   *
   * The service keeps the last result so the three outcomes survive a re-render; the panel is what knows
   * which step it is anchored to, so whether the stored answer still applies is decided here, from the same
   * rule the end-to-end suite checks against the sibling control.
   */
  protected readonly view = computed(() => {
    const held = this.state.tutorAnswer();
    if (held === null) return null;
    if (!tutorAnswerApplies(held.taskId, this.state.currentTask()?.id ?? null)) return null;
    return buildTutorView(held.answer);
  });

  protected readonly sourceLine = computed(() => {
    const held = this.state.tutorAnswer();
    const source =
      held?.answer.outcome.status === 'answered' ? held.answer.outcome.reply.source : null;
    return tutorSourceLine(source, this.t);
  });

  protected readonly placeholderKey = computed(() => tutorPlaceholderKey(this.chosen()));

  constructor() {
    /*
     * The keyboard contract a `role="dialog"` promises, which this panel did not keep.
     *
     * Opening it moves focus into the box, closing it puts focus back on the button that opened it, and
     * Escape closes it. The stuck chooser does all three and has end-to-end coverage for them; this did
     * none, so Escape while the panel was open closed the *plan* underneath it instead — the failure the
     * ordering in `focus.page.ts` exists to prevent.
     */
    effect(() => {
      if (this.open()) this.questionInput()?.nativeElement.focus();
    });
  }

  /**
   * Whether Ask does anything.
   *
   * A mode **and** something in the box. Both are needed before the engine would answer, and a button that
   * can only ever produce a refusal should not be pressable — but **this does not make `no-question`
   * unreachable**. A message that is nothing but one of the format's own labels (`[hint]` on its own line)
   * passes a length check and sanitises to nothing in the domain, so the panel still has to render that
   * outcome. A renderer cannot mirror the sanitiser, which lives in `agent-core`; what it can do is not
   * send a message that is empty on its face.
   */
  protected readonly canAsk = computed(
    () => this.chosen() !== null && this.question().trim().length > 0 && !this.asking(),
  );

  /** The button's words, from the map the contract's vocabulary is keyed by. */
  protected modeKey(mode: TutorMode): string {
    return this.t(TUTOR_MODE_KEYS[mode]);
  }

  /**
   * Escape closes the panel — **when focus is inside it** — and stops there.
   *
   * The binding is on the section, so it fires for the learner who opened the panel with the keyboard and
   * is typing in the box, which is the case it exists for. Click somewhere else on the page and Escape does
   * nothing to the panel: reaching it from anywhere would need a document-level listener, and the page
   * already owns one for the plan card, so the two would have to be ordered against each other — which is
   * what the stuck chooser does inside `focus.page.ts`, and what this would have to do if it ever became a
   * modal rather than a popover. The end-to-end test pins both halves so this comment cannot drift.
   *
   * `stopPropagation` is the other half: the page's document listener for the plan card would otherwise fire
   * on the same press and close the plan behind an open panel.
   */
  protected onEscape(event: Event): void {
    event.stopPropagation();
    this.close();
  }

  protected toggle(): void {
    if (this.open()) this.close();
    else this.openState.set(true);
  }

  protected close(): void {
    this.openState.set(false);
    // Focus goes back where it came from, so a keyboard learner is not dropped at the top of the page.
    this.entryButton()?.nativeElement.focus();
  }

  protected choose(mode: TutorMode): void {
    this.chosen.set(mode);
  }

  /** Templates cannot reach the global `String`, so the conversion lives here. */
  protected onInput(event: Event): void {
    this.question.set((event.target as HTMLTextAreaElement).value);
  }

  protected leftOut(details: readonly string[]): string {
    return details.join('; ');
  }

  protected ask(): void {
    const mode = this.chosen();
    if (mode === null || !this.canAsk()) return;
    this.pending.set(true);
    void this.state.askTutor(mode, this.question().trim()).finally(() => this.pending.set(false));
  }
}
