import type { StuckReason } from '@focusloop/shared-types';

/**
 * The payload the help control sends, as a plain function.
 *
 * Here rather than in the component because the component cannot be unit-tested: this app runs its
 * tests in a `node` environment with no TestBed, so a page's methods are only reachable by launching
 * Electron. That is the right trade for layout and the wrong one for this — the payload built here is
 * the *only* producer of the reason this whole slice exists to act on, and it sat in a template
 * callback where deleting the reason left every suite green. Pulling it out is what makes it
 * falsifiable without a window; the button that calls it is covered in `apps/desktop-e2e`, where it
 * is actually pressed.
 */

/**
 * The payload for the help request.
 *
 * A `null` reason means the learner would rather not say, and the field is left out entirely rather
 * than sent as `null`: an absent reason is what "they did not say" has always meant in the event log,
 * and an event written before the reasons existed reads the same way.
 */
export function helpRequestPayload(
  taskId: string,
  reason: StuckReason | null,
): { taskId: string; reason?: StuckReason } {
  return reason === null ? { taskId } : { taskId, reason };
}
