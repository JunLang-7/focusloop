import { Component, computed, inject, input } from '@angular/core';
import { Router } from '@angular/router';
import { AppStateService } from '../core/app-state.service';

/** Screen 2 of 5: concepts, micro tasks, and the entry point into a session. */
@Component({
  selector: 'fl-course',
  standalone: true,
  template: `
    @if (course(); as value) {
      <header class="page-head">
        <div>
          <p class="eyebrow">Course</p>
          <h1>{{ value.title }}</h1>
          <p class="muted">{{ value.description }}</p>
        </div>
        <button type="button" class="btn btn--primary" (click)="start()">Start session</button>
      </header>

      <section>
        <h2 class="section-title">Concepts</h2>
        <ol class="concepts">
          @for (concept of value.concepts; track concept.id) {
            <li class="card">
              <h3>{{ concept.title }}</h3>
              <p class="muted small">{{ concept.summary }}</p>
              @if (concept.keyPoints.length > 0) {
                <ul class="ticks">
                  @for (point of concept.keyPoints; track point) {
                    <li>{{ point }}</li>
                  }
                </ul>
              }
            </li>
          }
        </ol>
      </section>

      <section>
        <h2 class="section-title">Micro tasks</h2>
        <table class="table">
          <thead>
            <tr>
              <th>#</th>
              <th>Task</th>
              <th>Kind</th>
              <th>Estimate</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            @for (task of value.microTasks; track task.id) {
              <tr [class.is-done]="isDone(task.id)">
                <td>{{ task.order + 1 }}</td>
                <td>
                  <strong>{{ task.title }}</strong>
                  <span class="muted small block">{{ task.instructions }}</span>
                </td>
                <td>{{ task.kind }}</td>
                <td>{{ task.estimatedMinutes }} min</td>
                <td>{{ isDone(task.id) ? 'done' : 'open' }}</td>
              </tr>
            }
          </tbody>
        </table>
      </section>
    } @else {
      <div class="card">
        <p class="muted">Course not found.</p>
        <button type="button" class="btn" (click)="back()">Back to home</button>
      </div>
    }
  `,
})
export class CoursePage {
  private readonly state = inject(AppStateService);
  private readonly router = inject(Router);

  readonly courseId = input.required<string>();

  protected readonly course = computed(() => {
    const id = this.courseId();
    return this.state.courses().find((item) => item.id === id) ?? null;
  });

  protected isDone(taskId: string): boolean {
    return this.state.snapshot()?.session.completedTaskIds.includes(taskId) ?? false;
  }

  protected start(): void {
    void this.state.startSession(this.courseId()).then(() => this.router.navigate(['/focus']));
  }

  protected back(): void {
    void this.router.navigate(['/home']);
  }
}
