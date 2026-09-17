import { Component, inject } from '@angular/core';
import { AppStateService } from '../core/app-state.service';

/**
 * Demo Event Simulator (#22).
 *
 * A supported part of the product: it is the fallback that keeps the golden path
 * demonstrable without the browser extension. It is hidden in packaged builds.
 */
@Component({
  selector: 'fl-simulator-bar',
  standalone: true,
  template: `
    @if (enabled()) {
      @if (hasSession()) {
        <div class="simulator" role="group" aria-label="Demo event simulator">
          <span class="eyebrow">Simulator</span>
          <button
            type="button"
            class="btn btn--small"
            data-testid="sim-distraction"
            (click)="run('distraction')"
          >
            Distraction
          </button>
          <button
            type="button"
            class="btn btn--small"
            data-testid="sim-return"
            (click)="run('return')"
          >
            Return
          </button>
          <button
            type="button"
            class="btn btn--small"
            data-testid="sim-confusion"
            (click)="run('confusion')"
          >
            Confusion
          </button>
          <button
            type="button"
            class="btn btn--small"
            data-testid="sim-overload"
            (click)="run('overload')"
          >
            Overload
          </button>
          <button
            type="button"
            class="btn btn--small"
            data-testid="sim-success"
            (click)="run('success')"
          >
            Success
          </button>
        </div>
      }
    }
  `,
})
export class SimulatorBarComponent {
  private readonly state = inject(AppStateService);
  protected readonly hasSession = this.state.hasSession;
  protected readonly enabled = () => this.state.runtime()?.simulatorEnabled ?? false;

  protected run(command: 'distraction' | 'return' | 'confusion' | 'overload' | 'success'): void {
    void this.state.simulate(command);
  }
}
