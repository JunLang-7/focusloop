import type { ClockFormat } from '@focusloop/shared-types';

/** Presentation-only formatting helpers. No domain logic lives here. */

/**
 * A span of time, as a person reads one.
 *
 * Seconds are always shown, because "3:09" for three minutes nine seconds is unambiguous while
 * "3m" hides the part that changes. Past an hour the hours are named rather than counted in the
 * minutes field: the previous shape printed `minutes:seconds` for any length, so a session that had
 * been open for a fortnight rendered as `21219:30` — a number nobody reads as a duration, and one
 * that says nothing about which of its digits is hours. Past a day the days are named for the same
 * reason, which leaves `1d 2:03:04` readable at a glance.
 */
export function formatDuration(ms: number): string {
  const safe = Number.isFinite(ms) && ms > 0 ? ms : 0;
  const totalSeconds = Math.floor(safe / 1000);
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);
  const two = (value: number): string => value.toString().padStart(2, '0');

  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    return `${days}d ${hours % 24}:${two(minutes)}:${two(seconds)}`;
  }
  if (hours >= 1) return `${hours}:${two(minutes)}:${two(seconds)}`;
  return `${Math.floor(totalSeconds / 60)}:${two(seconds)}`;
}

export function formatLatency(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

/**
 * A time of day, in the learner's chosen clock. `format` is required rather than defaulted so a new
 * caller cannot quietly pick 24h for someone who chose 12h.
 */
export function formatClock(iso: string | undefined, format: ClockFormat): string {
  if (iso === undefined) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    hour12: format === '12h',
  });
}

export function percent(value: number): string {
  return `${Math.round(Math.min(1, Math.max(0, value)) * 100)}%`;
}
