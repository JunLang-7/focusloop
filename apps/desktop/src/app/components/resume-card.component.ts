import { Component, effect, inject, signal, viewChild } from '@angular/core';
import type { ElementRef, OnDestroy } from '@angular/core';
import type { ResumeCardView } from '@focusloop/shared-types';
import { AppStateService } from '../core/app-state.service';
import { I18nService } from '../core/i18n/i18n.service';
import { focusableWithin, nextIndex } from '../core/focus-trap';

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
        role="dialog"
        aria-modal="true"
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

          <div class="resume__grid">
            <section>
              <h3>{{ t('resume.done') }}</h3>
              @if (view.card.completed.length === 0) {
                <p class="muted">{{ t('resume.nothingDone') }}</p>
              } @else {
                <ul>
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
                <ul>
                  @for (item of view.card.unresolved; track item) {
                    <li>{{ item }}</li>
                  }
                </ul>
              }
            </section>
          </div>

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
            <button type="button" class="btn" (click)="toggleContext()">
              {{ t('resume.showContext') }}
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

          @if (showContext()) {
            <pre class="resume__context">{{ contextText() }}</pre>
          }
        </div>
      </div>
    }
  `,
})
export class ResumeCardComponent implements OnDestroy {
  private readonly state = inject(AppStateService);
  private readonly i18n = inject(I18nService);

  protected readonly t = this.i18n.t;
  protected readonly card = this.state.resumeCard;
  protected readonly showContext = signal(false);

  private readonly panel = viewChild<ElementRef<HTMLElement>>('panel');

  /** What had focus before the card opened, so it can be handed back on close. */
  private returnFocusTo: HTMLElement | null = null;

  /**
   * `aria-modal="true"` is a promise that the rest of the page is inert. Claiming it without
   * moving focus in leaves a keyboard user on the page behind the overlay, unable to reach
   * the card's own buttons or to close it at all.
   */
  private readonly manageFocus = effect(() => {
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
  }

  protected onKeydown(event: KeyboardEvent): void {
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
    void this.state.acceptResume();
  }

  protected dismiss(): void {
    void this.state.dismissResume();
  }

  protected toggleContext(): void {
    this.showContext.update((value) => !value);
  }

  /**
   * The groundwork the card was built from. Diagnostic, not prose — the labels
   * are translated so it stays readable, but the values are shown raw.
   */
  protected contextText(): string {
    const view = this.card();
    if (view === null) return '';
    const empty = this.t('resume.context.empty');
    return [
      this.t('resume.context.checkpoint', { id: view.timing.checkpointId }),
      this.t('resume.context.shownAt', { at: view.timing.shownAt }),
      this.t('resume.context.completed', {
        items: view.card.completed.join(', ') || empty,
      }),
      this.t('resume.context.unresolved', {
        items: view.card.unresolved.join(', ') || empty,
      }),
      this.t('resume.context.next', { action: this.nextAction(view) }),
    ].join('\n');
  }
}
