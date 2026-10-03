import { describe, expect, it } from 'vitest';
import { applyTaskOrder, dropIndexFor, reorder, sameOrder } from './task-order';

interface Task {
  readonly id: string;
  readonly title: string;
}

function task(id: string): Task {
  return { id, title: `Task ${id}` };
}

describe('applyTaskOrder', () => {
  const tasks = [task('a'), task('b'), task('c'), task('d')];
  const ids = (list: readonly Task[]): string[] => list.map((item) => item.id);

  it('leaves the list alone when nothing has been ordered', () => {
    expect(applyTaskOrder(tasks, [])).toBe(tasks);
  });

  it('puts the named tasks first, in the order they were named', () => {
    expect(ids(applyTaskOrder(tasks, ['c', 'a']))).toEqual(['c', 'a', 'b', 'd']);
  });

  it('puts a task the order says nothing about after the ones it does name', () => {
    // The stored order only ever names the tasks that were on screen when it was recorded, so this is
    // the ordinary case rather than an edge one: `d` was not there, and it is not hidden for it - but
    // it does sink below the named ones, which is why the doc says "then the rest" and not "unmoved".
    expect(ids(applyTaskOrder(tasks, ['b']))).toEqual(['b', 'a', 'c', 'd']);
    expect(ids(applyTaskOrder(tasks, ['c']))).toEqual(['c', 'a', 'b', 'd']);
  });

  it('skips an id that names no task, rather than inventing a place for it', () => {
    expect(ids(applyTaskOrder(tasks, ['zz', 'c']))).toEqual(['c', 'a', 'b', 'd']);
  });

  it('reads a repeated id as one mention', () => {
    expect(ids(applyTaskOrder(tasks, ['c', 'c', 'a']))).toEqual(['c', 'a', 'b', 'd']);
  });

  it('never loses or duplicates a task, whatever the order says', () => {
    const orders = [[], ['a'], ['d', 'c', 'b', 'a'], ['zz'], ['b', 'zz', 'a', 'b']];
    for (const order of orders) {
      const result = applyTaskOrder(tasks, order);
      expect(result).toHaveLength(tasks.length);
      expect([...result].sort((l, r) => l.id.localeCompare(r.id)).map((t) => t.id)).toEqual([
        'a',
        'b',
        'c',
        'd',
      ]);
    }
  });

  it('keeps the course order among the tasks it does not move', () => {
    expect(ids(applyTaskOrder(tasks, ['d']))).toEqual(['d', 'a', 'b', 'c']);
  });

  it('is happy with an empty list of tasks', () => {
    expect(applyTaskOrder([], ['a'])).toEqual([]);
  });
});

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
