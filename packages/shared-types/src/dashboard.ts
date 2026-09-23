import type { InterventionAction } from './intervention';

/**
 * Recomputed resume outcomes for the cards shown in a session.
 *
 * Deliberately not named "success": the old single rate counted any re-engagement
 * (including an immediate second help request) as success, which inflated the
 * number. Three counts and two rates keep re-engagement, progress, and a stall
 * apart. Dismissed cards stay out of every denominator.
 */
export interface ResumeOutcomeSummary {
  readonly accepted: number;
  readonly reengaged: number;
  readonly progressed: number;
  readonly stalledAgain: number;
  readonly expired: number;
  readonly pending: number;
  /** Cards that produced current-task behaviour / evaluated cards. Pending excluded. */
  readonly reengageRate: number | null;
  /** Cards that actually moved forward / evaluated cards. Pending excluded. */
  readonly progressRate: number | null;
}

export interface InterventionOutcomeSummary {
  readonly action: InterventionAction;
  readonly total: number;
  readonly accepted: number;
  readonly dismissed: number;
  readonly tasksCompleted: number;
}

export interface DashboardSummary {
  readonly sessionId: string | null;
  readonly courseTitle: string | null;
  readonly sessionDurationMs: number;
  readonly tasksCompleted: number;
  readonly tasksTotal: number;
  readonly interruptCount: number;
  readonly averageResumeLatencyMs: number | null;
  readonly resumeOutcomes: ResumeOutcomeSummary;
  readonly interventionOutcomes: readonly InterventionOutcomeSummary[];
}
