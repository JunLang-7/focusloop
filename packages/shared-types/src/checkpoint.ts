import type { LocalizedMessage } from './messages';
import type { LearningState } from './state';

/**
 * The "cognitive position" of the learner. This is what makes resume possible:
 * it is enough to reconstruct *where the learner was thinking*, not just which
 * screen they were on.
 */
export interface LearningCheckpoint {
  readonly id: string;
  readonly sessionId: string;
  readonly conceptId: string;
  readonly conceptTitle: string;
  readonly goal: string;
  readonly mastered: readonly string[];
  readonly unresolved: readonly string[];
  readonly currentTaskId: string;
  readonly currentTaskTitle: string;
  /**
   * One-based position of the current task in the **course's own order** — where it sits in the
   * material, not where it sits in the plan the learner may have reordered (#194).
   *
   * The course's order on purpose: the denominator ("of 7") is the course's task list, so counting the
   * numerator from the learner's plan would put two different lists in one fraction, and the plan has
   * no position for the running task at all — it deliberately excludes it. The name says whose order it
   * is because `currentTaskId` beside it is the learner's.
   */
  readonly courseStep: number;
  readonly frictionState: LearningState;
  readonly nextBestAction: LocalizedMessage;
  readonly createdAt: string;
}
