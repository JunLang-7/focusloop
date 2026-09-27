import { describe, expect, it } from 'vitest';
import { resolvePanelPlacement } from './panel-placement';

/** The gap the panel keeps from the control it is anchored to, in CSS: `calc(100% + 8px)`. */
const GAP = 8;

/** The window height the report's screenshots came from — short enough that the tutor panel ran off it. */
const VIEWPORT = 733;

describe('resolvePanelPlacement', () => {
  it('opens below when the panel fits under the anchor', () => {
    expect(resolvePanelPlacement({ top: 100, bottom: 125 }, 320, VIEWPORT, GAP)).toBe('below');
  });

  it('opens above when the anchor sits near the bottom edge', () => {
    // The focus screen: the entry button ends at y=616 in a 733px window, so there are
    // 733 - 616 - 8 = 109px under it for a panel that is 320px tall, and 608px above it.
    expect(resolvePanelPlacement({ top: 592, bottom: 616 }, 320, VIEWPORT, GAP)).toBe('above');
  });

  it('counts the gap against the side it is measuring', () => {
    // Exactly fits below: 733 - 400 - 8 = 325.
    expect(resolvePanelPlacement({ top: 360, bottom: 400 }, 325, VIEWPORT, GAP)).toBe('below');
    // One pixel too tall for that, and far less room above — so it stays below, where it is less cut off.
    expect(resolvePanelPlacement({ top: 20, bottom: 400 }, 326, VIEWPORT, GAP)).toBe('below');
  });

  it('opens above when only above has room', () => {
    // 492px above the anchor, 25px below, for a 480px panel.
    expect(resolvePanelPlacement({ top: 500, bottom: 700 }, 480, VIEWPORT, GAP)).toBe('above');
  });

  it('picks the roomier side when neither side fits', () => {
    // A panel taller than either gap: 392px above against 275px below.
    expect(resolvePanelPlacement({ top: 400, bottom: 450 }, 800, VIEWPORT, GAP)).toBe('above');
    // The same panel anchored high: 42px above against 625px below.
    expect(resolvePanelPlacement({ top: 50, bottom: 100 }, 800, VIEWPORT, GAP)).toBe('below');
  });

  it('opens below when the panel has not been measured yet', () => {
    // Height 0 is the "no layout yet" case, and below is the direction it opened in before.
    expect(resolvePanelPlacement({ top: 100, bottom: 125 }, 0, VIEWPORT, GAP)).toBe('below');
    /*
     * Including when the anchor is off the bottom of the window, where the roomier-side branch would
     * otherwise answer "above" for a panel it has not measured.
     */
    expect(resolvePanelPlacement({ top: 700, bottom: 760 }, 0, VIEWPORT, GAP)).toBe('below');
  });
});
