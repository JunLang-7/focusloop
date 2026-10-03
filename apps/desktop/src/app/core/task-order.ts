/**
 * The learner's ordering of the remaining tasks (#23).
 *
 * The order is a decision rather than a derivation, so it is recorded as an event and stored on the
 * session (`LearningSession.taskOrder`). This module is where that stored hint becomes an order over
 * the tasks that actually exist, and where "move this row" becomes the list the event carries.
 *
 * Pure and Angular-free, like `session-plan.ts` next door: the plan's geometry and this file's
 * ordering are the two things a reorder can get wrong without anything looking broken, so both are
 * unit-tested rather than discovered by dragging things around.
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

/**
 * Whether the stored order is the one that was asked for.
 *
 * A reorder is only worth announcing if the session ended up in that order. The renderer cannot tell a
 * failed write from a successful one by the call's resolution - `AppStateService.run` catches a failed
 * IPC call and reports it in the banner, so the promise resolves either way - which leaves reading the
 * order back as the only way to know.
 *
 * Length is compared before the elements, because an order that kept its length and lost its sequence
 * is exactly the case this exists for, and it is the one a length-only check would wave through.
 */
export function sameOrder(
  asked: readonly string[],
  stored: readonly string[] | undefined,
): boolean {
  return (
    stored !== undefined &&
    stored.length === asked.length &&
    stored.every((id, index) => id === asked[index])
  );
}

/**
 * The same list with the item at `from` moved to index `to` in the result.
 *
 * "Index `to` in the result" is the whole contract, and it is what makes the drop indicator honest:
 * the row the pointer is over is the row the dragged task ends up occupying.
 *
 * Out-of-range input returns the list unchanged rather than a clamped guess. The caller is a drag that
 * may be cancelled, or a keypress at either end, and both are "nothing happened" - a near-miss quietly
 * becoming an off-by-one move is how a list jumps while the learner is still holding the row.
 */
export function reorder(ids: readonly string[], from: number, to: number): readonly string[] {
  if (from < 0 || from >= ids.length) return ids;
  if (to < 0 || to >= ids.length || to === from) return ids;

  const next = [...ids];
  const moved = next.splice(from, 1)[0];
  if (moved === undefined) return ids;
  next.splice(to, 0, moved);
  return next;
}

/** One row of the plan, as much of it as the drop target needs. */
interface Band {
  readonly offset: number;
  readonly height: number;
}

/**
 * Which row a pointer at `y` (measured from the top of the track) is over.
 *
 * The plan's blocks tile the track, so exactly one row contains any point inside it. Outside it the
 * answer is the first or the last row, not "none": a pointer that has left the track while still
 * holding a row is a drag in progress, and a target that vanishes at the edges is how a drag ends up
 * silently doing nothing.
 *
 * `null` only for a plan with no rows, where there is nothing to be over.
 */
export function dropIndexFor(bands: readonly Band[], y: number): number | null {
  if (bands.length === 0) return null;

  for (let index = 0; index < bands.length; index += 1) {
    const band = bands[index];
    if (band === undefined) continue;
    if (y < band.offset + band.height) return index;
  }

  return bands.length - 1;
}
