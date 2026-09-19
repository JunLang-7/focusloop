/**
 * Whether the plan panel is open, and what closes it.
 *
 * The panel used to be a `<details>`, so the browser owned its one affordance: the same summary
 * that opened it. Nothing could close it on Escape, on a click elsewhere, or when a step began, and
 * a running task sat behind a floating card (#71).
 *
 * The transitions live here, as a pure function, for the same reason `keepsRail` in
 * `core/focus-phase.ts` and the arithmetic in `core/sidebar-state.ts` do: so they are unit-tested
 * rather than discovered by clicking around the focus screen.
 *
 * Two states are enough here, where the sidebar needed three. `auto` and `collapsed` would describe
 * the same thing for the plan, because the plan does not outlive the screen it is on — there is
 * nowhere for "the user closed it" to be remembered, and the ready phase simply starts closed like
 * every other one. Nothing but a deliberate press opens it.
 */

/**
 * What asked for a change.
 *
 * `start` and `finish` are here because the panel is not the learner's to tidy up: beginning the
 * next step has to uncover it, and so does finishing one.
 */
export type PlanEvent = 'toggle' | 'escape' | 'outside' | 'start' | 'finish';

/** Nothing has been pressed, so the plan is out of the way. */
export const PLAN_INITIAL_OPEN = false;

/** The next open state. Only a press opens it; everything else closes it. */
export function nextPlanOpen(isOpen: boolean, event: PlanEvent): boolean {
  return event === 'toggle' ? !isOpen : false;
}
