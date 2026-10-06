import type { InterventionAction } from './intervention';
import type { RescueAction } from './rescue';

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

/**
 * How the accepted rescues of one kind turned out (AG2.8), recomputed from the event log like the
 * resume outcomes beside it.
 *
 * `succeeded`, `repeatedHelp`, `expired` and `pending` partition `accepted`: a rescue is in exactly
 * one of them. A dismissed or never-answered card is not counted at all, because nothing was tried.
 */
export interface RescueOutcomeSummary {
  readonly action: RescueAction;
  readonly accepted: number;
  readonly succeeded: number;
  /** Asked for help again on the same task inside the window. */
  readonly repeatedHelp: number;
  readonly expired: number;
  readonly pending: number;
  /** Succeeded / evaluated (accepted without pending), or `null` while nothing has been evaluated. */
  readonly successRate: number | null;
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
  /** One row per rescue action, always all five, so the view never has holes. */
  readonly rescueOutcomes: readonly RescueOutcomeSummary[];
}
