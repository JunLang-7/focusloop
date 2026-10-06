import { describe, expect, it } from 'vitest';
import { applyTaskOrder } from './task-order';

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
