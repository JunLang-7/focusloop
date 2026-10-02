import type { InterventionAction } from '@focusloop/shared-types';

export type FocusNotice = 'resume' | 'help' | 'time-up';

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
