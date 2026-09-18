/**
 * Focus handling for a modal surface.
 *
 * `aria-modal="true"` is a promise that the rest of the page is inert. Without moving focus
 * in, keeping Tab inside, and putting focus back on close, the promise is false: a keyboard
 * user lands on the page behind the overlay, cannot reach the dialog's own buttons, and has
 * no way to close it.
 *
 * The arithmetic is here, as pure functions, so the wrap-around is unit-tested instead of
 * being discovered by tabbing around a window.
 */

/**
 * What a Tab keystroke can reach, in document order.
 *
 * `tabindex="-1"` is excluded deliberately: it means "focusable by script", which is how the
 * dialog container itself is reachable without becoming a stop in the Tab order.
 */
export const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/** The focusable elements inside a container, in document order. */
export function focusableWithin(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) => !element.hasAttribute('hidden') && element.getAttribute('aria-hidden') !== 'true',
  );
}

/**
 * Where a Tab keystroke lands, wrapping at both ends.
 *
 * `current` is `-1` when focus is on the container itself rather than on one of its
 * controls, which is where a dialog starts. Returns `-1` for an empty dialog, so the caller
 * can leave the keystroke alone rather than swallowing it.
 */
export function nextIndex(current: number, count: number, backwards: boolean): number {
  if (count <= 0) return -1;
  if (current < 0) return backwards ? count - 1 : 0;
  const step = backwards ? -1 : 1;
  return (current + step + count) % count;
}
