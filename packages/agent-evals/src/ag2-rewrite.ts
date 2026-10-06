import { applyTaskRewrite, buildTaskRewrite, rewriteIdempotencyKey } from '@focusloop/agent-core';
import type { TaskRewrite, TaskRewriteAction, TaskRewriteStep } from '@focusloop/shared-types';
import { fixtureContext, fixtureCourse } from './ag2-fixtures';
import type { JsonObject, JsonValue } from './scenario';

function isRecord(value: JsonValue): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function action(value: JsonValue | undefined): TaskRewriteAction {
  if (value === 'MICRO_START' || value === 'SIMPLIFY') return value;
  throw new Error('AG2 rewrite fixture action must be MICRO_START or SIMPLIFY');
}

/**
 * Exercises what MICRO_START and SIMPLIFY actually change (AG2.3 / AG2.4).
 *
 * The rescue adapter next door stops at the card: which action is offered and what its steps say. That
 * is the decision, and a decision that cannot reach the task is worth nothing — which is exactly what
 * happened here, where the two actions were text for a while and the eval suite stayed green.
 *
 * So this one runs the production `buildTaskRewrite` from a context built by the production builder,
 * and then `applyTaskRewrite` to read back the task the learner would be shown. `estimate` is the
 * narrowed task's own, and the original task's text is asserted *forbidden* in the fixtures: a rewrite
 * that reprinted it would be the old card with a new heading.
 */
export function runAg2RewriteAdapter(input: JsonValue): JsonValue {
  if (!isRecord(input)) throw new Error('AG2 rewrite input must be an object');
  const rewriteAction = action(input['action']);
  const context = fixtureContext(input);
  const built = buildTaskRewrite(rewriteAction, context);
  if (built.status === 'unavailable') {
    return {
      action: rewriteAction,
      status: 'unavailable',
      reason: built.reason,
      steps: [],
      stepMinutes: [],
      estimatedMinutes: null,
      sourceEstimatedMinutes: null,
      idempotencyKey: null,
      renderedInstructions: null,
      renderedMinutes: null,
    };
  }
  const rewrite: TaskRewrite = built.rewrite;
  const course = fixtureCourse(input);
  const rendered = applyTaskRewrite(course, rewrite);
  const task = rendered.microTasks.find((item) => item.id === rewrite.taskId);
  return {
    action: rewrite.action,
    status: 'suggested',
    reason: null,
    steps: rewrite.steps.map((step: TaskRewriteStep) => step.text),
    stepMinutes: rewrite.steps.map((step: TaskRewriteStep) => step.estimatedMinutes),
    estimatedMinutes: rewrite.estimatedMinutes,
    sourceEstimatedMinutes: rewrite.sourceEstimatedMinutes,
    // Derived by the engine in production; pinned here because a changed key would silently turn a
    // second accept into a second rewrite.
    idempotencyKey: rewriteIdempotencyKey('session-ag2', rewrite.taskId, rewrite.action),
    renderedInstructions: task?.instructions ?? null,
    renderedMinutes: task?.estimatedMinutes ?? null,
  };
}
