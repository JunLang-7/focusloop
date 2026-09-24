import type {
  Course,
  DashboardSummary,
  InterventionOutcome,
  LearningCheckpoint,
  LearningEvent,
  LearningSession,
  ResumeCardTiming,
  ResumePolicyConfig,
} from '@focusloop/shared-types';
import { evaluateResumeOutcome } from '@focusloop/continuity';
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
  /** Timings and source facts used to rebuild resume outcomes after a restart. */
  readonly resumeTimings?: readonly ResumeCardTiming[];
  readonly checkpoints?: readonly LearningCheckpoint[];
  readonly events?: readonly LearningEvent[];
  readonly resumePolicyConfig?: Partial<ResumePolicyConfig>;
  readonly now: string;
}

export function emptyResumeOutcomeSummary(): DashboardSummary['resumeOutcomes'] {
  return {
    accepted: 0,
    reengaged: 0,
    progressed: 0,
    stalledAgain: 0,
    expired: 0,
    pending: 0,
    reengageRate: null,
    progressRate: null,
  };
}

/**
 * Rebuilds resume outcomes from facts in the store. No aggregate is persisted,
 * so this remains correct after a process restart and for a changed `now`.
 *
 * A card is evaluated at most once. Dismissed and never-decided cards are not
 * accepted. Pending cards are counted but kept out of both rate denominators.
 * reengaged/progressed/stalledAgain can overlap on one card — that is the point.
 */
export function summarizeResumeOutcomes(input: {
  readonly timings: readonly ResumeCardTiming[];
  readonly checkpoints: readonly LearningCheckpoint[];
  readonly events: readonly LearningEvent[];
  readonly sessionEndedAt?: string;
  readonly now: string;
  readonly config?: Partial<ResumePolicyConfig>;
}): DashboardSummary['resumeOutcomes'] {
  const checkpointsById = new Map(
    input.checkpoints.map((checkpoint) => [checkpoint.id, checkpoint]),
  );
  const seenCards = new Set<string>();
  let accepted = 0;
  let reengaged = 0;
  let progressed = 0;
  let stalledAgain = 0;
  let expired = 0;
  let pending = 0;

  for (const timing of input.timings) {
    if (seenCards.has(timing.checkpointId)) continue;
    seenCards.add(timing.checkpointId);
    if (timing.acceptedAt === undefined || timing.dismissedAt !== undefined) continue;
    const checkpoint = checkpointsById.get(timing.checkpointId);
    if (checkpoint === undefined) continue;

    const result = evaluateResumeOutcome({
      checkpoint,
      timing,
      events: input.events,
      ...(input.sessionEndedAt === undefined ? {} : { sessionEndedAt: input.sessionEndedAt }),
      now: input.now,
      ...(input.config === undefined ? {} : { config: input.config }),
    });
    if (result.status === 'dismissed') continue;

    accepted += 1;
    if (result.status === 'pending') {
      pending += 1;
      continue;
    }
    // terminal: observed or expired — one slot in the rate denominators
    if (result.reengaged) reengaged += 1;
    if (result.progressed) progressed += 1;
    if (result.stalledAgain) stalledAgain += 1;
    if (result.status === 'expired') expired += 1;
  }

  const evaluated = accepted - pending;
  return {
    accepted,
    reengaged,
    progressed,
    stalledAgain,
    expired,
    pending,
    reengageRate: evaluated === 0 ? null : reengaged / evaluated,
    progressRate: evaluated === 0 ? null : progressed / evaluated,
  };
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
      resumeOutcomes: emptyResumeOutcomeSummary(),
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
    resumeOutcomes: summarizeResumeOutcomes({
      timings: input.resumeTimings ?? [],
      checkpoints: input.checkpoints ?? [],
      events: input.events ?? [],
      ...(session.endedAt === undefined ? {} : { sessionEndedAt: session.endedAt }),
      now,
      config: input.resumePolicyConfig,
    }),
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
