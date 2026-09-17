import { Component, computed, inject } from '@angular/core';
import type { InterventionAction, LocalizedMessage } from '@focusloop/shared-types';
import { AppStateService } from '../core/app-state.service';
import { I18nService } from '../core/i18n/i18n.service';
import { ACTION_KEYS } from '../core/i18n/labels';

/**
 * Shows what the agent decided and why. The reason is always visible: an agent
 * the learner cannot understand is an agent they will not trust.
 */
@Component({
  selector: 'fl-agent-panel',
  standalone: true,
  template: `
    @if (decision(); as value) {
      @if (visible(value.action)) {
        <!-- The visible copy is translated; the raw action stays available. -->
        <aside class="agent" role="status" [attr.data-action]="value.action">
          <p class="eyebrow">{{ t('agent.suggesting', { action: copy(value.action) }) }}</p>
          <h3>{{ copy(value.action) }}</h3>
          <p class="muted small">{{ reason(value) }} · {{ minutes(value.estimatedMinutes) }}</p>
          <div class="agent__actions">
            <button type="button" class="btn btn--small btn--primary" (click)="accept()">
              {{ t('agent.showMe') }}
            </button>
            <button type="button" class="btn btn--small btn--ghost" (click)="dismiss()">
              {{ t('agent.notNow') }}
            </button>
          </div>
        </aside>
      }
    }
  `,
})
export class AgentPanelComponent {
  private readonly state = inject(AppStateService);
  private readonly i18n = inject(I18nService);

  protected readonly t = this.i18n.t;
  protected readonly decision = computed(() => this.state.decision());

  /**
   * RESUME has its own surface — the resume card. Showing it here as well would
   * ask the learner the same question twice.
   */
  protected visible(action: InterventionAction): boolean {
    return action !== 'NO_ACTION' && action !== 'RESUME';
  }

  protected copy(action: InterventionAction): string {
    return this.t(ACTION_KEYS[action]);
  }

  /** The policy's reason is a message descriptor; the renderer owns the words. */
  protected reason(value: { readonly reason: LocalizedMessage }): string {
    return this.i18n.translate(value.reason);
  }

  /** Templates cannot reach the global `String`, so the conversion lives here. */
  protected minutes(value: number): string {
    return this.t('course.minutes', { minutes: `${value}` });
  }

  protected accept(): void {
    void this.state.dismissIntervention(true);
  }

  protected dismiss(): void {
    void this.state.dismissIntervention(false);
  }
}
