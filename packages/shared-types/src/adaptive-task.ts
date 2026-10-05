/** Bounds for suggestions, not permissions to mutate the learner's plan. */
export const ADAPTIVE_TASK_LIMITS = {
  idCharacters: 256,
  focusCharacters: 600,
  minMinutes: 1,
  maxMinutes: 5,
  preferredShrinkMinutes: 2,
  /** Only inspect a bounded prefix of concept evidence, never an entire course. */
  keyPoints: 6,
} as const;

export type AdaptiveTaskFocus =
  | { readonly source: 'concept-key-point'; readonly index: number; readonly text: string }
  | { readonly source: 'material-sentence'; readonly text: string };

/** A suggestion only. Execution requires a separately confirmed, live-state-bound proposal. */
export interface AdaptiveTaskDraft {
  readonly operation: 'SHRINK_TASK';
  readonly sessionId: string;
  readonly sourceTaskId: string;
  readonly conceptId: string;
  readonly sourceEstimatedMinutes: number;
  readonly estimatedMinutes: number;
  readonly focus: AdaptiveTaskFocus;
  readonly requiresConfirmation: true;
}

/** Shape validation does not authorize execution or prove grounding against a live context. */
export function isAdaptiveTaskDraft(value: unknown): value is AdaptiveTaskDraft {
  try {
    const draft = dataRecord(value, [
      'operation',
      'sessionId',
      'sourceTaskId',
      'conceptId',
      'sourceEstimatedMinutes',
      'estimatedMinutes',
      'focus',
      'requiresConfirmation',
    ]);
    if (
      draft === null ||
      draft['operation'] !== 'SHRINK_TASK' ||
      draft['requiresConfirmation'] !== true
    )
      return false;
    if (
      !['sessionId', 'sourceTaskId', 'conceptId'].every((field) =>
        boundedText(draft[field], ADAPTIVE_TASK_LIMITS.idCharacters),
      )
    )
      return false;
    const before = draft['sourceEstimatedMinutes'];
    const after = draft['estimatedMinutes'];
    if (
      typeof before !== 'number' ||
      !Number.isFinite(before) ||
      typeof after !== 'number' ||
      !Number.isFinite(after) ||
      after < ADAPTIVE_TASK_LIMITS.minMinutes ||
      after > ADAPTIVE_TASK_LIMITS.maxMinutes ||
      after >= before
    )
      return false;
    const point = dataRecord(draft['focus'], ['source', 'index', 'text'], false);
    if (point === null || !boundedText(point['text'], ADAPTIVE_TASK_LIMITS.focusCharacters))
      return false;
    if (point['source'] === 'material-sentence')
      return Object.keys(point).length === 2 && !Object.hasOwn(point, 'index');
    return (
      point['source'] === 'concept-key-point' &&
      Object.keys(point).length === 3 &&
      typeof point['index'] === 'number' &&
      Number.isInteger(point['index']) &&
      point['index'] >= 0 &&
      point['index'] < ADAPTIVE_TASK_LIMITS.keyPoints
    );
  } catch {
    // Hostile non-JSON objects (e.g. throwing proxy traps) are not contract data.
    return false;
  }
}

function boundedText(value: unknown, limit: number): value is string {
  // Reject oversized UTF-16 input before allocating the bounded code-point array.
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= limit * 2 &&
    value === value.trim() &&
    [...value].length <= limit
  );
}

/** Copy own enumerable DATA properties only; validation must not invoke executable accessors. */
function dataRecord(
  value: unknown,
  allowed: readonly string[],
  exact = true,
): Record<string, unknown> | null {
  if (value === null || typeof value !== 'object') return null;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return null;
  const keys = Reflect.ownKeys(value);
  if (keys.length > allowed.length || (exact && keys.length !== allowed.length)) return null;
  const result: Record<string, unknown> = Object.create(null);
  for (const key of keys) {
    if (typeof key !== 'string' || !allowed.includes(key)) return null;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value'))
      return null;
    result[key] = descriptor.value;
  }
  return result;
}

