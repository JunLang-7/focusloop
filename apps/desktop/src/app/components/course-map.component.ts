import { Component, computed, inject, input, signal } from '@angular/core';
import type { Course } from '@focusloop/shared-types';
import { I18nService } from '../core/i18n/i18n.service';
import { AppStateService } from '../core/app-state.service';
import { buildKnowledgeMap, recallScore } from '../core/knowledge-map';

/**
 * The course as one object, and the exercise of putting it back from memory.
 *
 * The map comes first because a course is easier to start when its shape is visible, and the recall
 * box only appears once every step is done: the point of drawing it again is to find out what stuck,
 * and that is not a question worth asking halfway through.
 */
@Component({
  selector: 'fl-course-map',
  standalone: true,
  template: `
    @if (map().nodes.length > 0) {
      <section>
        <h2 class="section-title">{{ t('map.title') }}</h2>
        <div class="card">
          <p class="muted small">{{ t('map.hint') }}</p>
          <div class="map__scroll">
            <div class="map" [style.width.px]="map().width" [style.height.px]="map().height">
              <svg
                class="map__edges"
                [attr.viewBox]="'0 0 ' + map().width + ' ' + map().height"
                aria-hidden="true"
              >
                @for (line of map().lines; track $index) {
                  <line
                    [attr.x1]="line.x1"
                    [attr.y1]="line.y1"
                    [attr.x2]="line.x2"
                    [attr.y2]="line.y2"
                  />
                }
              </svg>
              <span
                class="map__node map__node--root"
                [style.left.px]="map().root.x"
                [style.top.px]="map().root.y"
                [style.width.px]="map().root.width"
                [style.height.px]="map().root.height"
              >
                {{ map().root.label }}
              </span>
              @for (node of map().nodes; track node.id) {
                <span
                  class="map__node"
                  [attr.data-side]="node.side"
                  [style.left.px]="node.x"
                  [style.top.px]="node.y"
                  [style.width.px]="node.width"
                  [style.height.px]="node.height"
                >
                  {{ node.label }}
                </span>
              }
            </div>
          </div>
        </div>
      </section>
    }

    @if (finished()) {
      <section>
        <h2 class="section-title">{{ t('map.recall.title') }}</h2>
        <div class="card">
          <p class="muted small">{{ t('map.recall.hint') }}</p>
          <label class="field">
            <span>{{ t('map.recall.label') }}</span>
            <textarea
              rows="5"
              data-testid="recall-draft"
              [attr.lang]="locale()"
              [value]="draft()"
              (input)="onDraft($event)"
            ></textarea>
          </label>
          <p class="muted small" data-testid="recall-score">
            {{
              t('map.recall.score', { recalled: '' + score().recalled.length, total: '' + total() })
            }}
          </p>
          @if (score().missed.length === 0) {
            <p class="muted small">{{ t('map.recall.done') }}</p>
          } @else {
            <p class="muted small">{{ t('map.recall.missed') }}</p>
            <ul class="ticks">
              @for (item of score().missed; track item.id) {
                <li>{{ item.title }}</li>
              }
            </ul>
          }
        </div>
      </section>
    }
  `,
})
export class CourseMapComponent {
  private readonly i18n = inject(I18nService);
  private readonly state = inject(AppStateService);

  readonly course = input.required<Course>();
  /** The ids the session has completed, so the map can tell whether the course is finished. */
  readonly completed = input<readonly string[]>([]);

  protected readonly t = this.i18n.t;
  protected readonly map = computed(() =>
    buildKnowledgeMap(this.course().title, this.course().concepts),
  );
  protected readonly draft = signal('');
  /**
   * The interface language, on the element itself.
   *
   * Dictation picks its recognition language from the element it is typing into, so without this a
   * learner using the Chinese interface would get English recognition and a page of nonsense. This
   * is the difference between dictation working and appearing to be broken.
   */
  protected readonly locale = this.state.locale;
  protected readonly score = computed(() => recallScore(this.course().concepts, this.draft()));
  protected readonly total = computed(() => this.course().concepts.length);
  protected readonly finished = computed(() => {
    const tasks = this.course().microTasks;
    if (tasks.length === 0) return false;
    const done = new Set(this.completed());
    return tasks.every((task) => done.has(task.id));
  });

  protected onDraft(event: Event): void {
    this.draft.set((event.target as HTMLTextAreaElement).value);
  }
}
