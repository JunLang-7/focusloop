import { Component, computed, effect, inject, signal, viewChild } from '@angular/core';
import type { ElementRef } from '@angular/core';
import { AppStateService } from '../core/app-state.service';
import { I18nService } from '../core/i18n/i18n.service';
import { noticeIsFolded, selectFocusNotice } from '../core/focus-notice';
import { ResumeCardComponent } from './resume-card.component';

/**
 * The focus screen's one non-modal bottom slot: the "where you left off" card.
 *
 * It is the only thing allowed here. A strip pinned over the bottom of a screen somebody is working in is
 * an interruption, and the only moment that interruption buys more than it costs is the one where the
 * learner has come back from being away. Its own decisions — whether it is folded, and the card's — live
 * in `core/*.ts`, so they are falsifiable without a window.
 */
@Component({
  selector: 'fl-focus-notice',
  standalone: true,
  imports: [ResumeCardComponent],
  template: `
    @if (notice(); as kind) {
      <section
        class="focus-notice"
        data-testid="focus-notice"
        [attr.data-notice]="kind"
        [attr.data-folded]="folded()"
        [attr.aria-label]="t('focus.notice.aria')"
        (keydown.escape)="fold($event)"
        (click)="noteContentChange()"
      >
        <button
          type="button"
          class="focus-notice__toggle"
          data-testid="focus-notice-toggle"
          #toggle
          aria-controls="focus-notice-body"
          [attr.aria-expanded]="!folded()"
          (click)="setFolded(!folded())"
        >
          <span role="status">{{ t('resume.aria') }}</span>
          <span class="muted small">{{
            t(folded() ? 'focus.notice.show' : 'focus.notice.fold')
          }}</span>
        </button>
        @if (!folded()) {
          <div class="focus-notice__body" id="focus-notice-body" data-testid="focus-notice-body">
            <fl-resume-card [inline]="true" />
          </div>
        }
      </section>
    }
  `,
})
export class FocusNoticeComponent {
  private readonly state = inject(AppStateService);
  private readonly i18n = inject(I18nService);
  private readonly toggle = viewChild<ElementRef<HTMLButtonElement>>('toggle');
  protected readonly t = this.i18n.t;
  /** Bumped by any interaction inside the notice. */
  private readonly contentChanged = signal(0);
  /**
   * The resume card removes itself once its decision is made, so the element holding focus is gone.
   * This surface is deliberately non-modal, so nothing else holds the keyboard: it falls to `<body>`
   * and the next Tab restarts at the top of the document - the opposite of the reason this surface
   * exists. Focus is never taken on mount; only an interaction inside the notice re-checks where it
   * went.
   */
  private readonly keepKeyboard = effect(() => {
    // Nothing here runs before the first interaction, so merely appearing never steals focus.
    if (this.contentChanged() === 0) return;
    // Re-check whenever the slot's contents change as well: the card removes the element that had
    // focus in the same pass that runs this effect, so checking here would still see the doomed
    // element. A microtask runs after the view has settled.
    this.notice();
    queueMicrotask(() => this.reclaimKeyboard());
  });
  private reclaimKeyboard(): void {
    const toggle = this.toggle()?.nativeElement;
    if (toggle === undefined) return;
    const active = toggle.ownerDocument.activeElement;
    if (active === null || active === toggle.ownerDocument.body) toggle.focus();
  }
  protected noteContentChange(): void {
    this.contentChanged.update((count) => count + 1);
  }
  protected readonly notice = computed(() =>
    selectFocusNotice({ resume: this.state.resumeCard() !== null }),
  );
  protected readonly folded = computed(() =>
    noticeIsFolded(this.state.focusNoticeFold(), this.state.snapshot()?.session.id ?? null),
  );

  protected setFolded(folded: boolean): void {
    this.state.focusNoticeFold.set({
      sessionId: this.state.snapshot()?.session.id ?? null,
      folded,
    });
  }

  protected fold(event: Event): void {
    // Already folded: leave the key to the page, so an open stuck chooser or plan sheet can still
    // be closed from here instead of the notice swallowing the only way out.
    if (this.folded()) return;
    event.preventDefault();
    event.stopPropagation();
    this.setFolded(true);
    this.toggle()?.nativeElement.focus();
  }
}
