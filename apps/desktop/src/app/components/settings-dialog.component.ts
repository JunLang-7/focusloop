import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
  linkedSignal,
  output,
  viewChild,
} from '@angular/core';
import type { ElementRef, OnDestroy } from '@angular/core';
import { I18nService } from '../core/i18n/i18n.service';
import { GeneralSettingsComponent } from './general-settings.component';
import { LlmSettingsComponent } from './llm-settings.component';

export type SettingsSection = 'general' | 'models';

/** Native modal shell: preferences and models are sections, not application routes. */
@Component({
  selector: 'fl-settings-dialog',
  standalone: true,
  imports: [GeneralSettingsComponent, LlmSettingsComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './settings-dialog.component.css',
  template: `
    <dialog
      #dialog
      class="settings"
      data-testid="settings-dialog"
      aria-labelledby="settings-title"
      (cancel)="cancel($event)"
    >
      <header class="settings__header">
        <h1 id="settings-title">{{ t('settings.title') }}</h1>
        <button
          type="button"
          class="settings__close"
          [attr.data-testid]="section() === 'models' ? 'llm-close' : 'settings-close'"
          [attr.aria-label]="t('settings.close')"
          [title]="t('settings.close')"
          (click)="close()"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="m6 6 12 12M18 6 6 18" />
          </svg>
        </button>
      </header>
      <div class="settings__body">
        <nav
          class="settings__nav"
          role="tablist"
          aria-orientation="vertical"
          [attr.aria-label]="t('settings.sections')"
          (keydown)="onTabKey($event)"
        >
          <button
            type="button"
            role="tab"
            id="settings-general-tab"
            aria-controls="settings-general-panel"
            data-testid="settings-general-tab"
            [class.is-active]="section() === 'general'"
            [attr.aria-selected]="section() === 'general'"
            [attr.tabindex]="section() === 'general' ? 0 : -1"
            (click)="section.set('general')"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="m9 3-.6 2-1.8 1-2-.5-2 3.5 1.4 1.5v2l-1.4 1.5 2 3.5 2-.5 1.8 1 .6 2h4l.6-2 1.8-1 2 .5 2-3.5-1.4-1.5v-2l1.4-1.5-2-3.5-2 .5-1.8-1L13 3Z"
              />
              <circle cx="11" cy="11" r="3" /></svg
            >{{ t('settings.general') }}
          </button>
          <button
            type="button"
            role="tab"
            id="settings-models-tab"
            aria-controls="settings-models-panel"
            data-testid="settings-models-tab"
            [class.is-active]="section() === 'models'"
            [attr.aria-selected]="section() === 'models'"
            [attr.tabindex]="section() === 'models' ? 0 : -1"
            (click)="section.set('models')"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <ellipse cx="12" cy="5" rx="7" ry="3" />
              <path d="M5 5v12c0 4 14 4 14 0V5M5 11c0 4 14 4 14 0" /></svg
            >{{ t('settings.models') }}
          </button>
        </nav>
        <div
          class="settings__content"
          role="tabpanel"
          [id]="section() === 'general' ? 'settings-general-panel' : 'settings-models-panel'"
          [attr.aria-labelledby]="
            section() === 'general' ? 'settings-general-tab' : 'settings-models-tab'
          "
        >
          @if (section() === 'general') {
            <fl-general-settings />
          } @else {
            <fl-llm-settings />
          }
        </div>
      </div>
    </dialog>
  `,
})
export class SettingsDialogComponent implements OnDestroy {
  protected readonly t = inject(I18nService).t;
  readonly initialSection = input<SettingsSection>('general');
  protected readonly section = linkedSignal(() => this.initialSection());
  readonly closed = output<void>();
  private readonly dialog = viewChild<ElementRef<HTMLDialogElement>>('dialog');
  constructor() {
    afterNextRender(() => this.dialog()?.nativeElement.showModal());
  }
  ngOnDestroy(): void {
    this.dialog()?.nativeElement.close();
  }
  protected cancel(event: Event): void {
    event.preventDefault();
    const popover =
      this.dialog()?.nativeElement.querySelector<HTMLElement>('[popover]:popover-open');
    if (popover) {
      popover.hidePopover();
      return;
    }
    this.close();
  }
  protected close(): void {
    this.dialog()?.nativeElement.close();
    this.closed.emit();
  }
  protected onTabKey(event: KeyboardEvent): void {
    let next: SettingsSection;
    if (event.key === 'Home') next = 'general';
    else if (event.key === 'End') next = 'models';
    else if (event.key === 'ArrowUp' || event.key === 'ArrowDown')
      next = this.section() === 'general' ? 'models' : 'general';
    else return;
    event.preventDefault();
    this.section.set(next);
    this.dialog()?.nativeElement.querySelector<HTMLButtonElement>(`#settings-${next}-tab`)?.focus();
  }
}
