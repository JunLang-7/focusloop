import {
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import type { ElementRef } from '@angular/core';
import { AppStateService } from '../core/app-state.service';
import { I18nService } from '../core/i18n/i18n.service';
import { noticeIsFolded, selectFocusNotice } from '../core/focus-notice';
import { AgentPanelComponent } from './agent-panel.component';
import { ResumeCardComponent } from './resume-card.component';

/** One non-modal, bottom-anchored slot. The domain still owns every underlying choice. */
@Component({
  selector: 'fl-focus-notice',
  standalone: true,
  imports: [AgentPanelComponent, ResumeCardComponent],
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
          <span role="status">{{ t(titleKey()) }}</span>
          <span class="muted small">{{
            t(folded() ? 'focus.notice.show' : 'focus.notice.fold')
          }}</span>
        </button>
        @if (!folded()) {
          <div class="focus-notice__body" id="focus-notice-body" data-testid="focus-notice-body">
            @switch (kind) {
              @case ('resume') {
                <fl-resume-card [inline]="true" />
              }
              @case ('help') {
                <fl-agent-panel [inline]="true" [attr.inert]="pending() ? '' : null" />
                @if (offered()) {
                  <div
                    class="focus-notice__choices"
                    role="group"
                    [attr.aria-label]="t('focus.notice.choices')"
                  >
                    <button
                      type="button"
                      class="btn btn--small"
                      data-testid="notice-continue"
                      [disabled]="pending() || !taskId()"
                      (click)="choose('cannot-start')"
                    >
                      {{ t('focus.resume') }}
                    </button>
                    <button
                      type="button"
                      class="btn btn--small"
                      data-testid="notice-simplify"
                      [disabled]="pending() || !taskId()"
                      (click)="choose('too-big')"
                    >
                      {{ t('focus.notice.simplify') }}
                    </button>
                    <button
                      type="button"
                      class="btn btn--small"
                      data-testid="notice-break"
                      [disabled]="pending() || !taskId()"
                      (click)="choose('tired')"
                    >
                      {{ t('focus.notice.break') }}
                    </button>
                  </div>
                }
              }
              @case ('time-up') {
                <p class="muted" role="status">{{ t('focus.notice.timeUpBody') }}</p>
                <button
                  type="button"
                  class="btn btn--small btn--primary"
                  data-testid="notice-add-minute"
                  (click)="continueTimer.emit()"
                >
                  {{ t('focus.addMinute') }}
                </button>
              }
            }
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
  readonly expired = input(false);
  readonly continueTimer = output<void>();
  protected readonly t = this.i18n.t;
  protected readonly pending = signal(false);
  /** Bumped by any interaction inside the notice, and by a choice that settled. */
  private readonly contentChanged = signal(0);
  /**
   * A choice row disappears once its offer is accepted, and the resume card removes itself on
   * Continue, so the element holding focus is gone. This surface is deliberately non-modal, so
   * nothing else holds the keyboard: it falls to `<body>` and the next Tab restarts at the top of
   * the document - the opposite of the reason this surface exists. Focus is never taken on mount;
   * only an interaction inside the notice, or a choice settling, re-checks where it went.
   */
  private readonly keepKeyboard = effect(() => {
    // Nothing here runs before the first interaction, so merely appearing never steals focus.
    if (this.contentChanged() === 0) return;
    // Re-check whenever the slot's contents change as well: a choice row and the resume card both
    // remove the element that had focus, in the same pass that runs this effect, so checking here
    // would still see the doomed element. A microtask runs after the view has settled.
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
  protected readonly taskId = computed(() => this.state.snapshot()?.session.currentTaskId);
  protected readonly notice = computed(() =>
    selectFocusNotice({
      resume: this.state.resumeCard() !== null,
      rescue: this.state.rescue() !== null,
      action: this.state.decision()?.action ?? null,
      expired: this.expired(),
    }),
  );
  protected readonly offered = computed(() => this.state.rescue()?.phase !== 'active');
  protected readonly folded = computed(() =>
    noticeIsFolded(this.state.focusNoticeFold(), this.state.snapshot()?.session.id ?? null),
  );
  protected readonly titleKey = computed(() => {
    switch (this.notice()) {
      case 'resume':
        return 'resume.aria' as const;
      case 'help':
        return 'focus.notice.help' as const;
      default:
        return 'focus.timeUp' as const;
    }
  });

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

  /**
   * New explicit requests use the existing policy/IPC/lifecycle, not a second action
   * system. First resolve the superseded offer. Only accept the response to this
   * request; a failed bridge call must not accept an older suggestion by accident.
   */
  protected async choose(reason: 'cannot-start' | 'too-big' | 'tired'): Promise<void> {
    const taskId = this.taskId();
    const sessionId = this.state.snapshot()?.session.id;
    if (this.pending() || taskId === undefined || sessionId === undefined) return;
    this.pending.set(true);
    try {
      const expected =
        reason === 'tired' ? 'BREAK' : reason === 'too-big' ? 'SIMPLIFY' : 'MICRO_START';
      const offer = this.state.rescue();
      if (offer?.phase !== 'offered' || offer.decision.action !== expected) {
        await this.state.dismissIntervention(false);
        if (
          this.state.lastError() !== null ||
          this.state.snapshot()?.session.id !== sessionId ||
          this.taskId() !== taskId
        )
          return;
        const response = await this.state.dispatch('HELP_REQUESTED', { taskId, reason });
        if (
          response?.rescue?.decision.action !== expected ||
          response.rescue.interventionId !== this.state.rescue()?.interventionId ||
          this.state.snapshot()?.session.id !== sessionId ||
          this.taskId() !== taskId ||
          this.state.lastError() !== null
        )
          return;
      }
      await this.state.resolveRescue('accept');
      if (
        reason === 'cannot-start' &&
        this.state.rescue()?.phase === 'active' &&
        this.state.rescue()?.decision.action === expected &&
        this.state.snapshot()?.session.id === sessionId &&
        this.taskId() === taskId &&
        this.state.lastError() === null
      )
        this.continueTimer.emit();
    } finally {
      this.pending.set(false);
      this.noteContentChange();
    }
  }
}
