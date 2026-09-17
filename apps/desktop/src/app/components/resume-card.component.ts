import { Component, inject, signal } from '@angular/core';
import type { ResumeCardView } from '@focusloop/shared-types';
import { AppStateService } from '../core/app-state.service';
import { I18nService } from '../core/i18n/i18n.service';

/**
 * Screen 4 of 5. This is the product: it restores the learner's cognitive
 * position instead of asking them to remember where they were.
 */
@Component({
  selector: 'fl-resume-card',
  standalone: true,
  template: `
    @if (card(); as view) {
      <div class="overlay" role="dialog" aria-modal="true" [attr.aria-label]="t('resume.aria')">
        <div class="resume">
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
export class ResumeCardComponent {
  private readonly state = inject(AppStateService);
  private readonly i18n = inject(I18nService);

  protected readonly t = this.i18n.t;
  protected readonly card = this.state.resumeCard;
  protected readonly showContext = signal(false);

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
