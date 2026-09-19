/**
 * The phases of the focus workspace, and the shell-chrome policy that goes with them.
 *
 * This lives outside the page component so the policy can be tested without rendering Angular.
 * `FocusPage.phase()` is derived from the session snapshot and the local timer; the question of
 * which of those phases should narrow the shell is a product decision, and it is this one.
 */

export type FocusPhase = 'ready' | 'active' | 'paused' | 'expired' | 'complete';

/**
 * Whether the shell narrows to a rail while this phase is on screen.
 *
 * `ready` keeps the full chrome: no commitment has been made yet, so the learner is still
 * choosing and the navigation is still theirs to use.
 *
 * Every other phase keeps the rail, including the two that used to drop it. `expired` is the
 * moment the timer runs out with the task unfinished, and `complete` is the confirmation that
 * follows a finished step. Both are moments where the design asks for one task and no
 * statistics: the rail came back at exactly the point the next action is the only useful thing
 * on screen, putting the Today summary, the language switch and the theme switch back in front
 * of someone who had just been asked to keep going.
 */
export function keepsRail(phase: FocusPhase): boolean {
  return phase !== 'ready';
}
