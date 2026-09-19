import { describe, expect, it } from 'vitest';
import { surfaceWindow, type FocusableWindow } from './window-focus';

/**
 * The fake records what was asked of it, because "it focused the window" is not the whole
 * behaviour: the order and the restraint matter too. A window that is already up should not have
 * `restore` called on it, and a visible one should not be `show`n.
 */
function makeWindow(options: { minimized?: boolean; visible?: boolean } = {}): {
  window: FocusableWindow;
  calls: { restore: number; show: number; focus: number };
} {
  const calls = { restore: 0, show: 0, focus: 0 };
  return {
    calls,
    window: {
      isMinimized: () => options.minimized ?? false,
      restore: () => {
        calls.restore += 1;
      },
      isVisible: () => options.visible ?? true,
      show: () => {
        calls.show += 1;
      },
      focus: () => {
        calls.focus += 1;
      },
    },
  };
}

describe('surfacing the window an earlier launch left behind', () => {
  it('restores a minimised window before focusing it', () => {
    const { window, calls } = makeWindow({ minimized: true });

    expect(surfaceWindow([window])).toBe(true);
    expect(calls).toEqual({ restore: 1, show: 0, focus: 1 });
  });

  it('focuses a window that is already up, and leaves its state alone', () => {
    const { window, calls } = makeWindow();

    expect(surfaceWindow([window])).toBe(true);
    expect(calls).toEqual({ restore: 0, show: 0, focus: 1 });
  });

  it('shows a window that exists but is not on screen', () => {
    const { window, calls } = makeWindow({ visible: false });

    expect(surfaceWindow([window])).toBe(true);
    expect(calls).toEqual({ restore: 0, show: 1, focus: 1 });
  });

  it('restores and shows when the window is both minimised and hidden', () => {
    const { window, calls } = makeWindow({ minimized: true, visible: false });

    surfaceWindow([window]);

    expect(calls).toEqual({ restore: 1, show: 1, focus: 1 });
  });

  it('reports that there was nothing to surface, rather than throwing', () => {
    expect(surfaceWindow([])).toBe(false);
  });

  it('surfaces the first window only, so a second one cannot steal the focus', () => {
    const first = makeWindow();
    const second = makeWindow();

    expect(surfaceWindow([first.window, second.window])).toBe(true);
    expect(second.calls).toEqual({ restore: 0, show: 0, focus: 0 });
  });
});
