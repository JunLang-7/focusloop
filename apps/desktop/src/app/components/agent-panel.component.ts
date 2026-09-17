import { Component, computed, inject } from '@angular/core';
import { AppStateService } from '../core/app-state.service';

const ACTION_COPY: Record<string, string> = {
  MICRO_START: 'Start with the smallest possible step',
  SIMPLIFY: 'Simplify the current task',
  HINT: 'Here is a hint',
  EXAMPLE: 'Here is a worked example',
  QUESTION: 'Ask yourself',
  BREAK: 'Take a short break',
  RESUME: 'Resume where you left off',
};

/**
 * Shows what the agent decided and why. The reason is always visible: an agent
 * the learner cannot understand is an agent they will not trust.
 */
@Component({
  selector: 'fl-agent-panel',
  standalone: true,
  template: `
    @if (decision(); as value) {
      @if (value.action !== 'NO_ACTION') {
        <aside class="agent" role="status">
          <p class="eyebrow">Suggesting · {{ value.action }}</p>
          <h3>{{ copy(value.action) }}</h3>
          <p class="muted small">{{ value.reason }} · ~{{ value.estimatedMinutes }} min</p>
          <div class="agent__actions">
            <button type="button" class="btn btn--small btn--primary" (click)="accept()">
              Show me
            </button>
            <button type="button" class="btn btn--small btn--ghost" (click)="dismiss()">
              Not now
            </button>
          </div>
        </aside>
      }
    }
  `,
})
export class AgentPanelComponent {
  private readonly state = inject(AppStateService);
  protected readonly decision = computed(() => this.state.decision());

  protected copy(action: string): string {
    return ACTION_COPY[action] ?? action;
  }

  protected accept(): void {
    void this.state.dismissIntervention(true);
  }

  protected dismiss(): void {
    void this.state.dismissIntervention(false);
  }
}
