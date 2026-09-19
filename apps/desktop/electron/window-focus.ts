/**
 * The slice of a window this needs, and nothing else.
 *
 * `BrowserWindow` satisfies it structurally, and a plain object satisfies it too, which is what
 * keeps the behaviour below testable without starting Electron.
 */
export interface FocusableWindow {
  isMinimized(): boolean;
  restore(): void;
  isVisible(): boolean;
  show(): void;
  focus(): void;
}

/**
 * Surfaces the window an earlier launch left behind.
 *
 * A second launch is a request aimed at the first instance, not a new one — restoring a minimised
 * window and focusing it is what every packaged Windows app does, and leaving the learner with
 * nothing on screen is what #5 is about.
 *
 * The first window only: a second window cannot steal focus from the one the learner was using.
 * Returns whether there was a window to surface, so the "nothing left to show" path — the primary
 * instance is running with no window, which is reachable on macOS with the window closed — is a
 * decision in one place instead of a branch inside the Electron callback.
 */
export function surfaceWindow(windows: readonly FocusableWindow[]): boolean {
  const [first] = windows;
  if (first === undefined) return false;

  if (first.isMinimized()) first.restore();
  if (!first.isVisible()) first.show();
  first.focus();
  return true;
}
