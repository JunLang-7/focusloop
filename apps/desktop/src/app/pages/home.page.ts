import { Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { AppStateService } from '../core/app-state.service';
import { I18nService } from '../core/i18n/i18n.service';
import { STATE_KEYS } from '../core/i18n/labels';
import { formatDuration } from '../core/format';
import { describeLimit, readImportFile, type ImportFileOutcome } from '../core/import-file';

/** Screen 1 of 5: continue, browse courses, import material. */
@Component({
  selector: 'fl-home',
  standalone: true,
  template: `
    <header class="page-head">
      <div>
        <p class="eyebrow">{{ t('home.eyebrow') }}</p>
        <h1>{{ t('home.title') }}</h1>
        <p class="muted">{{ t('home.subtitle') }}</p>
      </div>
    </header>

    @if (snapshot(); as current) {
      <section class="card card--accent">
        <div>
          <p class="eyebrow">{{ t('home.current.title') }}</p>
          <h2>{{ current.courseTitle ?? t('home.current.untitled') }}</h2>
          <p class="muted small">
            {{ currentMeta(current.progress.completedTasks, current.progress.totalTasks) }}
          </p>
        </div>
        <div class="row">
          <button type="button" class="btn btn--primary" (click)="goToFocus()">
            {{ t('home.current.continue') }}
          </button>
        </div>
      </section>
    } @else {
      <section class="card">
        <p class="muted">{{ t('home.empty') }}</p>
      </section>
    }

    <section>
      <h2 class="section-title">{{ t('home.courses.title') }}</h2>
      <div class="grid">
        @for (course of courses(); track course.id) {
          <article class="card course" data-testid="course-card">
            <h3>{{ course.title }}</h3>
            <p class="muted small">{{ course.description }}</p>
            <p class="muted small">
              {{ courseMeta(course.concepts.length, course.microTasks.length) }}
            </p>
            <div class="row">
              <button type="button" class="btn btn--small" (click)="openCourse(course.id)">
                {{ t('home.courses.view') }}
              </button>
              <button
                type="button"
                class="btn btn--small btn--primary"
                data-testid="start-session"
                (click)="start(course.id)"
              >
                {{ t('home.courses.start') }}
              </button>
            </div>
          </article>
        } @empty {
          <p class="muted">{{ t('home.courses.none') }}</p>
        }
      </div>
    </section>

    <section>
      <h2 class="section-title">{{ t('home.import.title') }}</h2>
      <div class="card">
        <p class="muted small">{{ t('home.import.hint') }}</p>
        <!--
          The picker is the way in; typing the file out by hand is the fallback.

          It used to be the only way in, which is why this card was mostly a textarea: importing a
          file you already had meant opening it somewhere else, selecting all of it, and pasting it
          back. A picker was also easier to leave out than to add — the file chooser belongs to the
          operating system, so nothing in the renderer could be told to open it.
        -->
        <div class="row">
          <label class="btn btn--primary pick">
            {{ t('home.import.pick') }}
            <input
              class="pick__input"
              type="file"
              data-testid="import-pick-file"
              accept=".txt,.md,.markdown,text/plain,text/markdown"
              (change)="onPickFile($event)"
            />
          </label>
          @if (pickNotice(); as notice) {
            <span class="muted small" data-testid="import-pick-notice">{{ notice }}</span>
          }
        </div>
        <label class="field">
          <span>{{ t('home.import.fileName') }}</span>
          <input
            type="text"
            data-testid="import-file-name"
            [placeholder]="t('home.import.placeholder')"
            [value]="fileName()"
            (input)="onFileName($event)"
          />
        </label>
        <details class="paste-fallback">
          <summary>{{ t('home.import.pasteSummary') }}</summary>
          <label class="field">
            <span>{{ t('home.import.content') }}</span>
            <textarea rows="6" [value]="content()" (input)="onContent($event)"></textarea>
          </label>
        </details>
        <!--
          The button is disabled rather than allowed to fail. An empty file name used to reach the
          IPC boundary and come back as a validation error naming the channel and the field, which
          is the main process describing its own contract rather than telling the learner what to
          do about it. The rule is applied here, where the mistake is, and the reason is stated
          next to the control instead of in a banner.
        -->
        <div class="row">
          <button
            type="button"
            class="btn"
            data-testid="import-submit"
            [disabled]="!canImport()"
            (click)="importMaterial()"
          >
            {{ t('home.import.action') }}
          </button>
          @if (!canImport()) {
            <span class="muted small" data-testid="import-needs-name">{{
              t('home.import.needFileName')
            }}</span>
          } @else if (importSummary(); as summary) {
            <span class="muted small" data-testid="import-summary">{{ summary }}</span>
          }
        </div>
      </div>
    </section>
  `,
})
export class HomePage {
  private readonly state = inject(AppStateService);
  private readonly router = inject(Router);
  private readonly i18n = inject(I18nService);

  protected readonly t = this.i18n.t;
  protected readonly courses = this.state.courses;
  protected readonly snapshot = this.state.snapshot;
  protected readonly importSummary = signal<string | null>(null);
  /**
   * Why the file that was just picked was not taken. Kept apart from `importSummary`, because the two
   * answer different questions — what the import produced, and why there is nothing to import yet —
   * and one slot let each overwrite the other.
   */
  protected readonly pickNotice = signal<string | null>(null);
  protected readonly fileName = signal('notes.md');
  /**
   * A name of nothing but spaces is still nothing. The main process rejects an empty `fileName`
   * (`asString` in `electron/ipc/validate.ts`), and the renderer applies the same rule before
   * sending rather than letting the learner meet it as a channel error.
   */
  protected readonly canImport = computed(() => this.fileName().trim().length > 0);
  protected readonly content = signal(
    '# Rotations\n\nA rotation restructures three nodes while preserving the in-order sequence.\n\n## Left rotation\n\nA left rotation moves the pivot down and to the right.\n',
  );

  protected currentMeta(completed: number, total: number): string {
    return this.t('home.current.meta', {
      completed: String(completed),
      total: String(total),
      elapsed: this.elapsed(),
      state: this.t(STATE_KEYS[this.state.state()]),
    });
  }

  protected courseMeta(concepts: number, tasks: number): string {
    return this.t('home.courses.meta', { concepts: String(concepts), tasks: String(tasks) });
  }

  protected elapsed(): string {
    return formatDuration(this.snapshot()?.progress.elapsedMs ?? 0);
  }

  protected onFileName(event: Event): void {
    this.fileName.set((event.target as HTMLInputElement).value);
  }

  protected onContent(event: Event): void {
    this.content.set((event.target as HTMLTextAreaElement).value);
  }

  /**
   * Reads the picked file here, in the renderer.
   *
   * No IPC: `importMaterial(fileName, content)` takes text and always has, and an `<input
   * type="file">` hands the renderer a `File` it can read itself. Opening the file in the main
   * process would have meant a new channel, a filesystem read the renderer could aim, and a second
   * place for translated words — all to reach the same two strings.
   */
  protected onPickFile(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    /*
     * Cleared so that picking the same file twice runs twice. Without this the second pick fires no
     * `change` event at all, so a learner who fixed the file on disk and chose it again would watch
     * nothing happen and conclude the button was broken.
     */
    input.value = '';
    if (file === undefined) return;
    void readImportFile(file).then((result) => this.applyPickedFile(result));
  }

  private applyPickedFile(result: ImportFileOutcome): void {
    if (result.outcome === 'picked') {
      this.fileName.set(result.fileName);
      this.content.set(result.content);
      this.importSummary.set(null);
      this.pickNotice.set(null);
      return;
    }

    // Nothing is changed on a refusal: the previous file stays in the form, so a mis-click is not
    // also a loss.
    this.pickNotice.set(this.rejectionFor(result));
  }

  private rejectionFor(result: Exclude<ImportFileOutcome, { outcome: 'picked' }>): string {
    switch (result.outcome) {
      case 'too-large':
        return this.t('home.import.reject.tooLarge', { limit: describeLimit(result.limitBytes) });
      case 'empty':
        return this.t('home.import.reject.empty');
      case 'not-text':
        return this.t('home.import.reject.notText');
      case 'unreadable':
        return this.t('home.import.reject.unreadable');
    }
  }

  protected openCourse(courseId: string): void {
    void this.router.navigate(['/course', courseId]);
  }

  protected goToFocus(): void {
    void this.router.navigate(['/focus']);
  }

  protected start(courseId: string): void {
    void this.state.startSession(courseId).then(() => this.router.navigate(['/focus']));
  }

  protected importMaterial(): void {
    void this.state.importMaterial(this.fileName(), this.content()).then((result) => {
      this.importSummary.set(
        result === null
          ? null
          : this.t('home.import.result', {
              title: result.title,
              concepts: String(result.conceptsCreated),
              tasks: String(result.microTasksCreated),
            }),
      );
    });
  }
}
