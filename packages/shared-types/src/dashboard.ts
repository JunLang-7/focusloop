import type { InterventionAction } from './intervention';

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
  readonly interventionOutcomes: readonly InterventionOutcomeSummary[];
}
