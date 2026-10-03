import type { InterventionAction } from '@focusloop/shared-types';

export type FocusNotice = 'resume' | 'help' | 'time-up';

const FOCUS_ROUTE = '/focus';

/**
 * Product precedence (#77): recover the position before helping with it; an explicit
 * request (or an existing policy suggestion) takes precedence over the clock. Losing
 * candidates remain in their original state — selecting a slot never resolves them.
 */
export function selectFocusNotice(input: {
  readonly resume: boolean;
  readonly rescue: boolean;
  readonly action: InterventionAction | null;
  readonly expired: boolean;
}): FocusNotice | null {
  if (input.resume) return 'resume';
  if (
    input.rescue ||
    (input.action !== null && input.action !== 'NO_ACTION' && input.action !== 'RESUME')
  )
    return 'help';
  return input.expired ? 'time-up' : null;
}

export interface FocusNoticeFold {
  readonly sessionId: string | null;
  readonly folded: boolean;
}

export function noticeIsFolded(fold: FocusNoticeFold, sessionId: string | null): boolean {
  return sessionId !== null && fold.sessionId === sessionId && fold.folded;
}

/**
 * Whether a URL is the focus route, where the notice replaces the global agent panel and the modal
 * resume card. Segments, not a bare prefix: `/focus-roundup` is a different screen, and `;` is part
 * of the path for Angular's matrix parameters. Returning false there would render both surfaces at
 * once, which is exactly the duplication this route exists to remove.
 */
export function isFocusRoute(url: string): boolean {
  if (url === FOCUS_ROUTE) return true;
  return ['/', '?', '#', ';'].some((separator) => url.startsWith(FOCUS_ROUTE + separator));
}
