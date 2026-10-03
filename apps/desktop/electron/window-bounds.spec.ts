import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  WINDOW_MINIMUM,
  intersectsAnyWorkArea,
  parseWindowState,
  readWindowState,
  restoreWindowBounds,
  writeWindowState,
} from './window-bounds';

const PRIMARY = { x: 0, y: 0, width: 1920, height: 1040 };
/** A second display to the left of the primary, which is what gives work areas negative coordinates. */
const LEFT_HAND = { x: -1280, y: 0, width: 1280, height: 1024 };
const FALLBACK = { width: 1280, height: 840 };

const validState = { x: 100, y: 60, width: 1440, height: 900, maximized: false };

const temporaryDirectories: string[] = [];
function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'focusloop-window-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    rmSync(temporaryDirectories.pop()!, { recursive: true, force: true });
  }
});

describe('parseWindowState', () => {
  it('accepts a record this app wrote', () => {
    expect(parseWindowState(validState)).toEqual(validState);
    expect(parseWindowState({ ...validState, maximized: true })).toEqual({
      ...validState,
      maximized: true,
    });
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a string', '1280x840'],
    ['a number', 840],
    ['an empty object', {}],
    ['a missing position', { width: 1280, height: 840, maximized: false }],
    ['a missing flag', { x: 0, y: 0, width: 1280, height: 840 }],
    ['a fractional coordinate', { ...validState, x: 10.5 }],
    ['a fractional size', { ...validState, width: 1440.25 }],
    ['NaN', { ...validState, width: Number.NaN }],
    ['Infinity', { ...validState, height: Number.POSITIVE_INFINITY }],
    ['a zero width', { ...validState, width: 0 }],
    ['a zero height', { ...validState, height: 0 }],
    ['a negative width', { ...validState, width: -1440 }],
    ['a size below the window minimum', { ...validState, width: WINDOW_MINIMUM.width - 1 }],
    ['an absurd size', { ...validState, width: 100_000 }],
    ['a stringified flag', { ...validState, maximized: 'true' }],
    ['a stringified size', { ...validState, width: '1440' }],
  ])('rejects %s rather than half-trusting it', (_label, value) => {
    expect(parseWindowState(value)).toBeNull();
  });
});

describe('intersectsAnyWorkArea', () => {
  it('accepts a rectangle inside, overlapping, or on a display to the left', () => {
    expect(intersectsAnyWorkArea({ x: 0, y: 0, width: 1280, height: 840 }, [PRIMARY])).toBe(true);
    expect(
      intersectsAnyWorkArea({ x: 1900, y: 1000, width: 1280, height: 840 }, [PRIMARY, LEFT_HAND]),
    ).toBe(true);
    expect(intersectsAnyWorkArea({ x: -800, y: 100, width: 1200, height: 800 }, [PRIMARY])).toBe(
      true,
    );
    expect(
      intersectsAnyWorkArea({ x: -1200, y: 0, width: 1280, height: 1024 }, [PRIMARY, LEFT_HAND]),
    ).toBe(true);
  });

  it('rejects a rectangle that no longer touches any display', () => {
    // The second monitor was detached, and the coordinates it used to occupy are now empty space.
    expect(intersectsAnyWorkArea({ x: 2400, y: 0, width: 1280, height: 840 }, [PRIMARY])).toBe(
      false,
    );
    expect(intersectsAnyWorkArea({ x: 0, y: -5000, width: 1280, height: 840 }, [PRIMARY])).toBe(
      false,
    );
  });

  it('does not count a rectangle that only touches an edge, because that is zero visible pixels', () => {
    expect(intersectsAnyWorkArea({ x: 1920, y: 0, width: 1280, height: 840 }, [PRIMARY])).toBe(
      false,
    );
  });

  it('has nothing to intersect when no display is reported', () => {
    expect(intersectsAnyWorkArea({ x: 0, y: 0, width: 1280, height: 840 }, [])).toBe(false);
  });
});

