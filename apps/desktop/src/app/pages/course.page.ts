import { Component, computed, inject, input } from '@angular/core';
import { Router } from '@angular/router';
import { AppStateService } from '../core/app-state.service';
import { I18nService } from '../core/i18n/i18n.service';
import { kindLabel } from '../core/i18n/labels';
import { findMaterialForCourse, findSectionForConcept } from '@focusloop/shared-types';
import { CourseMapComponent } from '../components/course-map.component';

/** Screen 2 of 5: concepts, micro tasks, and the entry point into a session. */
@Component({
  selector: 'fl-course',
  standalone: true,
  imports: [CourseMapComponent],
  template: `
    @if (course(); as value) {
      <header class="page-head">
        <div>
          <p class="eyebrow">{{ t('course.eyebrow') }}</p>
          <h1>{{ value.title }}</h1>
          <p class="muted">{{ value.description }}</p>
        </div>
        <button type="button" class="btn btn--primary" (click)="start()">
          {{ t('course.start') }}
        </button>
      </header>

      <fl-course-map [course]="value" [completed]="completedIds()" />

      <section>
        <h2 class="section-title">{{ t('course.concepts') }}</h2>
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
              @if (showText()) {
                @if (sectionFor(concept.title); as text) {
                  <details class="material">
                    <summary>{{ t('section.show') }}</summary>
                    <p class="material__body">{{ text }}</p>
                  </details>
                }
              }
            </li>
          }
        </ol>
      </section>

      <section>
        <h2 class="section-title">{{ t('course.tasks') }}</h2>
        <table class="table">
          <thead>
            <tr>
              <th>{{ t('course.col.order') }}</th>
              <th>{{ t('course.col.task') }}</th>
              <th>{{ t('course.col.kind') }}</th>
              <th>{{ t('course.col.estimate') }}</th>
              <th>{{ t('course.col.status') }}</th>
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
                <td>
                  <span class="chip">{{ kind(task.kind) }}</span>
                </td>
                <td>{{ minutes(task.estimatedMinutes) }}</td>
                <td>{{ t(isDone(task.id) ? 'course.status.done' : 'course.status.open') }}</td>
              </tr>
            }
          </tbody>
        </table>
      </section>
    } @else {
      <div class="card">
        <p class="muted">{{ t('course.notFound') }}</p>
        <button type="button" class="btn" (click)="back()">{{ t('course.back') }}</button>
      </div>
    }
  `,
})
export class CoursePage {
  private readonly state = inject(AppStateService);
  private readonly router = inject(Router);
  private readonly i18n = inject(I18nService);

  protected readonly t = this.i18n.t;

  readonly courseId = input.required<string>();

  protected readonly course = computed(() => {
    const id = this.courseId();
    return this.state.courses().find((item) => item.id === id) ?? null;
  });
  private readonly material = computed(() =>
    findMaterialForCourse(this.state.materials(), this.courseId()),
  );

  /** The learner decides whether the imported text appears at all. */
  protected readonly showText = this.state.showMaterialText;
  /** Ids the session has finished, so the recall exercise knows when the course is complete. */
  protected readonly completedIds = computed(
    () => this.state.snapshot()?.session.completedTaskIds ?? [],
  );

  /**
   * The text this concept was generated from, so the learner can read the material where the course
   * describes it. Returns nothing for the built-in demo course, which has no imported document.
   */
  protected sectionFor(conceptTitle: string): string | null {
    return findSectionForConcept(this.material(), conceptTitle)?.body ?? null;
  }

  protected kind(value: string): string {
    return kindLabel(value, this.t);
  }

  /** Templates cannot reach the global `String`, so the conversion lives here. */
  protected minutes(value: number): string {
    return this.t('course.minutes', { minutes: `${value}` });
  }

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
