import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { AppStateService } from '../core/app-state.service';
import { formatClock, formatDuration, percent } from '../core/format';

/** Screen 3 of 5: the focus workspace. */
@Component({
  selector: 'fl-focus',
  standalone: true,
  template: `
    @if (snapshot(); as current) {
      <header class="page-head">
        <div>
          <p class="eyebrow">Focus session</p>
          <h1>{{ current.courseTitle ?? 'Session' }}</h1>
        </div>
        <div class="row">
          <button type="button" class="btn btn--ghost" (click)="end()">End session</button>
        </div>
      </header>

      <section class="card">
        <div class="stats">
          <div class="stat">
            <span class="stat__label">State</span>
            <strong data-testid="state">{{ current.session.state }}</strong>
          </div>
          <div class="stat">
            <span class="stat__label">Elapsed</span>
            <strong data-testid="elapsed">{{ elapsed() }}</strong>
          </div>
          <div class="stat">
            <span class="stat__label">Progress</span>
            <strong data-testid="tasks-completed">
              {{ current.progress.completedTasks }} / {{ current.progress.totalTasks }} ({{
                ratio()
              }})
            </strong>
          </div>
          <div class="stat">
            <span class="stat__label">Started</span>
            <strong>{{ startedAt() }}</strong>
          </div>
        </div>
        <div
          class="meter"
          role="progressbar"
          [attr.aria-valuenow]="current.progress.completedTasks"
        >
          <span class="meter__fill" [style.width.%]="current.progress.completionRatio * 100"></span>
        </div>
      </section>

      @if (task(); as currentTask) {
        <section class="card card--accent">
          <p class="eyebrow">Current micro task</p>
          <h2 data-testid="task-title">{{ currentTask.title }}</h2>
          <p class="muted">{{ currentTask.instructions }}</p>
          <p class="muted small">
            {{ currentTask.kind }} · about {{ currentTask.estimatedMinutes }} min
          </p>
          <div class="row">
            <button
              type="button"
              class="btn btn--primary"
              data-testid="complete-task"
              (click)="complete(currentTask.id)"
            >
              Complete task
            </button>
            <button type="button" class="btn" (click)="needHelp(currentTask.id)">Need help</button>
          </div>
        </section>
      } @else {
        <section class="card">
          <p class="muted">No task in progress.</p>
        </section>
      }

      <section>
        <h2 class="section-title">Up next</h2>
        <ul class="task-list">
          @for (item of openTasks(); track item.id) {
            <li>
              <span>{{ item.title }}</span>
              <button
                type="button"
                class="btn btn--small"
                data-testid="start-task"
                (click)="start(item.id)"
              >
                Start
              </button>
            </li>
          } @empty {
            <li class="muted">Everything in this course is complete.</li>
          }
        </ul>
      </section>
    } @else {
      <div class="card">
        <h1>No session running</h1>
        <p class="muted">Start a session from a course to enter the focus workspace.</p>
        <button type="button" class="btn btn--primary" (click)="back()">Browse courses</button>
      </div>
    }
  `,
})
export class FocusPage {
  private readonly state = inject(AppStateService);
  private readonly router = inject(Router);

  protected readonly snapshot = this.state.snapshot;
  protected readonly task = this.state.currentTask;

  protected openTasks() {
    const course = this.state.currentCourse();
    const snapshot = this.snapshot();
    if (course === null || snapshot === null) return [];
    const done = new Set(snapshot.session.completedTaskIds);
    return course.microTasks.filter(
      (item) => !done.has(item.id) && item.id !== snapshot.session.currentTaskId,
    );
  }

  protected elapsed(): string {
    return formatDuration(this.snapshot()?.progress.elapsedMs ?? 0);
  }

  protected ratio(): string {
    return percent(this.snapshot()?.progress.completionRatio ?? 0);
  }

  protected startedAt(): string {
    return formatClock(this.snapshot()?.session.startedAt);
  }

  protected start(taskId: string): void {
    void this.state.dispatch('TASK_STARTED', { taskId });
  }

  protected complete(taskId: string): void {
    void this.state.dispatch('TASK_COMPLETED', { taskId });
  }

  protected needHelp(taskId: string): void {
    void this.state.dispatch('HELP_REQUESTED', { taskId });
  }

  protected end(): void {
    void this.state.endSession('user');
  }

  protected back(): void {
    void this.router.navigate(['/home']);
  }
}
