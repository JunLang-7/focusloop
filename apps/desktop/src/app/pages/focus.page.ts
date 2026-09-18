import { Component, computed, inject } from '@angular/core';
import { Router } from '@angular/router';
import type { MicroTaskKind } from '@focusloop/shared-types';
import { AppStateService } from '../core/app-state.service';
import { I18nService } from '../core/i18n/i18n.service';
import { STATE_KEYS, kindLabel } from '../core/i18n/labels';
import { formatClock, formatDuration, percent } from '../core/format';
import { formatSpan } from '../core/insights-view';
import { KIND_GLYPHS, buildPlan } from '../core/session-plan';

/** Screen 3 of 5: the focus workspace. */
@Component({
  selector: 'fl-focus',
  standalone: true,
  template: `
    @if (snapshot(); as current) {
      <header class="page-head">
        <div>
          <p class="eyebrow">{{ t('focus.eyebrow') }}</p>
          <h1>{{ current.courseTitle ?? t('focus.untitled') }}</h1>
        </div>
        <div class="row">
          <button type="button" class="btn btn--ghost" data-testid="end-session" (click)="end()">
            {{ t('focus.end') }}
          </button>
        </div>
      </header>

      <section class="card">
        <div class="stats">
          <div class="stat">
            <span class="stat__label">{{ t('focus.state') }}</span>
            <!--
              The visible text is translated, so the raw state is exposed as a
              data attribute. Tests assert the domain value, not the wording.
            -->
            <strong data-testid="state" [attr.data-state]="current.session.state">
              {{ stateLabel() }}
            </strong>
          </div>
          <div class="stat">
            <span class="stat__label">{{ t('focus.elapsed') }}</span>
            <strong data-testid="elapsed">{{ elapsed() }}</strong>
          </div>
          <div class="stat">
            <span class="stat__label">{{ t('focus.progress') }}</span>
            <strong data-testid="tasks-completed">
              {{ current.progress.completedTasks }} / {{ current.progress.totalTasks }} ({{
                ratio()
              }})
            </strong>
          </div>
          <div class="stat">
            <span class="stat__label">{{ t('focus.started') }}</span>
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
          <p class="eyebrow">{{ t('focus.currentTask') }}</p>
          <h2 data-testid="task-title">{{ currentTask.title }}</h2>
          <p class="muted">{{ currentTask.instructions }}</p>
          <p class="row task-meta">
            <span class="chip" data-testid="task-kind">{{ kind(currentTask.kind) }}</span>
            <span class="muted small">{{ estimate(currentTask.estimatedMinutes) }}</span>
          </p>
          <div class="row">
            <button
              type="button"
              class="btn btn--primary"
              data-testid="complete-task"
              (click)="complete(currentTask.id)"
            >
              {{ t('focus.complete') }}
            </button>
            <button type="button" class="btn" (click)="needHelp(currentTask.id)">
              {{ t('focus.needHelp') }}
            </button>
          </div>
        </section>
      } @else {
        <section class="card">
          <p class="muted">{{ t('focus.noTask') }}</p>
        </section>
      }

      <section>
        <div class="section-head">
          <h2 class="section-title">{{ t('focus.upNext') }}</h2>
          @if (plan().blocks.length > 0) {
            <span class="muted small" data-testid="plan-remaining">
              {{ remaining(plan().totalMinutes) }}
            </span>
          }
        </div>

        @if (plan().blocks.length === 0) {
          <p class="muted">{{ t('focus.allDone') }}</p>
        } @else {
          <!--
            The blocks are positioned rather than flowed, because their geometry is the
            information: a task twice as long occupies twice the column. The maths lives in
            session-plan.ts, and the accessible reading order is the DOM order below.
          -->
          <ul class="plan" [style.height.px]="plan().height">
            @for (block of plan().blocks; track block.id) {
              <li
                class="plan__block"
                data-testid="plan-block"
                [attr.data-kind]="block.kind"
                [style.top.px]="block.offset"
                [style.height.px]="block.height"
              >
                <span class="plan__glyph" aria-hidden="true">{{ glyph(block.kind) }}</span>
                <span class="plan__title">{{ block.title }}</span>
                <span class="muted small plan__estimate">{{ shortEstimate(block.minutes) }}</span>
                <button
                  type="button"
                  class="btn btn--small"
                  data-testid="start-task"
                  (click)="start(block.id)"
                >
                  {{ t('focus.startTask') }}
                </button>
              </li>
            }
          </ul>
        }
      </section>
    } @else {
      <div class="card">
        <h1>{{ t('focus.none.title') }}</h1>
        <p class="muted">{{ t('focus.none.body') }}</p>
        <button type="button" class="btn btn--primary" (click)="back()">
          {{ t('focus.none.browse') }}
        </button>
      </div>
    }
  `,
})
export class FocusPage {
  private readonly state = inject(AppStateService);
  private readonly router = inject(Router);
  private readonly i18n = inject(I18nService);

  protected readonly t = this.i18n.t;
  protected readonly snapshot = this.state.snapshot;
  protected readonly task = this.state.currentTask;

  /** What is left, as geometry. See session-plan.ts for why it is not a plain list. */
  protected readonly plan = computed(() => buildPlan(this.openTasks()));

  protected glyph(kind: MicroTaskKind): string {
    return KIND_GLYPHS[kind];
  }

  protected remaining(minutes: number): string {
    return this.t('focus.plan.remaining', { time: formatSpan(minutes * 60_000, this.t) });
  }

  protected shortEstimate(minutes: number): string {
    return this.t('course.minutes', { minutes: `${minutes}` });
  }

  protected stateLabel(): string {
    return this.t(STATE_KEYS[this.state.state()]);
  }

  protected kind(value: string): string {
    return kindLabel(value, this.t);
  }

  /** Templates cannot reach the global `String`, so the conversion lives here. */
  protected estimate(minutes: number): string {
    return this.t('focus.taskMeta', { minutes: `${minutes}` });
  }

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
