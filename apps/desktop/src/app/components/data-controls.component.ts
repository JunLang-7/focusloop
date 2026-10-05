import { Component, effect, inject, signal, viewChild } from '@angular/core';
import type { ElementRef, OnDestroy } from '@angular/core';
import { AppStateService } from '../core/app-state.service';
import { I18nService, type MessageKey } from '../core/i18n/i18n.service';
import { focusableWithin, nextIndex } from '../core/focus-trap';

/** What the panel says after an attempt: an outcome the learner reads, not a decoration. */
interface DataNotice {
  readonly key: MessageKey;
  readonly kind: 'ok' | 'error';
}

/**
 * Where the learner's data is, and the way to get rid of it (#10).
 *
 * In the sidebar footer with the other preferences, and deliberately not behind a screen of its own:
 * the whole point is that the learner does not have to go looking. The path is whatever the main
 * process resolved — this component never builds one — so what is on screen and where the database
 * actually is cannot drift apart.
 *
 * Deleting is two presses with a dialog in between, and the dialog says what will be lost rather than
 * asking whether the learner is sure. The second press is what the IPC layer requires as well: the
 * payload carries the confirmation, so a deletion cannot happen without one.
 */
@Component({
  selector: 'fl-data-controls',
  standalone: true,
  template: `
    <div class="locale" role="group" [attr.aria-label]="t('app.data')">
      <span class="muted small">{{ t('app.data') }}</span>

      @if (info(); as data) {
        <p class="data__path" [title]="data.directory" data-testid="data-path">
          {{ data.directory }}
        </p>
      }

      <div class="locale__options">
        <button
          type="button"
          class="btn btn--small"
          data-testid="data-open-folder"
          (click)="openFolder()"
        >
          {{ t('app.data.open') }}
        </button>
        <button
          type="button"
          class="btn btn--small btn--danger"
          data-testid="data-delete"
          (click)="ask()"
        >
          {{ t('app.data.delete') }}
        </button>
      </div>

      <!--
        One live region for everything a deletion has to say, in the DOM from the start and empty until there
        is something in it. A region has to exist before its content changes to be announced at all, and one
        born with its message already in it is announced unreliably — which is why the files that could not be
        removed and the restart notice are lines inside this region rather than paragraphs of their own.
      -->
      <p
        class="small data__notice"
        [attr.data-kind]="noticeKind()"
        role="status"
        data-testid="data-notice"
      >
        @if (notice(); as message) {
          <span class="data__line">{{ t(message.key) }}</span>
        }
        @if (leftBehind().length > 0) {
          <span class="data__line">{{
            t('app.data.leftBehind', { files: leftBehind().join(', ') })
          }}</span>
        }
        @if (needsRestart()) {
          <span class="data__line">{{ t('app.data.unavailable') }}</span>
        }
      </p>
    </div>

    @if (confirming()) {
      <div
        class="overlay"
        role="dialog"
        aria-modal="true"
        [attr.aria-label]="t('app.data.confirm.title')"
        (keydown)="onKeydown($event)"
      >
        <div class="confirm" #panel tabindex="-1" data-testid="data-confirm-dialog">
          <h2>{{ t('app.data.confirm.title') }}</h2>

          <ul class="confirm__list">
            <li>{{ t('app.data.confirm.course') }}</li>
            <li>{{ t('app.data.confirm.sessions') }}</li>
            <li>{{ t('app.data.confirm.settings') }}</li>
          </ul>

          <!--
            Only rendered with a path in it. If the info never loaded there is nothing to name, and a
            sentence ending in a blank is worse than no sentence in the one dialog whose job is to say what is
            about to be deleted.
          -->
          @if (databasePath().length > 0) {
            <p class="confirm__path" data-testid="data-confirm-path">
              {{ t('app.data.confirm.path', { path: databasePath() }) }}
            </p>
          }
          <p class="confirm__warning">{{ t('app.data.confirm.irreversible') }}</p>

          <footer class="confirm__actions">
            <button
              type="button"
              class="btn"
              data-testid="data-cancel"
              [disabled]="working()"
              (click)="cancel()"
            >
              {{ t('app.data.confirm.cancel') }}
            </button>
            <button
              type="button"
              class="btn btn--danger"
              data-testid="data-confirm"
              [disabled]="working()"
              (click)="confirm()"
            >
              {{ t('app.data.confirm.action') }}
            </button>
          </footer>
        </div>
      </div>
    }
  `,
})
export class DataControlsComponent implements OnDestroy {
  private readonly state = inject(AppStateService);
  private readonly i18n = inject(I18nService);