/**
 * The applied form of a suggestion: the task as the learner sees it while a rescue is active.
 *
 * Presentation only, and bounded the same way a draft is. The stored course, the learner's own task
 * and the task's minutes in the course are untouched, so the full task is what comes back the moment
 * the rewrite stops applying — which is why there is no undo to get wrong.
 */
export const TASK_REWRITE_ACTIONS = ['MICRO_START', 'SIMPLIFY'] as const;
export type TaskRewriteAction = (typeof TASK_REWRITE_ACTIONS)[number];

export const TASK_REWRITE_LIMITS = {
  /** More steps than a micro task may have minutes would be a split, not a narrowed first step. */
  steps: ADAPTIVE_TASK_LIMITS.maxMinutes,
  stepCharacters: ADAPTIVE_TASK_LIMITS.focusCharacters,
} as const;

export function isTaskRewriteAction(value: unknown): value is TaskRewriteAction {
  return typeof value === 'string' && (TASK_REWRITE_ACTIONS as readonly string[]).includes(value);
}

/** One step of a narrowed task, with the estimate that step alone carries. */
export interface TaskRewriteStep {
  readonly text: string;
  readonly estimatedMinutes: number;
}

export interface TaskRewrite {
  readonly action: TaskRewriteAction;
  readonly taskId: string;
  /** What the learner reads instead of the whole task, front to back. */
  readonly steps: readonly TaskRewriteStep[];
  /**
   * The steps' own total, and checked against them rather than trusted beside them: a rewrite whose
   * summary disagrees with the steps it is made of is a rewrite nobody can reason about.
   */
  readonly estimatedMinutes: number;
  /** The task's own estimate, kept so the narrowing can be shown as a comparison. */
  readonly sourceEstimatedMinutes: number;
}

/**
 * Shape validation does not authorize a rewrite: the engine writes one only from a proposal the
 * learner confirmed, and it is the idempotency key of that proposal that decides whether it applies.
 */
export function isTaskRewrite(value: unknown): value is TaskRewrite {
  try {
    const rewrite = dataRecord(value, [
      'action',
      'taskId',
      'steps',
      'estimatedMinutes',
      'sourceEstimatedMinutes',
    ]);
    if (rewrite === null || !isTaskRewriteAction(rewrite['action'])) return false;
    if (!boundedText(rewrite['taskId'], ADAPTIVE_TASK_LIMITS.idCharacters)) return false;
    const steps = rewrite['steps'];
    if (!Array.isArray(steps)) return false;
    if (steps.length === 0 || steps.length > TASK_REWRITE_LIMITS.steps) return false;
    let total = 0;
    for (const step of steps) {
      const minutes = stepMinutes(step);
      if (minutes === null) return false;
      total += minutes;
    }
    const minutes = rewrite['estimatedMinutes'];
    if (typeof minutes !== 'number' || !Number.isInteger(minutes) || minutes !== total)
      return false;
    const before = rewrite['sourceEstimatedMinutes'];
    if (typeof before !== 'number' || !Number.isFinite(before) || before <= 0) return false;
    // The task's own estimate is not bounded the way a step's is — it is whatever the course says —
    // but it still has to be larger, because a rewrite that is not narrower is not a rewrite.
    return before > total;
  } catch {
    // Hostile non-JSON objects (e.g. throwing proxy traps) are not contract data.
    return false;
  }
}

function stepMinutes(value: unknown): number | null {
  const step = dataRecord(value, ['text', 'estimatedMinutes']);
  if (step === null || !boundedText(step['text'], TASK_REWRITE_LIMITS.stepCharacters)) return null;
  return boundedMinutes(step['estimatedMinutes']);
}

function boundedMinutes(value: unknown): number | null {
  return typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= ADAPTIVE_TASK_LIMITS.minMinutes &&
    value <= ADAPTIVE_TASK_LIMITS.maxMinutes
    ? value
    : null;
}
