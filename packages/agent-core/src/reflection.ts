/**
 * The weekly reflection (AG6.5): rows in, claims out — pure, offline, and unable to infer.
 *
 * Every stat states the rows it counted (`samples`), every preference is quoted with its *own*
 * evidence rather than the week's window, and an empty input produces an empty reflection rather
 * than a stable-looking guess. Nothing here can reach the store: the engine gathers, this decides,
 * and the spec reconstructs each number from the fixture rows it was given.
 */
import type {
  Intervention,
  InterventionOutcome,
  LearnerPreference,
  LearningCheckpoint,
  LearningEvent,
  ReflectionStat,
  ReflectionStatKey,
  ResumeCardTiming,
  WeeklyReflection,
} from '@focusloop/shared-types';

export interface WeeklyReflectionInput {
  /** The week itself — the same window the dashboard's week view uses (see `weekWindow`). */
  readonly windowFrom: string;
  readonly windowTo: string;
  readonly interventions: readonly Intervention[];
  readonly outcomes: readonly InterventionOutcome[];
  readonly resumeTimings: readonly ResumeCardTiming[];
  readonly checkpoints: readonly LearningCheckpoint[];
  /** TASK_COMPLETED events — the engine hands over what already passed the type filter. */
  readonly tasksCompleted: readonly LearningEvent[];
  readonly preferences: readonly LearnerPreference[];
}

function windowFilter(fromIso: string, toIso: string): (at: string | null | undefined) => boolean {
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  return (at) => {
    if (at === null || at === undefined) return false;
    const atMs = Date.parse(at);
    return Number.isFinite(atMs) && atMs >= from && atMs <= to;
  };
}

function stat(key: ReflectionStatKey, value: number, samples: number): ReflectionStat | null {
  return value > 0 ? { key, value, samples } : null;
}

export function buildWeeklyReflection(input: WeeklyReflectionInput): WeeklyReflection {
  const inWindow = windowFilter(input.windowFrom, input.windowTo);
  const stats: ReflectionStat[] = [];

  const interventions = input.interventions.filter((row) => inWindow(row.at));
  const shown = stat('interventions.shown', interventions.length, interventions.length);
  if (shown !== null) stats.push(shown);

  // Ratios carry their denominator: "2 of 5 shown" is the claim, and 5 is the evidence.
  const outcomes = input.outcomes.filter((row) => inWindow(row.at));
  if (outcomes.length > 0) {
    const accepted = outcomes.filter((row) => row.accepted).length;
    const acceptedStat = stat('interventions.accepted', accepted, outcomes.length);
    if (acceptedStat !== null) stats.push(acceptedStat);
    const dismissed = outcomes.filter((row) => row.dismissed).length;
    const dismissedStat = stat('interventions.dismissed', dismissed, outcomes.length);
    if (dismissedStat !== null) stats.push(dismissedStat);
  }

  const resumes = input.resumeTimings.filter((row) => inWindow(row.shownAt));
  if (resumes.length > 0) {
    // Resumes are ratios too: accepted or declined out of the cards the week actually showed.
    const acceptedResumes = resumes.filter(
      (row) => row.acceptedAt !== undefined && inWindow(row.acceptedAt),
    ).length;
    const accepted = stat('resumes.accepted', acceptedResumes, resumes.length);
    if (accepted !== null) stats.push(accepted);
    const dismissedResumes = resumes.filter(
      (row) => row.dismissedAt !== undefined && inWindow(row.dismissedAt),
    ).length;
    const dismissed = stat('resumes.dismissed', dismissedResumes, resumes.length);
    if (dismissed !== null) stats.push(dismissed);
  }

  const checkpoints = input.checkpoints.filter((row) => inWindow(row.createdAt));
  const taken = stat('checkpoints.taken', checkpoints.length, checkpoints.length);
  if (taken !== null) stats.push(taken);

  const tasks = input.tasksCompleted.filter((row) => inWindow(row.at));
  const finished = stat('tasks.completed', tasks.length, tasks.length);
  if (finished !== null) stats.push(finished);

  const preferences = input.preferences
    .filter(
      (row) => row.expiresAt === null || Date.parse(row.expiresAt) > Date.parse(input.windowTo),
    )
    .map((row) => ({
      scope: row.scope,
      value: row.value,
      samples: row.evidence.sampleSize,
      windowFrom: row.evidence.windowStart,
      windowTo: row.evidence.windowEnd,
    }));

  return {
    windowFrom: input.windowFrom,
    windowTo: input.windowTo,
    stats,
    preferences,
  };
}