describe('restoreWindowBounds', () => {
  it('centres at the default size when nothing was stored', () => {
    expect(restoreWindowBounds(null, [PRIMARY], FALLBACK)).toEqual({
      width: FALLBACK.width,
      height: FALLBACK.height,
      maximized: false,
    });
  });

  it('keeps a size and position that are still on a display', () => {
    expect(restoreWindowBounds(validState, [PRIMARY], FALLBACK)).toEqual({
      width: 1440,
      height: 900,
      x: 100,
      y: 60,
      maximized: false,
    });
  });

  it('drops only the position when the display it was on is gone', () => {
    const away = { x: 2400, y: 200, width: 1440, height: 900, maximized: false };
    expect(restoreWindowBounds(away, [PRIMARY], FALLBACK)).toEqual({
      width: 1440,
      height: 900,
      maximized: false,
    });
  });

  it('keeps a position on a display that is still attached, including negative coordinates', () => {
    const leftHand = { x: -1200, y: 0, width: 1280, height: 1024, maximized: false };
    expect(restoreWindowBounds(leftHand, [PRIMARY, LEFT_HAND], FALLBACK)).toEqual({
      width: 1280,
      height: 1024,
      x: -1200,
      y: 0,
      maximized: false,
    });
  });

  it('carries the maximised flag through, with the size to return to', () => {
    expect(restoreWindowBounds({ ...validState, maximized: true }, [PRIMARY], FALLBACK)).toEqual({
      width: 1440,
      height: 900,
      x: 100,
      y: 60,
      maximized: true,
    });
  });

  /*
   * The size bound exists only for the case where the app has to place the window itself. "Centred" is
   * not the same as "on screen": a window taller than the display it is centred on has its top-left above
   * the top edge, so its title bar cannot be grabbed and the learner cannot move it. Bounding each
   * dimension by the tightest attached display is what makes a re-placed window land wholly inside
   * whichever display it opens on - a rectangle no larger than every screen, in each dimension, fits
   * centred on any of them.
   *
   * Each dimension separately, not by picking the smallest display by area: a portrait screen beside a
   * landscape one is the narrower of the two while being the taller, so taking both dimensions from it
   * returns a height that does not fit the screen the window lands on. The cases below pin that (see
   * "bounds each dimension separately"), and they are the evidence; the neighbouring ones guard the branches
   * that keep a fitting size or invent no bound with nothing to fit to.
   */
  describe('when the stored position is unusable', () => {
    const away = { x: 20_000, y: 20_000, maximized: false };

    it('clamps a size larger than the display it will land on', () => {
      expect(
        restoreWindowBounds({ ...away, width: 3000, height: 1900 }, [PRIMARY], FALLBACK),
      ).toEqual({ width: PRIMARY.width, height: PRIMARY.height, maximized: false });
    });

    it('clamps to the smallest attached display, not the largest', () => {
      expect(
        restoreWindowBounds({ ...away, width: 3000, height: 1900 }, [PRIMARY, LEFT_HAND], FALLBACK),
      ).toEqual({ width: LEFT_HAND.width, height: LEFT_HAND.height, maximized: false });
    });

    it('bounds each dimension separately, so a portrait display cannot set the height', () => {
      /*
       * The decisive case. A laptop beside a rotated external, where the portrait display is smaller by
       * *area* while being the *taller* of the two: taking both dimensions from it returns a height that
       * overflows the screen the window actually lands on, which is the failure the bound exists to
       * prevent. The bound has to hold in each dimension independently.
       */
      const laptop = { x: 0, y: 0, width: 2560, height: 1400 };
      const portrait = { x: 2560, y: 0, width: 1200, height: 1920 };
      expect(
        restoreWindowBounds({ ...away, width: 3000, height: 1900 }, [laptop, portrait], FALLBACK),
      ).toEqual({ width: 1200, height: 1400, maximized: false });
    });

    it('never returns a size below the window\u2019s own minimum', () => {
      // A display smaller than the minimum cannot hold the window whatever this returns, and the
      // constructor enforces its own floor anyway - so this returns that floor rather than a rectangle the
      // window will never have.
      const tiny = { x: 0, y: 0, width: 800, height: 600 };
      expect(restoreWindowBounds({ ...away, width: 3000, height: 1900 }, [tiny], FALLBACK)).toEqual(
        {
          width: WINDOW_MINIMUM.width,
          height: WINDOW_MINIMUM.height,
          maximized: false,
        },
      );
    });

    it('leaves a size that already fits the tightest display alone', () => {
      expect(
        restoreWindowBounds({ ...away, width: 1200, height: 800 }, [PRIMARY, LEFT_HAND], FALLBACK),
      ).toEqual({ width: 1200, height: 800, maximized: false });
    });

    it('does not invent a clamp when no display is reported', () => {
      // Nothing to fit to, so the stored size stands rather than being guessed down to the fallback.
      expect(restoreWindowBounds({ ...away, width: 3000, height: 1900 }, [], FALLBACK)).toEqual({
        width: 3000,
        height: 1900,
        maximized: false,
      });
    });

    it('still honours the maximised flag it clamped around', () => {
      expect(
        restoreWindowBounds(
          { ...away, width: 3000, height: 1900, maximized: true },
          [PRIMARY],
          FALLBACK,
        ),
      ).toEqual({ width: PRIMARY.width, height: PRIMARY.height, maximized: true });
    });
  });

  it('keeps a usable position even when the window overhangs the display', () => {
    // A position the learner chose and that still touches a display is theirs to keep, overhang and all -
    // only a size the app has to place itself gets clamped.
    const overhanging = { x: 1800, y: 0, width: 3000, height: 1900, maximized: false };
    expect(restoreWindowBounds(overhanging, [PRIMARY], FALLBACK)).toEqual({
      width: 3000,
      height: 1900,
      x: 1800,
      y: 0,
      maximized: false,
    });
  });
});

describe('the stored file', () => {
  it('round-trips, and treats anything unreadable as "no stored state"', () => {
    const path = join(temporaryDirectory(), 'window-state.json');
    expect(readWindowState(path)).toBeNull();

    writeWindowState(path, { ...validState, maximized: true });
    expect(readWindowState(path)).toEqual({ ...validState, maximized: true });

    writeFileSync(path, '{ this is not json');
    expect(readWindowState(path)).toBeNull();

    writeFileSync(path, JSON.stringify({ width: 0, height: 0, maximized: true }));
    expect(readWindowState(path)).toBeNull();
  });

  it('creates the directory it needs and never throws when it cannot write', () => {
    const nested = join(temporaryDirectory(), 'nested', 'deeper', 'window-state.json');
    writeWindowState(nested, validState);
    expect(readWindowState(nested)).toEqual(validState);

    // A directory where the file should be is unwritable; closing a window must still succeed.
    expect(() => writeWindowState(temporaryDirectory(), validState)).not.toThrow();
  });
});
