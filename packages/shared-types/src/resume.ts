import type { LearningCheckpoint } from './checkpoint';
import type { LearningEvent } from './events';
import type { LocalizedMessage } from './messages';

/** The amount of context a resume card should restore. */
export type ResumeVariant = 'short' | 'medium' | 'long';

/** Configurable thresholds for deterministic resume classification. */
export interface ResumePolicyConfig {
  readonly shortThresholdMs: number;
  readonly longThresholdMs: number;
  readonly outcomeWindowMs: number;
}

export type ResumePolicyOverrides = Partial<ResumePolicyConfig>;

export const DEFAULT_RESUME_POLICY_CONFIG: ResumePolicyConfig = {
  shortThresholdMs: 15 * 60 * 1000,
  longThresholdMs: 24 * 60 * 60 * 1000,
  outcomeWindowMs: 5 * 60 * 1000,
};

/**
 * What the learner sees when FocusLoop offers to bring them back in.
 *
 * The three prose fields are message descriptors rather than strings, so the
 * card reads in the learner's language. `completed` and `unresolved` hold the
 * learner's own content (task and concept titles) and are never translated.
 */
export interface ResumeCard {
  readonly variant: ResumeVariant;
  /** Measured interruption duration, or null when timestamps are unreliable. */
  readonly gapMs: number | null;
  /** Long gaps offer a brief refresher before returning to the task. */
  readonly refresher: LocalizedMessage | null;
  readonly title: LocalizedMessage;
  readonly lastContext: LocalizedMessage;
  readonly completed: readonly string[];
  readonly unresolved: readonly string[];
  readonly nextAction: LocalizedMessage;
  readonly estimatedMinutes: number;
}

export interface ResumeCardTiming {
  readonly checkpointId: string;
  readonly shownAt: string;
  readonly acceptedAt?: string;
  readonly dismissedAt?: string;
  /** Milliseconds between `shownAt` and `acceptedAt`. */
  readonly resumeLatencyMs?: number;
}

export interface ResumeCardView {
  readonly card: ResumeCard;
  readonly timing: ResumeCardTiming;
}

/** Window after acceptance in which evidence is attributed to this resume. */
export const RESUME_OUTCOME_WINDOW_MS = 5 * 60 * 1000;

/**
 * Terminal-ness of one accepted card's observation window.
 *
 * `observed` means evidence or a stall was seen before the window closed —
 * not that the resume "succeeded". The three boolean counts on the result
 * are what the dashboard reports.
 */
export type ResumeOutcomeStatus = 'pending' | 'dismissed' | 'expired' | 'observed';

export interface EvaluateResumeOutcomeInput {
  readonly checkpoint: LearningCheckpoint;
  readonly timing: ResumeCardTiming;
  readonly events: readonly LearningEvent[];
  /** Session end inside the window counts as a stall, not a silent expiry. */
  readonly sessionEndedAt?: string;
  readonly now: string;
  readonly windowMs?: number;
  readonly config?: Partial<ResumePolicyConfig>;
}

export interface ResumeOutcomeResult {
  readonly status: ResumeOutcomeStatus;
  /** Current-task behaviour was seen: start, complete, quiz, or another help request. */
  readonly reengaged: boolean;
  /** Actually moved forward: task completed or quiz correct. */
  readonly progressed: boolean;
  /** Short-term regression: another help request, another interruption, or session end. */
  readonly stalledAgain: boolean;
  readonly reengageEventIds: readonly string[];
  readonly progressEventIds: readonly string[];
  readonly stallEventIds: readonly string[];
  readonly acceptedAt: string | null;
  readonly windowEndsAt: string | null;
}
