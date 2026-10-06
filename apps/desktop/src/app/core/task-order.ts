/**
 * The renderer's side of the learner's reordering (#23): the gesture, the list the event carries, and
 * the check that the write landed.
 *
 * Reading the order itself — turning `LearningSession.taskOrder` into an order over the tasks that
 * actually exist — lives in `shared-types`, because the checkpoint reads the same rule for "which task
 * comes next" and two implementations would be two plans (#194). Its tests moved there with it.
 *
 * Pure and Angular-free, like `session-plan.ts` next door: the plan's geometry is one of the two
 * things a reorder can get wrong without anything looking broken, so it is unit-tested rather than
 * discovered by dragging things around.
 */

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
