/**
 * Presentation helpers for the insights dashboard.
 *
 * Pure functions only, so the donut maths is unit-tested instead of being
 * verified by looking at a screen.
 */
import type { DailyActivity, LearningState, StateShare } from '@focusloop/shared-types';
import type { MessageKey } from './i18n/i18n.service';

/** Injected so these helpers stay free of Angular DI and unit-testable. */
export type Translate = (key: MessageKey, params?: Record<string, string>) => string;

/**
 * One colour per learning state, shared by the donut and its legend so the two
 * can never disagree.
 *
 * Deliberately a single mid-tone palette rather than one per theme: every colour
 * has to hold up as a ring segment on both a near-black and a white panel, and two
 * palettes would drift. Deliberately not the semantic `--ok` / `--warn` /
 * `--danger` tokens either — state is descriptive here, not a verdict.
 */
export const STATE_COLORS: Record<LearningState, string> = {
  READY: '#6b7280',
  INITIATION_FRICTION: '#d97706',
  FOCUSED: '#16a34a',
  CONFUSED: '#ca8a04',
  OVERLOADED: '#ea580c',
  DISTRACTED: '#64748b',
  INTERRUPTED: '#dc2626',
  RESUMING: '#0284c7',
};

/** One arc of the donut, ready to drop into an SVG `<circle>`. */
export interface DonutSegment {
  readonly state: LearningState;
  readonly color: string;
  readonly dashArray: string;
  /** Negative offset walks the arc clockwise from 12 o'clock. */
  readonly dashOffset: number;
  /** Fraction of the ring this arc covers, for the tooltip/title. */
  readonly share: number;
}

/** Circumference of a circle, the unit every `stroke-dasharray` is expressed in. */
export function ringCircumference(radius: number): number {
  return 2 * Math.PI * radius;
}

/**
 * Turns shares into donut arcs, leaving a hairline gap between neighbours so two
 * adjacent states do not read as one.
 */
export function donutSegments(shares: readonly StateShare[], radius = 42): DonutSegment[] {
  const circumference = ringCircumference(radius);
  const drawable = shares.filter((share) => share.share > 0);
  const gap = drawable.length > 1 ? 1.5 : 0;

  let offset = 0;
  return drawable.map((share) => {
    const length = Math.max(0, share.share * circumference - gap);
    const segment: DonutSegment = {
      state: share.state,
      color: STATE_COLORS[share.state],
      dashArray: `${length} ${circumference - length}`,
      dashOffset: -offset,
      share: share.share,
    };
    offset += share.share * circumference;
    return segment;
  });
}

/** 0 = nothing recorded, 4 = the busiest day in the window. */
export function heatLevel(durationMs: number, maxMs: number): 0 | 1 | 2 | 3 | 4 {
  if (durationMs <= 0 || maxMs <= 0) return 0;
  const ratio = Math.min(1, durationMs / maxMs);
  return Math.max(1, Math.ceil(ratio * 4)) as 1 | 2 | 3 | 4;
}

export function percentLabel(share: number): string {
  return `${(Math.min(1, Math.max(0, share)) * 100).toFixed(1)}%`;
}

/** Largest share first, so the donut legend leads with where the time went. */
export function sortedShares(shares: readonly StateShare[]): StateShare[] {
  return [...shares].sort((a, b) => b.durationMs - a.durationMs);
}

export function busiestDay(daily: readonly DailyActivity[]): DailyActivity | null {
  return daily.reduce<DailyActivity | null>(
    (best, day) => (best === null || day.durationMs > best.durationMs ? day : best),
    null,
  );
}

/**
 * Blank cells needed before the first day so the grid columns line up with
 * weekdays (column 0 = Sunday, matching `Date.getDay()`).
 *
 * Only used when a window is longer than a week; a single week reads better as
 * one labelled row than as a ragged grid with a column of holes in front of it.
 */
export function heatmapLeadingBlanks(daily: readonly DailyActivity[]): number {
  const first = daily[0];
  return first === undefined ? 0 : weekdayIndex(first.date);
}

/**
 * The most useful unit for a span, so a 40-second session never renders as `0m`.
 *
 *   < 1 minute   ->  `42s`
 *   < 1 hour     ->  `12m`
 *   otherwise    ->  `1h 05m`
 */
export function formatSpan(ms: number, t: Translate): string {
  const safe = Math.max(0, ms);
  if (safe < 60_000) return t('unit.s', { s: `${Math.round(safe / 1000)}` });

  const totalMinutes = Math.round(safe / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours === 0
    ? t('unit.m', { m: `${minutes}` })
    : t('unit.hm', { h: `${hours}`, m: `${minutes}` });
}

/** `6/15` — the short date label on a heatmap cell and the busiest day. */
export function shortDate(date: string): string {
  const [, monthPart, dayPart] = date.split('-');
  const month = Number(monthPart);
  const day = Number(dayPart);
  // Anything that is not a real `YYYY-MM-DD` comes back untouched rather than as
  // `NaN/NaN`, which is what a naive `Number()` cast would produce.
  if (!Number.isInteger(month) || !Number.isInteger(day)) return date;
  return `${month}/${day}`;
}

/** 0 = Sunday … 6 = Saturday, for the weekday label under a heatmap cell. */
export function weekdayIndex(date: string): number {
  const parsed = new Date(`${date}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getDay();
}
