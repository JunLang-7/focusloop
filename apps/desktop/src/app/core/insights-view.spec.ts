import { describe, expect, it } from 'vitest';
import type { DailyActivity, StateShare } from '@focusloop/shared-types';
import {
  STATE_COLORS,
  busiestDay,
  donutSegments,
  focusRatio,
  formatSpan,
  heatLevel,
  heatmapLeadingBlanks,
  percentLabel,
  ringCircumference,
  shortDate,
  sortedShares,
  visibleShares,
  weekdayIndex,
} from './insights-view';

const share = (state: StateShare['state'], durationMs: number, ratio: number): StateShare => ({
  state,
  durationMs,
  share: ratio,
});

describe('donutSegments', () => {
  it('uses the ring circumference as the dash unit', () => {
    const [segment] = donutSegments([share('FOCUSED', 100, 1)], 42);
    expect(ringCircumference(42)).toBeCloseTo(2 * Math.PI * 42, 10);
    expect(segment?.dashArray.startsWith(`${ringCircumference(42)} `)).toBe(true);
  });

  it('walks the arcs clockwise without overlapping', () => {
    const segments = donutSegments([share('FOCUSED', 50, 0.5), share('DISTRACTED', 50, 0.5)], 40);
    expect(segments).toHaveLength(2);
    expect(segments[0]?.dashOffset).toBe(-0);
    // The second arc starts exactly where the first one ended.
    expect(segments[1]?.dashOffset).toBeCloseTo(-0.5 * ringCircumference(40), 10);
  });

  it('leaves a hairline gap between neighbours but not around a single arc', () => {
    const two = donutSegments([share('FOCUSED', 50, 0.5), share('CONFUSED', 50, 0.5)], 40);
    const one = donutSegments([share('FOCUSED', 100, 1)], 40);
    const length = (dashArray: string | undefined): number =>
      Number((dashArray ?? '').split(' ')[0]);
    expect(length(one[0]?.dashArray)).toBeCloseTo(ringCircumference(40), 10);
    expect(length(two[0]?.dashArray)).toBeLessThan(0.5 * ringCircumference(40));
  });

  it('drops states with no time', () => {
    const segments = donutSegments([share('FOCUSED', 100, 1), share('CONFUSED', 0, 0)]);
    expect(segments.map((s) => s.state)).toEqual(['FOCUSED']);
  });

  it('returns nothing for an empty window', () => {
    expect(donutSegments([])).toEqual([]);
  });

  it('carries the shared state colour', () => {
    const [segment] = donutSegments([share('OVERLOADED', 100, 1)]);
    expect(segment?.color).toBe(STATE_COLORS.OVERLOADED);
  });

  it('never produces a negative arc when shares overshoot', () => {
    const segments = donutSegments([share('FOCUSED', 90, 0.9), share('CONFUSED', 90, 0.9)], 40);
    for (const segment of segments) {
      expect(Number(segment.dashArray.split(' ')[0])).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('heatLevel', () => {
  it('is zero when nothing was recorded', () => {
    expect(heatLevel(0, 100)).toBe(0);
    expect(heatLevel(50, 0)).toBe(0);
  });

  it('scales against the busiest day', () => {
    expect(heatLevel(100, 100)).toBe(4);
    expect(heatLevel(1, 100)).toBe(1);
    expect(heatLevel(50, 100)).toBe(2);
    expect(heatLevel(75, 100)).toBe(3);
  });

  it('never exceeds four even if a day beats the maximum', () => {
    expect(heatLevel(500, 100)).toBe(4);
  });
});

describe('percentLabel', () => {
  it('renders one decimal place', () => {
    expect(percentLabel(0.361)).toBe('36.1%');
    expect(percentLabel(1)).toBe('100.0%');
    expect(percentLabel(0)).toBe('0.0%');
  });

  it('clamps values outside 0..1', () => {
    expect(percentLabel(2)).toBe('100.0%');
    expect(percentLabel(-1)).toBe('0.0%');
  });
});

describe('sortedShares', () => {
  it('leads with the largest share and does not mutate the input', () => {
    const input = [share('CONFUSED', 10, 0.1), share('FOCUSED', 90, 0.9)];
    expect(sortedShares(input).map((s) => s.state)).toEqual(['FOCUSED', 'CONFUSED']);
    expect(input[0]?.state).toBe('CONFUSED');
  });
});

describe('visibleShares', () => {
  it('drops the states with no time and orders the rest by duration', () => {
    const shares = [
      share('CONFUSED', 0, 0),
      share('FOCUSED', 100, 0.5),
      share('DISTRACTED', 200, 0.5),
    ];
    expect(visibleShares(shares).map((item) => item.state)).toEqual(['DISTRACTED', 'FOCUSED']);
  });

  it('leaves the input array alone', () => {
    const shares = [share('FOCUSED', 0, 0), share('DISTRACTED', 200, 1)];
    visibleShares(shares);
    expect(shares.map((item) => item.state)).toEqual(['FOCUSED', 'DISTRACTED']);
  });

  it('returns nothing for an empty window', () => {
    expect(visibleShares([])).toEqual([]);
  });
});

describe('focusRatio', () => {
  it('counts FOCUSED and RESUMING as on task', () => {
    const shares = [
      share('FOCUSED', 30, 0.3),
      share('RESUMING', 20, 0.2),
      share('DISTRACTED', 50, 0.5),
    ];
    expect(focusRatio(shares)).toBeCloseTo(0.5, 10);
  });

  it('does not treat going idle, confused or overloaded as focus', () => {
    const shares = [
      share('READY', 40, 0.4),
      share('CONFUSED', 20, 0.2),
      share('OVERLOADED', 40, 0.4),
    ];
    expect(focusRatio(shares)).toBe(0);
  });

  it('weighs by duration, not by how many states were visited', () => {
    const shares = [share('RESUMING', 10, 0.01), share('INTERRUPTED', 990, 0.99)];
    expect(focusRatio(shares)).toBeCloseTo(0.01, 10);
  });

  it('is zero, not NaN, for a window with nothing in it', () => {
    expect(focusRatio([])).toBe(0);
  });

  it('is zero, not NaN, when every state recorded zero time', () => {
    expect(focusRatio([share('FOCUSED', 0, 0), share('RESUMING', 0, 0)])).toBe(0);
  });
});

describe('busiestDay', () => {
  const day = (date: string, durationMs: number): DailyActivity => ({
    date,
    durationMs,
    tasksCompleted: 0,
    interruptions: 0,
  });

  it('finds the longest day', () => {
    expect(busiestDay([day('2026-06-01', 10), day('2026-06-02', 90)])?.date).toBe('2026-06-02');
  });

  it('returns null when there is nothing to compare', () => {
    expect(busiestDay([])).toBeNull();
  });
});

describe('heatmapLeadingBlanks', () => {
  const day = (date: string): DailyActivity => ({
    date,
    durationMs: 0,
    tasksCompleted: 0,
    interruptions: 0,
  });

  it('pads so weekdays line up with their column', () => {
    // 2026-06-14 is a Sunday, 2026-06-17 a Wednesday.
    expect(heatmapLeadingBlanks([day('2026-06-14')])).toBe(0);
    expect(heatmapLeadingBlanks([day('2026-06-17')])).toBe(3);
  });

  it('is zero for an empty window', () => {
    expect(heatmapLeadingBlanks([])).toBe(0);
  });
});

describe('formatSpan', () => {
  const t = (key: string, params: Record<string, string> = {}): string => {
    if (key === 'unit.s') return `${params['s']}s`;
    if (key === 'unit.hm') return `${params['h']}h ${params['m']}m`;
    return `${params['m']}m`;
  };

  it('uses seconds below a minute, so a short session is not rounded away', () => {
    expect(formatSpan(42_000, t)).toBe('42s');
    expect(formatSpan(0, t)).toBe('0s');
    expect(formatSpan(59_499, t)).toBe('59s');
  });

  it('uses minutes alone under an hour', () => {
    expect(formatSpan(45 * 60_000, t)).toBe('45m');
    expect(formatSpan(60_000, t)).toBe('1m');
  });

  it('switches to hours and minutes past an hour', () => {
    expect(formatSpan(65 * 60_000, t)).toBe('1h 5m');
  });

  it('never renders a negative span', () => {
    expect(formatSpan(-5_000, t)).toBe('0s');
  });
});

describe('weekdayIndex', () => {
  it('maps a date to 0=Sunday … 6=Saturday', () => {
    expect(weekdayIndex('2026-06-14')).toBe(0);
    expect(weekdayIndex('2026-06-17')).toBe(3);
  });

  it('falls back to 0 for anything unparseable', () => {
    expect(weekdayIndex('not-a-date')).toBe(0);
  });
});

describe('shortDate', () => {
  it('drops the leading zeros', () => {
    expect(shortDate('2026-06-05')).toBe('6/5');
    expect(shortDate('2026-12-31')).toBe('12/31');
  });

  it('passes anything unexpected through unchanged', () => {
    expect(shortDate('not-a-date')).toBe('not-a-date');
  });
});
