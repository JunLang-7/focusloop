import { ChangeDetectionStrategy, Component, effect, inject, signal } from '@angular/core';
import { MOOD_NOTE_MAX_CHARACTERS } from '@focusloop/shared-types';
import { AppStateService } from '../core/app-state.service';
import { I18nService, type MessageKey } from '../core/i18n/i18n.service';

interface MoodOption {
  readonly value: number;
  readonly emoji: string;
  readonly key: MessageKey;
}

/** The five answers, in the order they are drawn, so the screen and the store cannot disagree. */
const OPTIONS: readonly MoodOption[] = [
  { value: 1, emoji: '😞', key: 'mood.1' },
  { value: 2, emoji: '🙁', key: 'mood.2' },
  { value: 3, emoji: '😐', key: 'mood.3' },
  { value: 4, emoji: '🙂', key: 'mood.4' },
  { value: 5, emoji: '😄', key: 'mood.5' },
];

const EMOJI_BY_VALUE = new Map(OPTIONS.map((option) => [option.value, option.emoji]));

/**
 * The daily wellbeing check-in.
 *
 * A different question from the learning state — the app cannot infer how the learner feels from their
 * events, so it asks, once a day, in one tap, with an optional sentence. It is deliberately small and
 * deliberately not a modal: a check-in that interrupts is the opposite of what it is for.
 */
@Component({
  selector: 'fl-mood-checkin',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './mood-checkin.component.css',
  template: `
    <section class="mood" data-testid="mood-checkin" [attr.aria-labelledby]="'mood-title'">
      <div class="mood__head">
        <h2 id="mood-title">{{ t('mood.title') }}</h2>
        <p class="muted small">{{ t('mood.hint') }}</p>
      </div>

      <div class="mood__options" role="group" [attr.aria-label]="t('mood.title')">
        @for (option of options; track option.value) {
          <button
            type="button"
            class="mood__option"
            [attr.data-testid]="'mood-' + option.value"
            [attr.aria-label]="t(option.key)"
            [attr.aria-pressed]="mood() === option.value"
            [class.is-selected]="mood() === option.value"
            (click)="choose(option.value)"
          >
            <span aria-hidden="true">{{ option.emoji }}</span>
          </button>
        }
      </div>

      <label class="visually-hidden" for="mood-note">{{ t('mood.note') }}</label>
      <textarea
        id="mood-note"
        class="mood__note"
        rows="2"
        [attr.maxlength]="maxNote"
        [placeholder]="t('mood.notePlaceholder')"
        data-testid="mood-note"
        [value]="note()"
        (input)="onNote($event)"
      ></textarea>

      <div class="mood__actions">
        <button
          type="button"
          class="btn btn--primary btn--small"
          data-testid="mood-save"
          [disabled]="mood() === null || saving()"
          (click)="save()"
        >
          {{ t('mood.save') }}
        </button>
        @if (saved()) {
          <span class="muted small" role="status" data-testid="mood-saved">{{
            t('mood.saved')
          }}</span>
        }
      </div>

      @if (history().length > 1) {
        <!--
          The recent days as faces, newest first. The title carries the date, so the strip stays one line
          and a screen reader still gets the day it belongs to.
        -->
        <div class="mood__history" data-testid="mood-history" [attr.aria-label]="t('mood.history')">
          @for (entry of history(); track entry.date) {
            <span class="mood__history-item" [attr.title]="entry.date" aria-hidden="true">
              {{ emoji(entry.mood) }}
            </span>
          }
        </div>
      }
    </section>
  `,
})
export class MoodCheckinComponent {
  private readonly state = inject(AppStateService);
  private readonly i18n = inject(I18nService);

  protected readonly t = this.i18n.t;
  protected readonly options = OPTIONS;
  protected readonly maxNote = MOOD_NOTE_MAX_CHARACTERS;
  protected readonly history = this.state.moodHistory;

  /** The answer being edited, which starts from today's stored one and is not saved until asked. */
  protected readonly mood = signal<number | null>(null);
  protected readonly note = signal('');
  protected readonly saving = signal(false);
  protected readonly saved = signal(false);

  constructor() {
    void this.state.loadMood();
    /*
     * Today's stored answer seeds the form. It also re-seeds it after a save, which is harmless — the
     * values are the ones just written — and it is what makes the control show the day's answer on a
     * later visit rather than an empty row.
     */
    effect(() => {
      const today = this.state.moodToday();
      if (today === null) return;
      this.mood.set(today.mood);
      this.note.set(today.note);
    });
  }

  protected emoji(value: number): string {
    return EMOJI_BY_VALUE.get(value) ?? '';
  }

  protected choose(value: number): void {
    this.mood.set(value);
    this.saved.set(false);
  }

  protected onNote(event: Event): void {
    this.note.set((event.target as HTMLTextAreaElement).value);
    this.saved.set(false);
  }

  protected async save(): Promise<void> {
    const mood = this.mood();
    if (mood === null) return;
    this.saving.set(true);
    try {
      await this.state.saveMood(mood, this.note());
      this.saved.set(true);
    } finally {
      this.saving.set(false);
    }
  }
}
