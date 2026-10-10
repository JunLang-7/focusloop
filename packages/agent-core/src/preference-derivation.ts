/**
 * The three derivations (AG6.2–6.4): persisted rows in, a candidate with its evidence out — or an
 * abstention.
 *
 * Pure and offline by construction: the inputs are rows, the output is a shape, and nothing here
 * can reach `learner_preferences`. That is the AG6 never-do made structural rather than promised —
 * the engine specs assert the store is untouched after each derivation, and this module could not
 * write to it even if a spec forgot to.
 */
import type {
  ActionTally,
  ExplanationPreferenceValue,
  InterventionPreferenceValue,
  LearnerPreferenceEvidence,
  TaskSizePreferenceValue,
} from '@focusloop/shared-types';
import {
  PREFERENCE_INTERVENTION_ACTIONS,
  TASK_SIZE_MAX_MINUTES,
  TASK_SIZE_MIN_MINUTES,
} from '@focusloop/shared-types';
import type { InterventionAction, TutorMode } from '@focusloop/shared-types';

/**
 * The window a preference is derived from: four weeks — four weekly reflections deep.
 *
 * Long enough that a habit which changed shows as changed; short enough that last month's answer
 * is not offered as this month's. Every derivation shares it so a candidate's `evidence.window`
 * means the same thing whichever scope it lands in.
 */
export const PREFERENCE_WINDOW_MS = 28 * 24 * 60 * 60 * 1000;

/** Two acceptances can be coincidence; three is a pattern the learner would recognise as theirs. */
export const TASK_SIZE_SAMPLE_MINIMUM = 3;
/** A preference about how help should arrive: three of one action in a row is a streak, not a stance. */
export const INTERVENTION_SAMPLE_MINIMUM = 3;
/** Three explanation-shaped observations — below that, "which form landed" is a mood. */
export const EXPLANATION_SAMPLE_MINIMUM = 3;

function withinWindow(at: string, now: string): boolean {
  const atMs = Date.parse(at);
  const nowMs = Date.parse(now);
  if (!Number.isFinite(atMs) || !Number.isFinite(nowMs)) return false;
  return atMs >= nowMs - PREFERENCE_WINDOW_MS && atMs <= nowMs;
}

function evidenceFor(now: string, sampleSize: number): LearnerPreferenceEvidence {
  return {
    windowStart: new Date(Date.parse(now) - PREFERENCE_WINDOW_MS).toISOString(),
    windowEnd: now,
    sampleSize,
  };
}

function isStepSize(minutes: number): boolean {
  return (
    Number.isInteger(minutes) &&
    minutes >= TASK_SIZE_MIN_MINUTES &&
    minutes <= TASK_SIZE_MAX_MINUTES
  );
}

// ---------------------------------------------------------------- AG6.2 task size

export interface TimedMinutes {
  readonly at: string;
  readonly minutes: number;
}

/**
 * The size the learner's accepted narrowings rested on.
 *
 * The candidate carries the **most recent** acceptance, not an average: a preference is about the
 * habit they are in now, and averaging a change of habit produces the number neither period had.
 * Rows outside the window and rows that are not a step size do not count — and do not vote.
 */
export function deriveTaskSizeCandidate(input: {
  readonly accepted: readonly TimedMinutes[];
  readonly now: string;
}): { value: TaskSizePreferenceValue; evidence: LearnerPreferenceEvidence } | null {
  const counted = input.accepted.filter(
    (row) => withinWindow(row.at, input.now) && isStepSize(row.minutes),
  );
  if (counted.length < TASK_SIZE_SAMPLE_MINIMUM) return null;
  const latest = counted.reduce((best, row) =>
    Date.parse(row.at) >= Date.parse(best.at) ? row : best,
  );
  return {
    value: { preferredStepMinutes: latest.minutes },
    evidence: evidenceFor(input.now, counted.length),
  };
}

// ---------------------------------------------------------------- AG6.3 intervention

export interface TimedObservation {
  readonly at: string;
  readonly action: InterventionAction;
  readonly accepted: boolean;
  readonly dismissed: boolean;
}

