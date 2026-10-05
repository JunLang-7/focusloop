import {
  ADAPTIVE_TASK_LIMITS,
  isTaskRewrite,
  type AgentContext,
  type Course,
  type MicroTask,
  type TaskRewrite,
  type TaskRewriteAction,
} from '@focusloop/shared-types';
import { buildShrinkDraft, type ShrinkDraftRefusal } from './adaptive-task';

/**
 * MICRO_START is "only the first step, two minutes": the epic fixes the estimate, #149's draft
 * supplies the grounded first step, and this module is the bridge between them. It is pure — no
 * writes, no provider call and no confirmation — because the engine applies the result through the
 * envelope in `proposal.ts`, which is the only structural write path.
 */
export const MICRO_START_MINUTES = ADAPTIVE_TASK_LIMITS.preferredShrinkMinutes;

export type MicroStartRefusal = ShrinkDraftRefusal | 'not-two-minutes';

export type MicroStartRewriteResult =
  | { readonly status: 'suggested'; readonly rewrite: TaskRewrite }
  | { readonly status: 'unavailable'; readonly reason: MicroStartRefusal };

/**
 * The narrower task for the learner's current context, or why there is not one.
 *
 * A refusal is not a failure: the card still shows the deterministic plan, which is what keeps the
 * offline path (and a task that is already small) working.
 */
export function buildMicroStartRewrite(context: AgentContext | null): MicroStartRewriteResult {
  const draft = buildShrinkDraft(context);
  if (draft.status === 'unavailable') {
    return { status: 'unavailable', reason: draft.reason };
  }
  const rewrite: TaskRewrite = {
    action: 'MICRO_START',
    taskId: draft.draft.sourceTaskId,
    steps: [draft.draft.focus.text],
    estimatedMinutes: draft.draft.estimatedMinutes,
    sourceEstimatedMinutes: draft.draft.sourceEstimatedMinutes,
  };
  // Two minutes is the promise the action makes, not a preference, so a draft that cannot honour it
  // is refused here rather than shown as something it is not.
  if (!isTaskRewrite(rewrite) || rewrite.estimatedMinutes !== MICRO_START_MINUTES) {
    return { status: 'unavailable', reason: 'not-two-minutes' };
  }
  return { status: 'suggested', rewrite };
}

/**
 * One rewrite per session, task and action. The engine derives this key rather than generating an
 * id, so a second accept replays the first proposal instead of writing a second one.
 */
export function rewriteIdempotencyKey(
  sessionId: string,
  taskId: string,
  action: TaskRewriteAction,
): string {
  return `task-rewrite:${action}:${sessionId}:${taskId}`;
}

/**
 * The course as the learner sees it while a rewrite is active. Only the named task changes; the
 * course handed in is returned as it was when nothing matches, and the stored row is never written.
 */
export function applyTaskRewrite(course: Course, rewrite: TaskRewrite): Course {
  const index = course.microTasks.findIndex((task) => task.id === rewrite.taskId);
  const task = course.microTasks[index];
  if (index === -1 || task === undefined) return course;
  const narrowed: MicroTask = {
    ...task,
    instructions: rewrite.steps.join('\n\n'),
    estimatedMinutes: rewrite.estimatedMinutes,
  };
  return {
    ...course,
    microTasks: course.microTasks.map((item, at) => (at === index ? narrowed : item)),
  };
}
