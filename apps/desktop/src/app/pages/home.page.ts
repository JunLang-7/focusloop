import { Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { AppStateService } from '../core/app-state.service';
import { formatDuration } from '../core/format';

/** Screen 1 of 5: continue, browse courses, import material. */
@Component({
  selector: 'fl-home',
  standalone: true,
  template: `
    <header class="page-head">
      <div>
        <p class="eyebrow">Home</p>
        <h1>Keep your learning continuous</h1>
        <p class="muted">
          FocusLoop helps you resume where you stopped thinking — not just where you stopped
          scrolling.
        </p>
      </div>
    </header>

    @if (snapshot(); as current) {
      <section class="card card--accent">
        <div>
          <p class="eyebrow">Current session</p>
          <h2>{{ current.courseTitle ?? 'Untitled course' }}</h2>
          <p class="muted small">
            {{ current.progress.completedTasks }} / {{ current.progress.totalTasks }} micro tasks ·
            {{ elapsed() }} · state {{ current.session.state }}
          </p>
        </div>
        <div class="row">
          <button type="button" class="btn btn--primary" (click)="goToFocus()">
            Continue session
          </button>
        </div>
      </section>
    } @else {
      <section class="card">
        <p class="muted">No session running. Pick a course below to begin.</p>
      </section>
    }

    <section>
      <h2 class="section-title">Courses</h2>
      <div class="grid">
        @for (course of courses(); track course.id) {
          <article class="card course" data-testid="course-card">
            <h3>{{ course.title }}</h3>
            <p class="muted small">{{ course.description }}</p>
            <p class="muted small">
              {{ course.concepts.length }} concepts · {{ course.microTasks.length }} micro tasks
            </p>
            <div class="row">
              <button type="button" class="btn btn--small" (click)="openCourse(course.id)">
                View course
              </button>
              <button
                type="button"
                class="btn btn--small btn--primary"
                data-testid="start-session"
                (click)="start(course.id)"
              >
                Start session
              </button>
            </div>
          </article>
        } @empty {
          <p class="muted">No courses yet.</p>
        }
      </div>
    </section>

    <section>
      <h2 class="section-title">Import material</h2>
      <div class="card">
        <p class="muted small">Plain text and Markdown only. Everything stays on this machine.</p>
        <label class="field">
          <span>File name</span>
          <input
            type="text"
            placeholder="notes.md"
            [value]="fileName()"
            (input)="onFileName($event)"
          />
        </label>
        <label class="field">
          <span>Content</span>
          <textarea rows="6" [value]="content()" (input)="onContent($event)"></textarea>
        </label>
        <div class="row">
          <button type="button" class="btn" (click)="importMaterial()">Import</button>
          @if (importSummary(); as summary) {
            <span class="muted small">{{ summary }}</span>
          }
        </div>
      </div>
    </section>
  `,
})
export class HomePage {
  private readonly state = inject(AppStateService);
  private readonly router = inject(Router);

  protected readonly courses = this.state.courses;
  protected readonly snapshot = this.state.snapshot;
  protected readonly importSummary = signal<string | null>(null);
  protected readonly fileName = signal('notes.md');
  protected readonly content = signal(
    '# Rotations\n\nA rotation restructures three nodes while preserving the in-order sequence.\n\n## Left rotation\n\nA left rotation moves the pivot down and to the right.\n',
  );

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
    void this.state.importMaterial(this.fileName(), this.content()).then((summary) => {
      this.importSummary.set(summary);
    });
  }
}
