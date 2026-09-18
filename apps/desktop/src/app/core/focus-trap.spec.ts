import { describe, expect, it } from 'vitest';
import { nextIndex } from './focus-trap';

describe('nextIndex', () => {
  it('walks forward one control at a time', () => {
    expect(nextIndex(0, 3, false)).toBe(1);
    expect(nextIndex(1, 3, false)).toBe(2);
  });

  it('wraps from the last control back to the first', () => {
    expect(nextIndex(2, 3, false)).toBe(0);
    expect(nextIndex(1, 2, false)).toBe(0);
  });

  it('wraps backwards from the first control to the last', () => {
    expect(nextIndex(0, 3, true)).toBe(2);
    expect(nextIndex(2, 3, true)).toBe(1);
  });

  it('enters the dialog at the right end when focus is on the container', () => {
    // The container itself holds focus when the dialog opens, which is not a Tab stop.
    expect(nextIndex(-1, 3, false)).toBe(0);
    expect(nextIndex(-1, 3, true)).toBe(2);
  });

  it('reports nothing to do for a dialog with no controls', () => {
    expect(nextIndex(-1, 0, false)).toBe(-1);
    expect(nextIndex(0, 0, true)).toBe(-1);
  });

  it('stays on a single control rather than escaping the dialog', () => {
    expect(nextIndex(0, 1, false)).toBe(0);
    expect(nextIndex(0, 1, true)).toBe(0);
  });
});
