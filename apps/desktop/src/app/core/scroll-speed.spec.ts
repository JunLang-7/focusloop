import { describe, expect, it } from 'vitest';
import { scrollDistance, WHEEL_SPEED_MULTIPLIER } from './scroll-speed';

describe('application scroll speed', () => {
  it('halves ordinary wheel, line and page deltas', () => {
    expect(WHEEL_SPEED_MULTIPLIER).toBe(0.5);
    expect(scrollDistance({ deltaX: 0, deltaY: 20, deltaMode: 0 })).toEqual({ left: 0, top: 10 });
    expect(scrollDistance({ deltaX: 0, deltaY: 3, deltaMode: 1 })).toEqual({ left: 0, top: 24 });
    expect(scrollDistance({ deltaX: 0, deltaY: 1, deltaMode: 2, page: 650 })).toEqual({
      left: 0,
      top: 325,
    });
  });
  it('keeps Shift as horizontal input while slowing it too', () => {
    expect(scrollDistance({ deltaX: 0, deltaY: 8, deltaMode: 0, shift: true })).toEqual({
      left: 4,
      top: 0,
    });
    expect(scrollDistance({ deltaX: 12, deltaY: 8, deltaMode: 0, shift: true })).toEqual({
      left: 6,
      top: 4,
    });
  });
  it('leaves pinch zoom and modified wheel events untouched', () => {
    expect(scrollDistance({ deltaX: 4, deltaY: 8, deltaMode: 0, ctrl: true })).toBeNull();
  });
  it('rounds one sub-pixel wheel step rather than dropping it', () => {
    expect(scrollDistance({ deltaX: 0, deltaY: 1, deltaMode: 0 })).toEqual({ left: 0, top: 1 });
  });
});
