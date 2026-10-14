import { Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { AppStateService } from '../core/app-state.service';
import { I18nService } from '../core/i18n/i18n.service';
import { STATE_KEYS } from '../core/i18n/labels';
import type { MessageKey } from '../core/i18n/messages.en';
import { formatDuration } from '../core/format';
import {
  MATERIAL_FILE_MAX_BYTES,
  describeBytes,
  describeLimit,
  isFileDrag,
  isImportableFileName,
  readImportFile,
  type ImportFileOutcome,
} from '../core/import-file';

/**
 * What an import is missing, in the order the form asks for it: a name, a name the parser can read,
 * and something to import. Each one is stated under the button rather than sent to the main process
 * to come back as a channel error.
 */
type ImportProblem = 'missing' | 'format' | 'empty-text';

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
      <!--
        Getting started (#21). It is here, and only here, because this is the moment the learner is
        deciding what to do next: with a session running the page has something better to say, and
        help that has to be dismissed or remembered is a nag rather than help. The order is an ordered
        list rather than a styled one because the order is the point - and it is announced as one.
      -->
      <section class="card getting-started" data-testid="getting-started">
        <p class="eyebrow">{{ t('home.start.eyebrow') }}</p>
        <h2>{{ t('home.start.title') }}</h2>
        <p class="muted">{{ t('home.empty') }}</p>
        <ol class="steps">
          <li>{{ t('home.start.step.course') }}</li>
          <li>{{ t('home.start.step.session') }}</li>
          <li>{{ t('home.start.step.task') }}</li>
        </ol>
        <p class="muted small">{{ t('home.start.back') }}</p>
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
          One zone, and it is the whole way in.

          This used to be a button-shaped label sitting among other buttons, with the file's name typed
          into a field below it, so nothing on the card said "a file goes here". Every upload surface
          worth copying draws the same thing — Uppy's drag-drop, Dropzone.js, react-dropzone, Ant
          Design's Dragger: a dashed area, a glyph, one line saying drop-or-choose, and a muted line
          under it naming the formats and the size limit. The dash goes solid and takes the accent
          while a file is over it, which is the only thing that makes a drop target visible at all.

          The label is what a person presses and the input underneath is what the chooser — and a
          test — needs to find. Keeping the real input in the tree, stretched across the zone and made
          transparent, is also what makes the zone reachable from the keyboard.
        -->
        <div
          class="dropzone"
          [class.is-dragging]="dragging()"
          data-testid="import-dropzone"
          (dragenter)="onDragOver($event)"
          (dragover)="onDragOver($event)"
          (dragleave)="onDragLeave($event)"
          (drop)="onDrop($event)"
        >
          <label class="dropzone__target">
            <span class="dropzone__glyph" aria-hidden="true">⤒</span>
            <span class="dropzone__prompt">{{
              t(dragging() ? 'home.import.dropNow' : 'home.import.drop')
            }}</span>
            <span class="dropzone__hint muted small">{{
              t('home.import.accepts', { limit: fileLimit })
            }}</span>
            <input
              class="dropzone__input"
              type="file"
              data-testid="import-pick-file"
              [attr.accept]="ACCEPTED_TYPES"
              (change)="onPickFile($event)"
            />
          </label>
        </div>

        @if (picked(); as file) {
          <!--
            The file that is actually in the form: what it is called, what it weighs, and the way out
            of it. A name field alone left "which file did it read?" to be inferred.
          -->
          <div class="dropzone__file" data-testid="import-picked">
            <span class="dropzone__file-name" [title]="file.name">{{ file.name }}</span>
            <span class="muted small">{{ file.size }}</span>
            <button
              type="button"
              class="btn btn--small btn--ghost"
              data-testid="import-clear-file"
              (click)="clearPicked()"
            >
              {{ t('home.import.remove') }}
            </button>
          </div>
        }

        @if (pickNotice(); as notice) {
          <!-- A refusal is stated under the zone, where the mistake was made, and changes nothing. -->
          <p class="dropzone__notice" data-testid="import-pick-notice">{{ notice }}</p>
        }

        <label class="field">
          <span>{{ t('home.import.fileName') }}</span>
          <input
            type="text"
            data-testid="import-file-name"
            [placeholder]="t('home.import.placeholder')"
            [value]="fileName()"
            (input)="onFileName($event)"
          />
          <span class="muted small">{{ t('home.import.nameHint') }}</span>
        </label>
        <details class="paste-fallback">
          <summary>{{ t('home.import.pasteSummary') }}</summary>
          <label class="field">
            <span>{{ t('home.import.content') }}</span>
            <textarea
              rows="6"
              [placeholder]="t('home.import.contentPlaceholder')"
              [value]="content()"
              (input)="onContent($event)"
            ></textarea>
          </label>
        </details>
        <!--
          The button is disabled rather than allowed to fail. An empty file name used to reach the
          IPC boundary and come back as a validation error naming the channel and the field, and a
          name the parser cannot place still did: importing typed.rst answered with "Error invoking
          remote method 'focusloop:material:import': MaterialParseError: Cannot determine a supported
          format for typed.rst." — the main process describing its own contract rather than telling
          the learner what to do about it. There are three rules now, and the third is the text: an
          import with nothing in it made a course with no concepts in it, which reads as success and
          is not one. All three are applied here, where the mistake is, and the reason is stated next
          to the control instead of in a banner. One line states whichever rule is being broken.
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
          @if (importProblem(); as problem) {
            <span class="muted small" data-testid="import-needs-name">{{
              t(PROBLEM_KEYS[problem])
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
   * What the import is still missing, if anything — `null` when it may go ahead.
   *
   * Three rules, one line under the button. A name of nothing but spaces is still nothing: the main
   * process rejects an empty `fileName` (`asString` in `electron/ipc/validate.ts`), and the renderer
   * applies the same rule before sending rather than letting the learner meet it as a channel error.
   * A name the parser cannot read is the same kind of mistake — no extension, or one it does not
   * know — and it has the same answer: say so where the name is, rather than send it and come back
   * with `Error invoking remote method 'focusloop:material:import': MaterialParseError: …`, which
   * names a channel and an error class and not one thing to do about it. And the text has to be
   * there: an import of nothing made a course with no concepts in it and reported it as a success.
   */
  protected readonly importProblem = computed<ImportProblem | null>(() => {
    if (this.fileName().trim().length === 0) return 'missing';
    if (!isImportableFileName(this.fileName())) return 'format';
    return this.content().trim().length === 0 ? 'empty-text' : null;
  });
  protected readonly canImport = computed(() => this.importProblem() === null);
  protected readonly PROBLEM_KEYS: Record<ImportProblem, MessageKey> = {
    missing: 'home.import.needFileName',
    format: 'home.import.needFormat',
    'empty-text': 'home.import.needText',
  };
  protected readonly content = signal('');
  /** True while a file is being dragged over the zone, which is the zone's only visible feedback. */
  protected readonly dragging = signal(false);
  /**
   * The file the form is holding, once one has been read.
   *
   * `null` for a paste, which is a name typed by hand and nothing else — and staying null then is
   * right: a row claiming a file would be claiming something the app never read.
   */
  protected readonly picked = signal<{ name: string; size: string } | null>(null);
  /** The formats the chooser offers, and the size it accepts. Both stated on the zone itself. */
  protected readonly ACCEPTED_TYPES = '.txt,.text,.md,.markdown,.mdx,text/plain,text/markdown';
  protected readonly fileLimit = describeLimit(MATERIAL_FILE_MAX_BYTES);

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
    void readImportFile(file).then((result) => this.applyPickedFile(result, file.size));
  }

  /**
   * A drag is only a file drag if it carries files — see `isFileDrag`. `dropEffect` is set for the
   * same reason: the cursor has to say "copy" while a file is over the zone, or it says the drop is
   * not allowed.
   */
  protected onDragOver(event: DragEvent): void {
    if (!isFileDrag(event.dataTransfer?.types)) return;
    // Required for `drop` to fire at all: the default action for a dragover is "not a target".
    event.preventDefault();
    if (event.dataTransfer !== null) event.dataTransfer.dropEffect = 'copy';
    this.dragging.set(true);
  }

  protected onDragLeave(event: DragEvent): void {
    /*
     * `dragleave` fires on the way *into* a child as well, so leaving for something still inside the
     * zone is not leaving the zone. Tested against `currentTarget`, which is the zone itself.
     */
    const zone = event.currentTarget as Node | null;
    const next = event.relatedTarget as Node | null;
    if (zone !== null && next !== null && zone.contains(next)) return;
    this.dragging.set(false);
  }

  /** A dropped file goes through exactly the same read as a chosen one — same checks, same words. */
  protected onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(false);
    const file = event.dataTransfer?.files?.[0];
    if (file === undefined) return;
    void readImportFile(file).then((result) => this.applyPickedFile(result, file.size));
  }

  /**
   * Empties the form back to a paste-shaped one: a name is the learner's to type, and the text is
   * gone with the file it came from. The name is left alone rather than cleared, because a name is
   * the one thing here that can be worth keeping.
   */
  protected clearPicked(): void {
    this.picked.set(null);
    this.content.set('');
    this.pickNotice.set(null);
    this.importSummary.set(null);
  }

  /**
   * `sizeBytes` is the file's own size rather than the length of what was read out of it: the two
   * differ for anything that is not ASCII, and the row is reporting the file, not the string.
   */
  private applyPickedFile(result: ImportFileOutcome, sizeBytes: number): void {
    if (result.outcome === 'picked') {
      this.fileName.set(result.fileName);
      this.content.set(result.content);
      this.picked.set({ name: result.fileName, size: describeBytes(sizeBytes) });
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
      case 'unsupported-format':
        return this.t('home.import.reject.unsupportedFormat');
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
    /*
     * The last answer goes before the new import is sent.
     *
     * The line under the button answers "what did that press make", and it was left standing until the
     * next answer arrived: while an import was in flight the counts on screen belonged to the press
     * before it, and an import that came back empty or not at all left those counts standing as if
     * they were its own. Clearing it keeps the line to the one import it describes.
     */
    this.importSummary.set(null);
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
