/**
 * The learner's own ordering of the remaining tasks (#23), and how to read it.
 *
 * The order is a decision rather than a derivation, so it is recorded as an event and stored on the
 * session (`LearningSession.taskOrder`). This module is where that stored hint becomes an order over
 * the tasks that actually exist — and it lives in the contract package because two sides need the same
 * answer and neither can reach the other: the renderer draws the plan from it, and the checkpoint's
 * "which task comes next" is now read from it too (#194). Two implementations of this rule would be
 * two plans, and the disagreement would only show up as the resume card offering something other than
 * the card on screen.
 *
 * Pure and dependency-free, like the rest of this package.
 */

/** The least a task needs for the ordering to be about it. */
interface Identified {
  readonly id: string;
}

/**
 * The tasks the order names, first and in the order it names them, then the rest in the order they
 * arrived.
 *
 * "First, then the rest" rather than "left where they found it" is the honest description, and the
 * difference is visible: an unnamed task sinks below every named one, so a task that was at the top of
 * the course can appear second. That happens in practice, not just on paper - the running task is
 * excluded from the plan, so the stored order never names it, and starting another step puts it back
 * as an unnamed task at the bottom. It is the right trade: the alternative is a merge that pins the
 * unnamed ones to their course indices, and then the row a drag was dropped on is not the row the task
 * ends up in, which is exactly what the drop marker promises.
 *
 * Three things follow from the sentence above, and all three are load-bearing:
 *
 * - It never drops a task. A task the order says nothing about is not a task to hide; it is one the
 *   learner has not moved, so it stays in the list. This is what makes the stored order safe to be
 *   partial - and it will be, because the order only ever names the tasks that were visible when it was
 *   recorded.
 * - It never invents a position. An id in `order` that matches no task is skipped silently, which is
 *   the only reading available: the task is gone (completed, or no longer in the course), and there is
 *   nowhere to put it.
 * - Among themselves, the unnamed tasks keep their course order, and so do the named ones when two of
 *   them are compared. The sort is stable, so two tasks cannot swap places because of a comparison that
 *   was never asked for.
 *
 * The rank is taken from the *first* mention of an id, so a stored order that names one task twice
 * still means exactly one thing rather than depending on which duplicate the search found first.
 *
 * **What this rule cannot do** is worth saying out loud, because it is why the checkpoint's step number
 * is not read from it: the plan excludes the running task, so the order has no place to put the task
 * the checkpoint is about. It answers "which task comes next", never "where does this one sit".
 */
export function applyTaskOrder<T extends Identified>(
  tasks: readonly T[],
  order: readonly string[],
): readonly T[] {
  if (order.length === 0 || tasks.length === 0) return tasks;

  const rank = new Map<string, number>();
  order.forEach((id, index) => {
    if (!rank.has(id)) rank.set(id, index);
  });

  const placed: { task: T; rank: number }[] = [];
  const untouched: T[] = [];
  for (const task of tasks) {
    const at = rank.get(task.id);
    if (at === undefined) untouched.push(task);
    else placed.push({ task, rank: at });
  }

  if (placed.length === 0) return tasks;
  // Stable, so two tasks that share a rank cannot swap - the `placed` order decides, and that order is
  // the course's.
  placed.sort((left, right) => left.rank - right.rank);
  return [...placed.map((entry) => entry.task), ...untouched];
}
