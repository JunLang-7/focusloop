/** What the learner sees when FocusLoop offers to bring them back in. */
export interface ResumeCard {
  readonly title: string;
  readonly lastContext: string;
  readonly completed: readonly string[];
  readonly unresolved: readonly string[];
  readonly nextAction: string;
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
