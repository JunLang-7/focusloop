import {
  ADAPTIVE_TASK_LIMITS,
  isTaskRewrite,
  type AgentContext,
  type Course,
  type MicroTask,
  type TaskRewrite,
  type TaskRewriteAction,
  type TaskRewriteStep,
} from '@focusloop/shared-types';
import { buildShrinkDraft, groundedSplitTexts, type ShrinkDraftRefusal } from './adaptive-task';

/**
 * MICRO_START is "only the first step, two minutes" and SIMPLIFY is "split into 1–5 minute steps":
 * the epic fixes the first, #149's draft supplies the estimate for the second, and this module is the
 * bridge between both and that draft. It is pure — no writes, no provider call and no confirmation —
 * because the engine applies the result through the envelope in `proposal.ts`, which is the only
 * structural write path.
 */
export const MICRO_START_MINUTES = ADAPTIVE_TASK_LIMITS.preferredShrinkMinutes;

export type TaskRewriteRefusal =
  ShrinkDraftRefusal | 'not-two-minutes' | 'no-split-steps' | 'unknown-action';

export type TaskRewriteResult =
  | { readonly status: 'suggested'; readonly rewrite: TaskRewrite }
  | { readonly status: 'unavailable'; readonly reason: TaskRewriteRefusal };

type StepsResult =
  | { readonly status: 'steps'; readonly steps: readonly TaskRewriteStep[] }
  | { readonly status: 'unavailable'; readonly reason: TaskRewriteRefusal };

/**
 * The narrower task for the learner's current context, or why there is not one.
 *
 * A refusal is not a failure: the card still shows the deterministic plan, which is what keeps the
 * offline path (and a task that is already small) working.
 */
export function buildTaskRewrite(
  action: TaskRewriteAction,
  context: AgentContext | null,
): TaskRewriteResult {
  const draft = buildShrinkDraft(context);
  if (draft.status === 'unavailable') {
    return { status: 'unavailable', reason: draft.reason };
  }
  const minutes = draft.draft.estimatedMinutes;
  const steps =
    action === 'MICRO_START'
      ? microStartSteps(minutes, draft.draft.focus.text)
      : splitSteps(
          action,
          context,
          minutes,
          draft.draft.sourceEstimatedMinutes,
          draft.draft.focus.text,
        );
  if (steps.status === 'unavailable') return steps;
  const rewrite: TaskRewrite = {
    action,
    taskId: draft.draft.sourceTaskId,
    steps: steps.steps,
    estimatedMinutes: steps.steps.reduce((total, step) => total + step.estimatedMinutes, 0),
    sourceEstimatedMinutes: draft.draft.sourceEstimatedMinutes,
  };
  // The validator is the contract, so it is what decides: a rewrite that fails it is refused rather
  // than trimmed into something the learner was not offered.
  if (!isTaskRewrite(rewrite)) return { status: 'unavailable', reason: 'no-split-steps' };
  return { status: 'suggested', rewrite };
}

function microStartSteps(minutes: number, focus: string): StepsResult {
  // Two minutes is the promise the action makes, not a preference, so a draft that cannot honour it
  // is refused here rather than shown as something it is not.
  if (minutes !== MICRO_START_MINUTES) return { status: 'unavailable', reason: 'not-two-minutes' };
  return { status: 'steps', steps: [{ text: focus, estimatedMinutes: minutes }] };
}

function splitSteps(
  action: TaskRewriteAction,
  context: AgentContext | null,
  minutes: number,
  source: number,
  draftFocus: string,
): StepsResult {
  if (action !== 'SIMPLIFY') return { status: 'unavailable', reason: 'unknown-action' };
  const steps: TaskRewriteStep[] = [{ text: draftFocus, estimatedMinutes: minutes }];
  let total = minutes;
  for (const text of groundedSplitTexts(context)) {
    if (steps.some((step) => step.text === text)) continue;
    // Every step keeps the same bounded estimate, so the split stays a split only while it fits inside
    // the task: a plan that adds up to more than the learner was given is not simpler than the task.
    if (total + minutes >= source) break;
    steps.push({ text, estimatedMinutes: minutes });
    total += minutes;
  }
  // One step is a shrink, not a split, and calling it one would promise a plan the learner does not get.
  if (steps.length < 2) return { status: 'unavailable', reason: 'no-split-steps' };
  return { status: 'steps', steps };
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
    instructions: rewrite.steps.map((step) => step.text).join('\n\n'),
    estimatedMinutes: rewrite.estimatedMinutes,
  };
  return {
    ...course,
    microTasks: course.microTasks.map((item, at) => (at === index ? narrowed : item)),
  };
}
