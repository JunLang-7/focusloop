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
  readonly currentStep: number;
  readonly frictionState: LearningState;
  readonly nextBestAction: LocalizedMessage;
  readonly createdAt: string;
}
