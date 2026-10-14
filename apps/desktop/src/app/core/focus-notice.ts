export type FocusNotice = 'resume';

const FOCUS_ROUTE = '/focus';

/**
 * The focus screen's one notice: the position you left, given back when you come back.
 *
 * It used to be a three-way slot — a resume card, the agent's proposal with three quick choices, and an
 * expired-timer offer — and every one of those is still reachable, just not as a strip pinned over the
 * bottom of the screen the learner is working in. The agent's suggestion is drawn in the step it is about
 * (`focus.page.ts`), and an expired timer is answered by the control that already turns into "+1 minute"
 * when the commitment runs out. What is left is the only genuinely *interruptive* case: the learner has
 * just come back from somewhere else and needs their place found for them.
 */
export function selectFocusNotice(input: { readonly resume: boolean }): FocusNotice | null {
  return input.resume ? 'resume' : null;
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
