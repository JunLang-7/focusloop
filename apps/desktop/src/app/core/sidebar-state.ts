/**
 * The sidebar's collapse mode.
 *
 * Three states, because two are not enough. `visible`/`hidden` cannot express the
 * difference between "the user closed it" and "focus closed it", and only the first of
 * those should survive the focus session ending:
 *
 * - `auto` — the user has not spoken. The sidebar is visible, except while a focus
 *   commitment is running, when the whole shell yields to the single task.
 * - `collapsed` — the user closed it. It stays closed on every screen, focus included.
 * - `open` — the user recalled it through the floating button. It stays open even in
 *   focus mode, until the focus screen is left, and then falls back to `auto`.
 *
 * The arithmetic is here, as pure functions, so the transitions are unit-tested instead
 * of being discovered by clicking around the shell. What is *not* decided here is which
 * phase the focus screen is in: the shell reads that from the DOM (`body:has(...)`),
 * exactly like the focus styling does, so the two cannot disagree.
 */

export type SidebarMode = 'auto' | 'collapsed' | 'open';

/** The mode the shell boots in: nothing has been clicked yet. */
export const SIDEBAR_INITIAL_MODE: SidebarMode = 'auto';

/** The sidebar's own toggle was pressed: hide it everywhere. */
export function collapseSidebar(_mode: SidebarMode): SidebarMode {
  return 'collapsed';
}

/** The floating button was pressed: show it everywhere, focus included. */
export function expandSidebar(_mode: SidebarMode): SidebarMode {
  return 'open';
}

/**
 * The focus screen was left. Only a recall through the floating button is forgotten
 * here; a deliberate `collapsed` survives, because the user asked for that state twice
 * (once by collapsing, once by not reopening).
 */
export function leaveFocusScreen(mode: SidebarMode): SidebarMode {
  return mode === 'open' ? 'auto' : mode;
}

/**
 * Whether the sidebar is out of the layout right now.
 *
 * `focusActive` stands for the shell's chrome policy while the workspace is on screen —
 * `keepsRail` in `core/focus-phase.ts`, which the stylesheet reads off the DOM as
 * `data-rail`; `open` overrides it because a recall is an explicit request for this exact
 * moment.
 */
export function isSidebarHidden(mode: SidebarMode, focusActive: boolean): boolean {
  return mode === 'collapsed' || (focusActive && mode === 'auto');
}
