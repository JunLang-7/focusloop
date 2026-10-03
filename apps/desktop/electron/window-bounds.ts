import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Window geometry, kept away from Electron so the rules can be tested without launching anything.
 *
 * Two jobs live here: validating what was stored (a hand-edited or truncated record must not produce a
 * zero-sized or unreachable window), and deciding whether a stored position is still worth honouring
 * (a second monitor that is no longer attached must not park the window off every display).
 */

export interface WindowBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface WindowState extends WindowBounds {
  readonly maximized: boolean;
}

/** A display's usable rectangle, in the shape Electron reports it (`Display.workArea`). */
export interface WorkArea {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Matches the window's own minimums, so a stored size can never ask for something smaller. */
export const WINDOW_MINIMUM = { width: 960, height: 640 } as const;

/**
 * A ceiling for a *stored* value, not a policy on what a user may resize to: anything larger is a
 * hand-edited record. What actually bounds it is Windows' ±32767 virtual-screen range, and that applies
 * to a stored *position* as much as to a size. No legitimate record comes close - the largest display a
 * machine reports today is an 8K panel at roughly 7680 DIP - so this rejects only nonsense.
 */
const MAXIMUM_PLAUSIBLE = 32_000;

function plausibleInteger(value: unknown, minimum: number): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= minimum &&
    value <= MAXIMUM_PLAUSIBLE
  );
}

/**
 * A stored state, or `null` when any part of it is unusable. Rejecting the whole record rather than
 * salvaging fields is deliberate: a half-trusted rectangle is how a window ends up 0×0 in a corner.
 */
export function parseWindowState(value: unknown): WindowState | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  const { x, y, width, height, maximized } = record;
  if (typeof maximized !== 'boolean') return null;
  if (!plausibleInteger(width, WINDOW_MINIMUM.width)) return null;
  if (!plausibleInteger(height, WINDOW_MINIMUM.height)) return null;
  // A position may be negative - a display left of the primary has negative coordinates - but never
  // further out than the size ceiling, and never fractional.
  if (!plausibleInteger(x, -MAXIMUM_PLAUSIBLE)) return null;
  if (!plausibleInteger(y, -MAXIMUM_PLAUSIBLE)) return null;
  return { x, y, width, height, maximized };
}

/** Whether any part of the rectangle lands inside a display's usable area. */
export function intersectsAnyWorkArea(
  bounds: WindowBounds,
  workAreas: readonly WorkArea[],
): boolean {
  return workAreas.some(
    (area) =>
      bounds.x < area.x + area.width &&
      bounds.x + bounds.width > area.x &&
      bounds.y < area.y + area.height &&
      bounds.y + bounds.height > area.y,
  );
}

/**
 * The tightest room among the attached displays, per dimension.
 *
 * Minimising by *area* would not do, and is worth spelling out because it looks equivalent: a portrait
display beside a landscape one is the smallest by area while being the *tallest*, so taking both
dimensions from it returns a height that does not fit the wide screen the window actually lands on - the
very failure the clamp exists to prevent. The bound has to hold in each dimension separately for "fits,
centred, on any of them" to be true. With no display reported the minimum is `Infinity` in both, which
leaves the stored size alone: there is nothing to fit to.
 */
function tightestRoom(workAreas: readonly WorkArea[]): { width: number; height: number } {
  return {
    width: Math.min(...workAreas.map((area) => area.width)),
    height: Math.min(...workAreas.map((area) => area.height)),
  };
}

export interface RestoredWindow {
  readonly width: number;
  readonly height: number;
  /** Absent when the stored position is unusable, which is what makes Electron centre the window. */
  readonly x?: number;
  readonly y?: number;
  readonly maximized: boolean;
}

/**
 * What to open with.
 *
 * A position is kept only while it still lands on an attached display. When it does not, the position is
 * dropped rather than clamped, so the window opens centred instead of pinned to the edge of a screen that
 * is gone - and the size is bounded, in each dimension, by the tightest attached display, because that is
 * what turns "centred" into "on screen". When the position is usable, the size is kept exactly as it was,
 * overhang and all.
 *
 * The clamp is the app's own guarantee rather than the platform's, deliberately: Windows does constrain an
 * oversized window by itself, so removing this changes nothing there and there is no end-to-end test that
 * can tell the difference. Not depending on that is the point - the rule is what makes the invariant
 * true on a platform that does not, and it is testable where it lives.
 */
export function restoreWindowBounds(
  stored: WindowState | null,
  workAreas: readonly WorkArea[],
  fallback: { readonly width: number; readonly height: number },
): RestoredWindow {
  if (stored === null) {
    return { width: fallback.width, height: fallback.height, maximized: false };
  }
  const onScreen = intersectsAnyWorkArea(stored, workAreas);
  if (onScreen) {
    return {
      width: stored.width,
      height: stored.height,
      x: stored.x,
      y: stored.y,
      maximized: stored.maximized,
    };
  }
  /*
   * The stored position is unusable, so the window is centred on a display this function cannot name.
   * Bounding each dimension by the tightest attached display is what makes the re-placed window land
   * wholly inside whichever display that turns out to be - wherever that display can hold the window's own
   * minimum at all, which is the one case where no size can: a rectangle no larger than every screen, in
   * each dimension, fits centred on any of them. Without it, a size remembered on a display that is gone
   * can reopen taller than the one it lands on, with its title bar above the top edge and no way to move
   * it.
   *
   * The floor is the window's own minimum. A display smaller than that cannot hold the window whatever
   * this returns - the constructor enforces it anyway - so matching it here keeps the two rules that bound
   * a size from disagreeing, rather than returning a rectangle the window will never have.
   */
  const room = tightestRoom(workAreas);
  return {
    width: Math.max(WINDOW_MINIMUM.width, Math.min(stored.width, room.width)),
    height: Math.max(WINDOW_MINIMUM.height, Math.min(stored.height, room.height)),
    maximized: stored.maximized,
  };
}

/** A missing, unreadable or malformed file is simply "no stored state". */
export function readWindowState(path: string): WindowState | null {
  try {
    return parseWindowState(JSON.parse(readFileSync(path, 'utf8')));
  } catch {
    return null;
  }
}

/** Best effort: a window that cannot record its geometry must still close. */
export function writeWindowState(path: string, state: WindowState): void {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(state)}\n`);
  } catch {
    // Nothing to do and nothing to tell the user: the next launch just opens at the default size.
  }
}
