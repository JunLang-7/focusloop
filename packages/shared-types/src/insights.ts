import type { LearningState } from './state';

/**
 * The window an insights summary covers.
 *
 * `session` is scoped to the session currently on screen; the rest are calendar
 * windows ending now, so the dashboard can answer both "how is this session
 * going" and "how have I been doing lately".
 */
export const INSIGHT_RANGES = ['session', 'today', 'week', 'all'] as const;

export type InsightRange = (typeof INSIGHT_RANGES)[number];

export function isInsightRange(value: unknown): value is InsightRange {
  return typeof value === 'string' && (INSIGHT_RANGES as readonly string[]).includes(value);
}

/** The window an empty dashboard falls back to. */
export const DEFAULT_INSIGHT_RANGE: InsightRange = 'week';

/** One learning state's share of the time spent inside the window. */
export interface StateShare {
  readonly state: LearningState;
  readonly durationMs: number;
  /** 0..1. The shares of a non-empty window sum to 1. */
  readonly share: number;
}

/** One calendar day inside the window. */
export interface DailyActivity {
  /** Local calendar date, `YYYY-MM-DD`. */
  readonly date: string;
  readonly durationMs: number;
  readonly tasksCompleted: number;
  readonly interruptions: number;
}

/** Time spent on one course inside the window. */
export interface CourseShare {
  readonly courseId: string;
  readonly title: string;
  readonly durationMs: number;
  readonly share: number;
}

/**
 * Aggregated learning activity.
 *
 * Everything here is derived from the event log by replaying it through the real
 * state machine — nothing is stored twice, and the dashboard cannot disagree
 * with the engine about what happened.
 */
export interface InsightsSummary {
  readonly range: InsightRange;
  /** Start of the window, inclusive. */
  readonly from: string;
  /** End of the window, inclusive — "now" is part of the window it closes. */
  readonly to: string;
  /** Total time inside the window, across every session in it. */
  readonly totalMs: number;
  readonly sessionCount: number;
  readonly tasksCompleted: number;
  readonly interruptions: number;
  readonly averageResumeLatencyMs: number | null;
  /** Days inside the window that recorded any activity at all. */
  readonly activeDays: number;
  /** `totalMs / activeDays`, or 0 when nothing was recorded. */
  readonly dailyAverageMs: number;
  /** Descending by duration. States with no time are omitted. */
  readonly stateShares: readonly StateShare[];
  /** One entry per calendar day in the window, ascending. Never empty. */
  readonly daily: readonly DailyActivity[];
  /** Longest day in the window; the heatmap scales against it. */
  readonly maxDailyMs: number;
  /** Descending by duration. Courses with no time are omitted. */
  readonly courseShares: readonly CourseShare[];
}

export interface InsightsRequest {
  readonly range: InsightRange;
}
