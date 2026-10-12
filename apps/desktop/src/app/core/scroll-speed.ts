/**
 * One app-wide wheel tuning knob.
 *
 * FocusLoop inherits Chromium's pixel deltas, which feel fast on the compact
 * Settings panes and the long Dashboard scrollports. Halving them keeps the
 * native gesture and its accumulation (including trackpad) while slowing every
 * page, not only this dialog. Ctrl+wheel is returned untouched for pinch zoom.
 */
export const WHEEL_SPEED_MULTIPLIER = 0.5;
const LINE_HEIGHT = 16;

export interface ScrollDelta {
  readonly deltaX: number;
  readonly deltaY: number;
  readonly deltaMode: number;
  readonly shift?: boolean;
  readonly ctrl?: boolean;
  readonly page?: number;
}

export interface ScrollDistance {
  readonly left: number;
  readonly top: number;
}

/** Convert a WheelEvent into pixels, with Shift acting as the horizontal axis. */
export function scrollDistance(delta: ScrollDelta): ScrollDistance | null {
  if (delta.ctrl === true) return null;
  let scale = 1;
  if (delta.deltaMode === 1) scale = LINE_HEIGHT;
  else if (delta.deltaMode === 2) scale = delta.page ?? 0;
  const horizontalShift = delta.shift === true && delta.deltaX === 0;
  const left = horizontalShift ? delta.deltaY : delta.deltaX;
  const top = horizontalShift ? 0 : delta.deltaY;
  const pixels = (value: number): number => {
    const scaled = Math.round(value * scale * WHEEL_SPEED_MULTIPLIER);
    if (scaled !== 0 || value === 0) return scaled;
    return Math.sign(value);
  };
  return { left: pixels(left), top: pixels(top) };
}

const hasScrollableOverflow = (style: string): boolean => /^(auto|scroll|overlay)$/.test(style);

/**
 * Apply the slower wheel pace to every scrollport in the renderer.
 *
 * Runs outside Angular: this is browser input plumbing, not application state.
 * The walk mirrors native wheel chaining — the innermost scrollport that can
 * still move takes the event, and reaching its end continues outward instead
 * of stopping there. When nothing can move the event is left alone.
 */
export function installScrollSpeed(document: Document): () => void {
  const window = document.defaultView;
  if (window === null) return () => undefined;
  const wheel = (event: WheelEvent): void => {
    if (event.defaultPrevented) return;
    const target = event.target instanceof window.Element ? event.target : null;
    for (let current = target; current !== null; current = current.parentElement) {
      const style = window.getComputedStyle(current);
      const vertical =
        hasScrollableOverflow(style.overflowY) && current.scrollHeight > current.clientHeight + 1;
      const horizontal =
        hasScrollableOverflow(style.overflowX) && current.scrollWidth > current.clientWidth + 1;
      if (!vertical && !horizontal) continue;
      const distance = scrollDistance({
        deltaX: event.deltaX,
        deltaY: event.deltaY,
        deltaMode: event.deltaMode,
        shift: event.shiftKey,
        ctrl: event.ctrlKey,
        page: Math.max(current.clientHeight, current.clientWidth),
      });
      if (distance === null) return;
      const beforeTop = current.scrollTop;
      const beforeLeft = current.scrollLeft;
      current.scrollBy({ ...distance, behavior: 'instant' });
      if (current.scrollTop !== beforeTop || current.scrollLeft !== beforeLeft) {
        event.preventDefault();
        return;
      }
    }
  };
  document.addEventListener('wheel', wheel, { capture: true, passive: false });
  return () => document.removeEventListener('wheel', wheel, true);
}
