import { describe, expect, it } from 'vitest';
import { dropIndexFor, reorder, sameOrder } from './task-order';

describe('reorder', () => {
  const ids = ['a', 'b', 'c', 'd'];

  it('moves a task down to the index it was given', () => {
    // The contract the drop indicator draws: the row the pointer is over is the row the task ends up in.
    expect(reorder(ids, 0, 2)).toEqual(['b', 'c', 'a', 'd']);
  });

  it('moves a task up to the index it was given', () => {
    expect(reorder(ids, 3, 1)).toEqual(['a', 'd', 'b', 'c']);
  });

  it('is the same list when the target is where the task already is', () => {
    expect(reorder(ids, 2, 2)).toBe(ids);
  });

  it.each([
    ['a target past the end', 0, 4],
    ['a negative target', 1, -1],
    ['a source past the end', 4, 0],
    ['a negative source', -1, 0],
  ])('is the same list for %s', (_name, from, to) => {
    // A drag can be cancelled and an arrow key can be pressed at either end. Both are "nothing
    // happened", and a near-miss quietly becoming a move is how a row jumps under the learner's hand.
    expect(reorder(ids, from, to)).toBe(ids);
  });

  it('keeps every task exactly once', () => {
    for (let from = 0; from < ids.length; from += 1) {
      for (let to = 0; to < ids.length; to += 1) {
        const result = reorder(ids, from, to);
        expect([...result].sort(), `${from} -> ${to}`).toEqual([...ids].sort());
      }
    }
  });

  it('does not mutate the list it was given', () => {
    const before = [...ids];
    reorder(ids, 0, 3);
    expect(ids).toEqual(before);
  });
});

describe('dropIndexFor', () => {
  const bands = [
    { offset: 0, height: 34 },
    { offset: 34, height: 100 },
    { offset: 134, height: 50 },
  ];

  it('finds the row a point inside it is over', () => {
    expect(dropIndexFor(bands, 0)).toBe(0);
    expect(dropIndexFor(bands, 33)).toBe(0);
    expect(dropIndexFor(bands, 34)).toBe(1);
    expect(dropIndexFor(bands, 133)).toBe(1);
    expect(dropIndexFor(bands, 183)).toBe(2);
  });

  it('reads a boundary as the row that starts there', () => {
    // The blocks tile the column, so a point on the seam belongs to exactly one row and the test has to
    // say which: the one whose top edge it is, not the one whose bottom edge it was.
    expect(dropIndexFor(bands, 34)).toBe(1);
    expect(dropIndexFor(bands, 134)).toBe(2);
  });

  it('clamps past either end, because a drag that has left the track still has a target', () => {
    expect(dropIndexFor(bands, -500)).toBe(0);
    expect(dropIndexFor(bands, 100_000)).toBe(2);
  });

  it('has no row to be over when the plan is empty', () => {
    expect(dropIndexFor([], 10)).toBeNull();
  });
});

describe('sameOrder', () => {
  it('is true for the order that was asked for', () => {
    expect(sameOrder(['b', 'a'], ['b', 'a'])).toBe(true);
    expect(sameOrder([], [])).toBe(true);
  });

  it('is false when the same tasks came back in a different sequence', () => {
    // The case the whole check exists for: a write that kept its length and lost its order. A check
    // that compared lengths alone would call this equal and announce a move that did not happen.
    expect(sameOrder(['b', 'a'], ['a', 'b'])).toBe(false);
  });

  it('is false for a different set or a different length', () => {
    expect(sameOrder(['b', 'a'], ['b'])).toBe(false);
    expect(sameOrder(['b'], ['b', 'a'])).toBe(false);
    expect(sameOrder(['c', 'b'], ['b', 'a'])).toBe(false);
  });

  it('is false when there is no stored order at all', () => {
    // Undefined is "this session has never been reordered", which is not the order that was asked for.
    expect(sameOrder(['b', 'a'], undefined)).toBe(false);
    expect(sameOrder([], undefined)).toBe(false);
  });
});
