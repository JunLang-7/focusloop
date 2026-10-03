import type { LearningState } from './state';

export interface LearningSession {
  readonly id: string;
  readonly courseId: string;
  readonly startedAt: string;
  readonly endedAt?: string;
  readonly state: LearningState;
  readonly currentTaskId?: string;
  readonly completedTaskIds: readonly string[];
  /**
   * The order the learner put the remaining tasks in, front to back (#23).
   *
   * Empty until they reorder something, and empty again on the next session: the order belongs to the
   * session, not to the course, so starting another one is a clean slate rather than a standing
   * preference they cannot get back out of.
   *
   * It is an ordering *hint*, not a list of tasks: the tasks themselves come from the course, and a
   * task that has since been completed or dropped simply is not there to be found. `applyTaskOrder`
   * is what turns this into an order over the tasks that actually exist, and it is why a stale or
   * partial list cannot lose anyone's work.
   */
  readonly taskOrder?: readonly string[];
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
