import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import type { ElementRef, OnDestroy } from '@angular/core';
import type { AgentProposal } from '@focusloop/shared-types';
import { AppStateService } from '../core/app-state.service';
import { I18nService } from '../core/i18n/i18n.service';
import type { MessageKey } from '../core/i18n/messages.en';
import { focusableWithin, nextIndex } from '../core/focus-trap';
import {
  proposalDialogView,
  refusalMessageKey,
  type ProposalDialogView,
} from '../core/proposal-confirm';

/**
 * The confirmation screen for a structural proposal (#209).
 *
 * The dialog shows the proposal that arrived on the event push and offers exactly two ways out:
 * confirm — which binds to the hash on screen and then executes — or decline. For a preference,
 * decline is persisted on the proposal so the same claim does not reappear; generic proposals
 * retain their existing close-and-expire behaviour. Neither decline stores a preference. There is no
 * third path, because `executeProposal` refuses anything `confirmProposal` has not passed, and a
 * refusal (expired, state changed, hash mismatch) is shown as the reason it names rather than as a
 * generic failure.
 */
@Component({
  selector: 'fl-proposal-confirm',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (proposal(); as p) {
      <div
        class="overlay"
        role="dialog"
        aria-modal="true"
        [attr.aria-label]="t('proposal.confirm.title')"
        (keydown)="onKeydown($event)"
      >
        <!--
          The panel takes focus when it opens, so the dialog is announced before its controls and
          focus is provably inside the aria-modal region — the same promise the resume card keeps.
        -->
        <div class="confirm" #panel tabindex="-1" data-testid="proposal-confirm-dialog">
          <h2>{{ t('proposal.confirm.title') }}</h2>

          <p class="confirm__level" data-testid="proposal-level">{{ t(view(p).levelKey) }}</p>

          <p class="confirm__path">
            <span class="muted">{{ t('proposal.confirm.why') }}</span>
            <span data-testid="proposal-why">{{ view(p).why }}</span>
          </p>

          <p>{{ t('proposal.confirm.change') }}</p>
          <ul class="confirm__list" data-testid="proposal-change">
            @for (line of view(p).changeLines; track line) {
              <li>{{ line }}</li>
            }
          </ul>

          <!--
            A refusal stays on screen with the dialog that produced it: the learner asked a question
            and the answer is why it did not work, not that something failed.
          -->
          @if (refusal(); as key) {
            <p class="confirm__warning" role="alert" data-testid="proposal-refusal">{{ t(key) }}</p>
          }

          <footer class="confirm__actions">
            <button
              type="button"
              class="btn"
              data-testid="proposal-dismiss"
              [disabled]="working()"
              (click)="dismiss()"
            >
              {{ t('proposal.confirm.dismiss') }}
            </button>
            <button
              type="button"
              class="btn btn--primary"
              data-testid="proposal-confirm"
              [disabled]="working()"
              (click)="confirm()"
            >
              {{ t('proposal.confirm.apply') }}
            </button>
          </footer>
        </div>
      </div>
    }
  `,
})
export class ProposalConfirmComponent implements OnDestroy {
  private readonly state = inject(AppStateService);
  private readonly i18n = inject(I18nService);

  protected readonly t = this.i18n.t;
  protected readonly proposal = this.state.pendingProposal;
  protected readonly refusal = signal<MessageKey | null>(null);
  protected readonly working = signal(false);

  private readonly panel = viewChild<ElementRef<HTMLElement>>('panel');

  /** What had focus before the dialog opened, so it can be handed back when it closes. */
  private returnFocusTo: HTMLElement | null = null;

  private readonly manageFocus = effect(() => {
    const panel = this.panel()?.nativeElement;
    if (this.proposal() !== null && panel !== undefined) {
      this.returnFocusTo ??= document.activeElement as HTMLElement | null;
      panel.focus();
      return;
    }
    if (this.proposal() === null && this.returnFocusTo !== null) {
      this.returnFocusTo.focus();
      this.returnFocusTo = null;
      this.refusal.set(null);
    }
  });

  ngOnDestroy(): void {
    this.manageFocus.destroy();
  }

  /** The dialog's text for this proposal: a pure function, called like the resume card's title(). */
  protected view(proposal: AgentProposal): ProposalDialogView {
    return proposalDialogView(proposal);
  }

  /** Escape declines; Tab stays inside — the dialog has exactly two ways out and both stay reachable. */
  protected onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      void this.dismiss();
      return;
    }
    if (event.key !== 'Tab') return;

    const panel = this.panel()?.nativeElement;
    if (panel === undefined) return;

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

  protected async confirm(): Promise<void> {
    const proposal = this.proposal();
    if (proposal === null || this.working()) return;

    this.working.set(true);
    this.refusal.set(null);

    const confirmed = await this.state.confirmProposal(proposal);
    if (!confirmed.ok) {
      this.refusal.set(refusalMessageKey(confirmed));
      this.working.set(false);
      return;
    }

    const executed = await this.state.executeProposal(proposal);
    if (!executed.ok) {
      this.refusal.set(refusalMessageKey(executed));
      this.working.set(false);
      return;
    }

    this.state.pendingProposal.set(null);
    this.state.refreshAfterOwnAction();
    this.working.set(false);
  }

  /** A preference decline is a persisted decision, not a second storage path. */
  protected async dismiss(): Promise<void> {
    const proposal = this.proposal();
    if (this.working() || proposal === null) return;
    if ('preference' in proposal.payload) {
      this.working.set(true);
      try {
        const result = await this.state.declineProposal(proposal);
        if (!result.ok) {
          this.refusal.set(refusalMessageKey(result));
          return;
        }
      } finally {
        this.working.set(false);
      }
    }
    this.state.pendingProposal.set(null);
    this.state.refreshAfterOwnAction();
  }
}
