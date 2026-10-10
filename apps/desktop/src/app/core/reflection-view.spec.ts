import { describe, expect, it } from 'vitest';
import type { WeeklyReflection } from '@focusloop/shared-types';
import { REFLECTION_STAT_KEYS } from '@focusloop/shared-types';
import { REFLECTION_STAT_LABELS, reflectionView } from './reflection-view';

const clock = (iso: string | null): string => (iso === null ? '—' : iso.slice(5, 10));

function reflection(over: Partial<WeeklyReflection> = {}): WeeklyReflection {
  return {
    windowFrom: '2026-05-25T00:00:00.000Z',
    windowTo: '2026-06-01T00:00:00.000Z',
    stats: [],
    preferences: [],
    ...over,
  };
}

describe('the weekly reflection as the dashboard shows it (AG6.5)', () => {
  it('labels every stat in the closed vocabulary', () => {
    for (const key of REFLECTION_STAT_KEYS) {
      expect(REFLECTION_STAT_LABELS[key]).toBe(`app.reflection.stat.${key}`);
    }
  });

  it('every stat carries the rows behind it and the week it counts', () => {
    const view = reflectionView(
      reflection({
        stats: [
          { key: 'interventions.accepted', value: 2, samples: 5 },
          { key: 'tasks.completed', value: 3, samples: 3 },
        ],
      }),
      clock,
    );
    expect(view.isEmpty).toBe(false);
    expect(view.stats).toHaveLength(2);
    const accepted = view.stats[0]!;
    expect(accepted.labelKey).toBe('app.reflection.stat.interventions.accepted');
    expect(accepted.evidenceParams).toEqual({
      samples: '5',
      from: '05-25',
      to: '06-01',
    });
  });

  it('a claim shows its preference value, its scope, and its OWN evidence window', () => {
    const view = reflectionView(
      reflection({
        preferences: [
          {
            scope: 'task-size',
            value: { preferredStepMinutes: 2 },
            samples: 4,
            windowFrom: '2026-05-01T00:00:00.000Z',
            windowTo: '2026-05-20T00:00:00.000Z',
          },
        ],
      }),
      clock,
    );
    expect(view.claims).toHaveLength(1);
    const claim = view.claims[0]!;
    expect(claim.scopeKey).toBe('app.data.preference.scope.task-size');
    expect(claim.valueText).toBe('{"preferredStepMinutes":2}');
    // The claim's window, not the week's — that is the whole point of evidence being inline.
    expect(claim.evidenceParams).toEqual({
      samples: '4',
      from: '05-01',
      to: '05-20',
    });
  });

  it('bounds a value that would grow the row (same line rule as the data panel)', () => {
    const view = reflectionView(
      reflection({
        preferences: [
          {
            scope: 'intervention',
            value: {
              welcomed: Array.from({ length: 20 }, () => ({ action: 'HINT' as const, count: 12 })),
              refused: [],
            },
            samples: 9,
            windowFrom: '2026-05-01T00:00:00.000Z',
            windowTo: '2026-05-20T00:00:00.000Z',
          },
        ],
      }),
      clock,
    );
    expect(view.claims[0]!.valueText.length).toBeLessThanOrEqual(140);
    expect(view.claims[0]!.valueText.endsWith('…')).toBe(true);
  });

  it('an empty week reads as empty — the section renders its own sentence, not seven zeros', () => {
    const view = reflectionView(reflection(), clock);
    expect(view.isEmpty).toBe(true);
    expect(view.stats).toEqual([]);
    expect(view.claims).toEqual([]);
  });
});
