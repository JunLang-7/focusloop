/** A single idea the learner is meant to acquire. */
export interface Concept {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  readonly order: number;
  readonly keyPoints: readonly string[];
}

export type MicroTaskKind = 'read' | 'practice' | 'quiz';

export interface MicroTask {
  readonly id: string;
  readonly courseId: string;
  readonly conceptId: string;
  readonly title: string;
  readonly instructions: string;
  readonly kind: MicroTaskKind;
  /** Deliberately small: 2–8 minutes keeps initiation friction low. */
  readonly estimatedMinutes: number;
  readonly order: number;
}

export interface Quiz {
  readonly id: string;
  readonly taskId: string;
  readonly conceptId: string;
  readonly question: string;
  readonly options: readonly string[];
  readonly answerIndex: number;
  readonly explanation: string;
}

export interface Course {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly concepts: readonly Concept[];
  readonly microTasks: readonly MicroTask[];
  readonly quizzes: readonly Quiz[];
}

/**
 * A scripted interruption used by the demo fixtures and the event simulator.
 * `afterTaskId` makes the fixture deterministic.
 */
export interface InterruptionFixture {
  readonly id: string;
  readonly courseId: string;
  readonly afterTaskId: string;
  readonly kind: 'distraction' | 'idle' | 'confusion' | 'overload';
  readonly durationMs: number;
  readonly description: string;
}
