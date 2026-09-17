import { Component, inject, signal } from '@angular/core';
import { AppStateService } from '../core/app-state.service';

/**
 * Screen 4 of 5. This is the product: it restores the learner's cognitive
 * position instead of asking them to remember where they were.
 */
@Component({
  selector: 'fl-resume-card',
  standalone: true,
  template: `
    @if (card(); as view) {
      <div class="overlay" role="dialog" aria-modal="true" aria-label="Resume where you left off">
        <div class="resume">
          <header class="resume__header">
            <p class="eyebrow">Welcome back</p>
            <h2>{{ view.card.title }}</h2>
            <p class="muted">{{ view.card.lastContext }}</p>
          </header>

          <div class="resume__grid">
            <section>
              <h3>Done</h3>
              @if (view.card.completed.length === 0) {
                <p class="muted">Nothing completed yet — that is fine.</p>
              } @else {
                <ul>
                  @for (item of view.card.completed; track item) {
                    <li>{{ item }}</li>
                  }
                </ul>
              }
            </section>

            <section>
              <h3>Still open</h3>
              @if (view.card.unresolved.length === 0) {
                <p class="muted">Nothing flagged.</p>
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
            <strong>Next step:</strong> {{ view.card.nextAction }}
            <span class="pill">{{ view.card.estimatedMinutes }} min</span>
          </p>

          <footer class="resume__actions">
            <button
              type="button"
              class="btn btn--primary"
              data-testid="resume-continue"
              (click)="continue()"
            >
              Continue
            </button>
            <button type="button" class="btn" (click)="toggleContext()">Show context</button>
            <button
              type="button"
              class="btn btn--ghost"
              data-testid="resume-dismiss"
              (click)="dismiss()"
            >
              Dismiss
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
  protected readonly card = this.state.resumeCard;
  protected readonly showContext = signal(false);

  protected continue(): void {
    void this.state.acceptResume();
  }

  protected dismiss(): void {
    void this.state.dismissResume();
  }

  protected toggleContext(): void {
    this.showContext.update((value) => !value);
  }

  protected contextText(): string {
    const view = this.card();
    if (view === null) return '';
    return [
      `checkpoint: ${view.timing.checkpointId}`,
      `shown at: ${view.timing.shownAt}`,
      `completed: ${view.card.completed.join(', ') || '—'}`,
      `unresolved: ${view.card.unresolved.join(', ') || '—'}`,
      `next: ${view.card.nextAction}`,
    ].join('\n');
  }
}
