import { Component, inject } from '@angular/core';
import { AppStateService } from '../core/app-state.service';
import { I18nService } from '../core/i18n/i18n.service';

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
        <div class="simulator" role="group" [attr.aria-label]="t('sim.aria')">
          <span class="eyebrow">{{ t('sim.label') }}</span>
          <button
            type="button"
            class="btn btn--small"
            data-testid="sim-distraction"
            (click)="run('distraction')"
          >
            {{ t('sim.distraction') }}
          </button>
          <button
            type="button"
            class="btn btn--small"
            data-testid="sim-return"
            (click)="run('return')"
          >
            {{ t('sim.return') }}
          </button>
          <button
            type="button"
            class="btn btn--small"
            data-testid="sim-confusion"
            (click)="run('confusion')"
          >
            {{ t('sim.confusion') }}
          </button>
          <button
            type="button"
            class="btn btn--small"
            data-testid="sim-overload"
            (click)="run('overload')"
          >
            {{ t('sim.overload') }}
          </button>
          <button
            type="button"
            class="btn btn--small"
            data-testid="sim-success"
            (click)="run('success')"
          >
            {{ t('sim.success') }}
          </button>
        </div>
      }
    }
  `,
})
export class SimulatorBarComponent {
  private readonly state = inject(AppStateService);
  private readonly i18n = inject(I18nService);

  protected readonly t = this.i18n.t;
  protected readonly hasSession = this.state.hasSession;
  protected readonly enabled = () => this.state.runtime()?.simulatorEnabled ?? false;

  protected run(command: 'distraction' | 'return' | 'confusion' | 'overload' | 'success'): void {
    void this.state.simulate(command);
  }
}