function preferenceAction(action: InterventionAction): boolean {
  return (PREFERENCE_INTERVENTION_ACTIONS as readonly string[]).includes(action);
}

function tally(
  observations: readonly TimedObservation[],
  key: (action: InterventionAction) => string,
): readonly ActionTally[] {
  // Mutable while counting; the values satisfy `ActionTally` on the way out — readonly is the
  // output's stance, not the tally's working memory.
  const counts = new Map<string, { action: ActionTally['action']; count: number }>();
  for (const observation of observations) {
    const name = key(observation.action);
    const existing = counts.get(name);
    // The cast is the caller's filter made type-level: every observation reaching here has already
    // passed `preferenceAction`, so its action is one of the six a preference can name.
    const action = observation.action as ActionTally['action'];
    if (existing === undefined) counts.set(name, { action, count: 1 });
    else existing.count += 1;
  }
  // Sorted by name: the same rows in any order produce the same candidate (the spec asserts it).
  return [...counts.values()].sort((left, right) =>
    key(left.action).localeCompare(key(right.action)),
  );
}

/**
 * What was welcomed and what was waved away, counted — never interpreted.
 *
 * Actions a preference cannot be about are excluded before counting: `NO_ACTION` is the absence of
 * one, and `RESUME` is the interruption the learner never gets to refuse. An intervention without a
 * resolved outcome is not an observation: unresolved is not a preference.
 */
export function deriveInterventionCandidate(input: {
  readonly observations: readonly TimedObservation[];
  readonly now: string;
}): { value: InterventionPreferenceValue; evidence: LearnerPreferenceEvidence } | null {
  const counted = input.observations.filter(
    (row) =>
      withinWindow(row.at, input.now) &&
      preferenceAction(row.action) &&
      (row.accepted || row.dismissed),
  );
  if (counted.length < INTERVENTION_SAMPLE_MINIMUM) return null;
  return {
    value: {
      welcomed: tally(
        counted.filter((row) => row.accepted),
        (action) => action,
      ),
      refused: tally(
        counted.filter((row) => row.dismissed),
        (action) => action,
      ),
    },
    evidence: evidenceFor(input.now, counted.length),
  };
}

// ---------------------------------------------------------------- AG6.4 explanation

/**
 * Which explanation form landed, as tutor-mode names.
 *
 * The mapping is intent, not merit: the HINT card and the HINT mode ask for the same thing, and a
 * QUESTION is the socratic probe. An accepted HINT is a learner who wanted a cue — never a verdict
 * on lectures, which is why the value holds names and counts and no adjective exists to hold.
 */
const EXPLANATION_FORM_FOR_ACTION: Readonly<Record<'HINT' | 'EXAMPLE' | 'QUESTION', TutorMode>> = {
  HINT: 'HINT',
  EXAMPLE: 'EXAMPLE',
  QUESTION: 'SOCRATIC',
};

export function deriveExplanationCandidate(input: {
  readonly observations: readonly TimedObservation[];
  readonly now: string;
}): { value: ExplanationPreferenceValue; evidence: LearnerPreferenceEvidence } | null {
  const counted = input.observations.filter(
    (row) =>
      withinWindow(row.at, input.now) &&
      Object.hasOwn(EXPLANATION_FORM_FOR_ACTION, row.action) &&
      (row.accepted || row.dismissed),
  );
  if (counted.length < EXPLANATION_SAMPLE_MINIMUM) return null;

  const accepted = counted.filter((row) => row.accepted);
  if (accepted.length === 0) return null; // nothing landed: no form to prefer, which is not a preference

  const counts = new Map<TutorMode, number>();
  for (const row of accepted) {
    const mode = EXPLANATION_FORM_FOR_ACTION[row.action as 'HINT' | 'EXAMPLE' | 'QUESTION'];
    if (mode === undefined) continue;
    counts.set(mode, (counts.get(mode) ?? 0) + 1);
  }
  return {
    value: {
      modes: [...counts.entries()]
        .map(([mode, count]) => ({ mode, count }))
        .sort((left, right) => left.mode.localeCompare(right.mode)),
    },
    evidence: evidenceFor(input.now, counted.length),
  };
}
