import type {
  Course,
  DashboardSummary,
  InterventionOutcome,
  LearningSession,
} from '@focusloop/shared-types';
import { averageResumeLatencyMs, summarizeOutcomes } from '@focusloop/intervention-policy';

export interface BuildDashboardInput {
  readonly session: LearningSession | null;
  readonly course: Course | null;
  readonly outcomes: readonly InterventionOutcome[];
  /**
   * Number of checkpoints stored for the session.
   *
   * An interruption is counted as "a moment we had to help the learner resume
   * from", which is exactly one checkpoint. Counting it from the event log
   * instead would miss every interruption that was detected by the time-based
   * tick rather than by an incoming event.
   */
  readonly checkpointCount: number;
  readonly now: string;
}

export function buildDashboardSummary(input: BuildDashboardInput): DashboardSummary {
  const { session, course, outcomes, now } = input;

  if (session === null) {
    return {
      sessionId: null,
      courseTitle: null,
      sessionDurationMs: 0,
      tasksCompleted: 0,
      tasksTotal: 0,
      interruptCount: 0,
      averageResumeLatencyMs: null,
      interventionOutcomes: summarizeOutcomes([]),
    };
  }

  const startedMs = Date.parse(session.startedAt);
  const endedMs = session.endedAt === undefined ? Date.parse(now) : Date.parse(session.endedAt);
  const durationMs =
    Number.isFinite(startedMs) && Number.isFinite(endedMs) ? Math.max(0, endedMs - startedMs) : 0;

  return {
    sessionId: session.id,
    courseTitle: course?.title ?? null,
    sessionDurationMs: durationMs,
    tasksCompleted: session.completedTaskIds.length,
    tasksTotal: course?.microTasks.length ?? 0,
    interruptCount: Math.max(0, input.checkpointCount),
    averageResumeLatencyMs: averageResumeLatencyMs(outcomes),
    interventionOutcomes: summarizeOutcomes(outcomes),
  };
}

/** Milliseconds as `m:ss`, used by the dashboard and the focus workspace. */
export function formatDuration(ms: number): string {
  const safe = Number.isFinite(ms) && ms > 0 ? ms : 0;
  const totalSeconds = Math.floor(safe / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export function formatLatency(ms: number | null): string {
  if (ms === null) return '—';
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}
