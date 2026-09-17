import type { LocalizedMessage } from './messages';

/**
 * What the learner sees when FocusLoop offers to bring them back in.
 *
 * The three prose fields are message descriptors rather than strings, so the
 * card reads in the learner's language. `completed` and `unresolved` hold the
 * learner's own content (task and concept titles) and are never translated.
 */
export interface ResumeCard {
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
