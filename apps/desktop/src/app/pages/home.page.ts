import { Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { AppStateService } from '../core/app-state.service';
import { I18nService } from '../core/i18n/i18n.service';
import { STATE_KEYS } from '../core/i18n/labels';
import { formatDuration } from '../core/format';

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
        <label class="field">
          <span>{{ t('home.import.content') }}</span>
          <textarea rows="6" [value]="content()" (input)="onContent($event)"></textarea>
        </label>
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
