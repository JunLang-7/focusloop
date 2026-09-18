import { describe, expect, it } from 'vitest';
import type { HelpRequestedEvent, TabLeftEvent } from '@focusloop/shared-types';
import { groupEvents } from './events-view';

/** Fixed instants, so the assertions read in the same order the log does. */
const T1 = '2026-09-18T00:17:04.000Z';
const T2 = '2026-09-18T00:17:05.000Z';
const T3 = '2026-09-18T00:17:06.000Z';

function help(id: string, at: string, source: HelpRequestedEvent['source'] = 'simulator') {
  const event: HelpRequestedEvent = {
    id,
    sessionId: 's1',
    at,
    type: 'HELP_REQUESTED',
    source,
    payload: { taskId: 'rbt-t2' },
  };
  return event;
}

function tabLeft(id: string, at: string): TabLeftEvent {
  return {
    id,
    sessionId: 's1',
    at,
    type: 'TAB_LEFT',
    source: 'simulator',
    payload: { origin: 'example.com' },
  };
}

describe('groupEvents', () => {
  it('folds a run of the same type and source into one row', () => {
    const groups = groupEvents([help('h3', T3), help('h2', T2), help('h1', T1)]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.count).toBe(3);
    expect(groups[0]?.type).toBe('HELP_REQUESTED');
  });

  it('keeps the given order inside the run, and reports both ends of it', () => {
    const groups = groupEvents([help('h3', T3), help('h2', T2), help('h1', T1)]);
    expect(groups[0]?.events.map((event) => event.id)).toEqual(['h3', 'h2', 'h1']);
    expect(groups[0]?.newestAt).toBe(T3);
    expect(groups[0]?.oldestAt).toBe(T1);
  });

  it('does not fold across an unrelated event', () => {
    const groups = groupEvents([help('h2', T3), tabLeft('l1', T2), help('h1', T1)]);
    expect(groups.map((group) => group.type)).toEqual([
      'HELP_REQUESTED',
      'TAB_LEFT',
      'HELP_REQUESTED',
    ]);
    expect(groups.every((group) => group.count === 1)).toBe(true);
  });

  it('keeps two sources apart even when the type is the same', () => {
    const groups = groupEvents([help('h2', T2, 'simulator'), help('h1', T1, 'extension')]);
    expect(groups).toHaveLength(2);
    expect(groups.map((group) => group.source)).toEqual(['simulator', 'extension']);
  });

  it('names a lone event after itself', () => {
    const groups = groupEvents([help('h1', T1)]);
    expect(groups[0]?.count).toBe(1);
    expect(groups[0]?.newestAt).toBe(T1);
    expect(groups[0]?.oldestAt).toBe(T1);
    expect(groups[0]?.id).toBe('h1');
  });

  it('keys a run by its oldest event, so one more event does not re-key the row', () => {
    const before = groupEvents([help('h2', T2), help('h1', T1)]);
    const after = groupEvents([help('h3', T3), help('h2', T2), help('h1', T1)]);
    expect(before[0]?.id).toBe('h1');
    expect(after[0]?.id).toBe('h1');
  });

  it('returns nothing for an empty log', () => {
    expect(groupEvents([])).toEqual([]);
  });

  it('leaves the input array alone', () => {
    const input = [help('h2', T2), help('h1', T1)];
    const groups = groupEvents(input);
    expect(input).toHaveLength(2);
    expect(groups[0]?.events).toHaveLength(2);
  });
});
