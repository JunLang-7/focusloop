import { Component, computed, inject } from '@angular/core';
import type { AgentContext, AgentContextReport } from '@focusloop/shared-types';
import { AppStateService } from '../core/app-state.service';
import { I18nService } from '../core/i18n/i18n.service';

/**
 * Developer-mode inspector: exactly what the agent is given about the current moment.
 *
 * This exists because the rest of the agent is invisible. Without it, the first question asked of any
 * wrong answer — "what did it actually know?" — has no answer, and every later debugging session
 * starts by guessing.
 *
 * It displays what `getAgentContext` returned and derives nothing itself. The first version built the
 * context here by importing the builder directly, and the typecheck refused it: `@focusloop/agent-core`
 * pulls in `engine.ts`, which imports `node:crypto`, which a sandboxed renderer has no business
 * resolving. The refusal was right for a second reason too — an inspector that computes its own
 * version eventually shows something the agent never receives.
 *
 * Developer mode only; it is absent from a packaged build.
 */
@Component({
  selector: 'fl-agent-context-panel',
  standalone: true,
  template: `
    @if (enabled()) {
      <details class="agent-context" data-testid="agent-context-panel">
        <summary class="agent-context__summary" data-testid="agent-context-toggle">
          {{ t('agent.inspector.title') }}
        </summary>

        @if (report().context; as context) {
          <dl class="agent-context__grid">
            <dt>{{ t('agent.inspector.state') }}</dt>
            <dd data-testid="agent-context-state">{{ context.learningState }}</dd>

            <dt>{{ t('agent.inspector.concept') }}</dt>
            <dd>{{ context.concept.title ?? '—' }}</dd>

            <dt>{{ t('agent.inspector.task') }}</dt>
            <dd data-testid="agent-context-task">{{ taskLine(context) }}</dd>

            <dt>{{ t('agent.inspector.material') }}</dt>
            <dd data-testid="agent-context-material">{{ materialLine(context) }}</dd>

            <dt>{{ t('agent.inspector.events') }}</dt>
            <dd data-testid="agent-context-events">{{ eventLine(context) }}</dd>
          </dl>

          <!--
            Gated on the learner's own material-text control, not shown unconditionally. The inspector
            is a new surface, and a new surface quietly ignoring a switch somebody deliberately built
            is how a control stops meaning anything.
          -->
          @if (showMaterial() && context.material.text.length > 0) {
            <pre class="agent-context__text">{{ context.material.text }}</pre>
          }

          <!-- The account of what was left out is the point of the panel, not an appendix to it. -->
          @if (report().omissions.length > 0) {
            <p class="eyebrow">{{ t('agent.inspector.omitted') }}</p>
            <ul class="agent-context__omissions" data-testid="agent-context-omissions">
              <!--
                The detail alone. It already says what it is ("8 earlier events are not included"), and
                prefixing it with the raw field name printed an untranslated machine token in a panel
                that is otherwise fully translated.
              -->
              @for (omission of report().omissions; track omission.field + omission.detail) {
                <li>{{ omission.detail }}</li>
              }
            </ul>
          }
        } @else {
          <p class="muted small" data-testid="agent-context-empty">
            {{ t('agent.inspector.none') }}
          </p>
        }
      </details>
    }
  `,
})
export class AgentContextPanelComponent {
  private readonly state = inject(AppStateService);
  private readonly i18n = inject(I18nService);

  protected readonly t = this.i18n.t;
  protected readonly enabled = () => this.state.runtime()?.simulatorEnabled ?? false;
  protected readonly showMaterial = this.state.showMaterialText;

  /**
   * The context the main process built, not one assembled here.
   *
   * It arrives already bounded and already accounted for, so this component holds no opinion about
   * what the agent may see — which is the point. The empty fallback covers the moment before the
   * first reply lands.
   */
  protected readonly report = computed<AgentContextReport>(
    () => this.state.agentContext() ?? { context: null, omissions: [] },
  );

  protected taskLine(context: AgentContext): string {
    const { title, step, totalSteps, estimatedMinutes } = context.task;
    const of = this.t('agent.inspector.of');
    if (title === null) return `${String(step)} ${of} ${String(totalSteps)}`;
    const estimate = estimatedMinutes === null ? '' : `, ~${String(estimatedMinutes)} min`;
    return `${title} (${String(step)} ${of} ${String(totalSteps)}${estimate})`;
  }

  protected materialLine(context: AgentContext): string {
    const { heading, text, truncated } = context.material;
    if (heading === null) return '—';
    const cut = truncated ? ` (${this.t('agent.inspector.truncated')})` : '';
    return `${heading}${cut} · ${String(text.length)} ${this.t('agent.inspector.chars')}`;
  }

  protected eventLine(context: AgentContext): string {
    if (context.recentEvents.length === 0) return '—';
    return context.recentEvents.map((event) => event.type).join(' → ');
  }
}