  protected readonly t = this.i18n.t;
  protected readonly info = this.state.dataInfo;
  protected readonly notice = signal<DataNotice | null>(null);
  /** The files a deletion could not remove, named rather than summarised away. */
  protected readonly leftBehind = signal<readonly string[]>([]);
  /** True when the database could not be opened again, so nothing in the app works until a restart. */
  protected readonly needsRestart = signal(false);
  protected readonly confirming = signal(false);
  protected readonly working = signal(false);

  private readonly panel = viewChild<ElementRef<HTMLElement>>('panel');

  /** The button that opened the dialog, so cancelling puts the learner back on it. */
  private returnFocusTo: HTMLElement | null = null;

  constructor() {
    void this.state.loadDataInfo();
  }

  /**
   * Focus goes into the dialog when it opens and back to the button when it closes.
   *
   * `aria-modal="true"` is a promise that the rest of the page is inert. Claiming it without moving
   * focus in leaves a keyboard user on the page behind the overlay, unable to reach either button.
   */
  private readonly manageFocus = effect(() => {
    const panel = this.panel()?.nativeElement;

    if (this.confirming() && panel !== undefined) {
      this.returnFocusTo ??= document.activeElement as HTMLElement | null;
      panel.focus();
      return;
    }

    if (!this.confirming() && this.returnFocusTo !== null) {
      this.returnFocusTo.focus();
      this.returnFocusTo = null;
    }
  });

  ngOnDestroy(): void {
    this.manageFocus.destroy();
  }

  protected databasePath(): string {
    return this.info()?.databasePath ?? '';
  }

  /**
   * How the status line should read, which is the most serious of what it is carrying: a failure, or a
   * deletion that left files behind and may need a restart, outrank one that worked.
   */
  protected noticeKind(): 'ok' | 'warning' | 'error' | null {
    if (this.needsRestart() || this.notice()?.kind === 'error') return 'error';
    if (this.leftBehind().length > 0) return 'warning';
    return this.notice()?.kind ?? null;
  }

  protected async openFolder(): Promise<void> {
    const opened = await this.state.openDataFolder();
    this.notice.set(opened ? null : { key: 'app.data.openFailed', kind: 'error' });
  }

  protected ask(): void {
    // A stale outcome from the last attempt would read as the answer to this one.
    this.notice.set(null);
    this.leftBehind.set([]);
    this.needsRestart.set(false);
    this.confirming.set(true);
  }

  protected cancel(): void {
    this.confirming.set(false);
  }

  protected async confirm(): Promise<void> {
    this.working.set(true);
    const outcome = await this.state.deleteAllData();
    this.working.set(false);
    this.confirming.set(false);

    /*
     * Only a deletion that happened is reported as one.
     *
     * `ok` comes from the file being gone rather than from the call having returned, so the failure branch
     * is the honest one, and the reason says which of the three things went wrong: another program holding
     * the file, the OS refusing for a reason the learner cannot act on, or a deletion that happened while the
     * app could not open its database again — which has to be said, because nothing works until a restart. A
     * `null` outcome means the request never reached the main process, which the error banner has reported.
     */
    if (outcome === null) return;

    this.notice.set(
      outcome.ok
        ? { key: 'app.data.deleted', kind: 'ok' }
        : {
            key: outcome.reason === 'locked' ? 'app.data.locked' : 'app.data.failed',
            kind: 'error',
          },
    );

    /*
     * And the files that survived are named, when there are any. They are not "nothing": a `-wal` holds page
     * images, so a learner who is told the database is gone deserves to know which file was left and where.
     */
    this.leftBehind.set(outcome.leftBehind);

    /*
     * Whether the app can still be used is a separate fact from whether the data went, and it is reported
     * separately for that reason: the deletion can have succeeded and left nothing working until a restart.
     */
    this.needsRestart.set(!outcome.usable);
  }

  /** Escape cancels and Tab stays inside, exactly as the resume dialog does. */
  protected onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.cancel();
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
}
