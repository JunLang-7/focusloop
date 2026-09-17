import type { LearningState } from './state';

export interface LearningSession {
  readonly id: string;
  readonly courseId: string;
  readonly startedAt: string;
  readonly endedAt?: string;
  readonly state: LearningState;
  readonly currentTaskId?: string;
  readonly completedTaskIds: readonly string[];
  /** Task the learner was on when the most recent friction state began. */
  readonly lastActiveTaskId?: string;
  readonly updatedAt: string;
}

/** Derived, always computed — never stored as a second source of truth. */
export interface SessionProgress {
  readonly sessionId: string;
  readonly totalTasks: number;
  readonly completedTasks: number;
  readonly completionRatio: number;
  readonly elapsedMs: number;
}
