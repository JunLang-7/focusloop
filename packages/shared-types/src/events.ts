import type { LearningState } from './state';

/** Where an event came from. Never used to infer content, only provenance. */
export type LearningEventSource = 'user' | 'extension' | 'simulator' | 'system' | 'agent';

export const LEARNING_EVENT_TYPES = [
  'SESSION_STARTED',
  'TASK_STARTED',
  'TASK_COMPLETED',
  'HELP_REQUESTED',
  'QUIZ_CORRECT',
  'QUIZ_INCORRECT',
  'TAB_LEFT',
  'TAB_RETURNED',
  'IDLE_STARTED',
  'IDLE_ENDED',
  'RESUME_REQUESTED',
  'RESUME_DISMISSED',
  'SESSION_ENDED',
] as const;

export type LearningEventType = (typeof LEARNING_EVENT_TYPES)[number];

interface LearningEventBase<TType extends LearningEventType, TPayload> {
  readonly id: string;
  readonly sessionId: string;
  /** ISO-8601 timestamp, always UTC. */
  readonly at: string;
  readonly type: TType;
  readonly source: LearningEventSource;
  readonly payload: TPayload;
}

export type SessionStartedEvent = LearningEventBase<
  'SESSION_STARTED',
  { courseId: string; sessionId: string }
>;
export type TaskStartedEvent = LearningEventBase<'TASK_STARTED', { taskId: string }>;
export type TaskCompletedEvent = LearningEventBase<'TASK_COMPLETED', { taskId: string }>;
export type HelpRequestedEvent = LearningEventBase<'HELP_REQUESTED', { taskId?: string }>;
export type QuizCorrectEvent = LearningEventBase<
  'QUIZ_CORRECT',
  { taskId: string; quizId: string }
>;
export type QuizIncorrectEvent = LearningEventBase<
  'QUIZ_INCORRECT',
  { taskId: string; quizId: string }
>;
/** `url` is optional and, when present, must already be redacted to an origin. */
export type TabLeftEvent = LearningEventBase<'TAB_LEFT', { origin?: string }>;
export type TabReturnedEvent = LearningEventBase<'TAB_RETURNED', { awayMs: number }>;
export type IdleStartedEvent = LearningEventBase<'IDLE_STARTED', { taskId?: string }>;
export type IdleEndedEvent = LearningEventBase<'IDLE_ENDED', { idleMs: number }>;
export type ResumeRequestedEvent = LearningEventBase<'RESUME_REQUESTED', { checkpointId: string }>;
export type ResumeDismissedEvent = LearningEventBase<'RESUME_DISMISSED', { checkpointId: string }>;
export type SessionEndedEvent = LearningEventBase<'SESSION_ENDED', { reason: SessionEndReason }>;

export type SessionEndReason = 'user' | 'completed' | 'timeout' | 'crashed';

export const SESSION_END_REASONS = ['user', 'completed', 'timeout', 'crashed'] as const;

export type LearningEvent =
  | SessionStartedEvent
  | TaskStartedEvent
  | TaskCompletedEvent
  | HelpRequestedEvent
  | QuizCorrectEvent
  | QuizIncorrectEvent
  | TabLeftEvent
  | TabReturnedEvent
  | IdleStartedEvent
  | IdleEndedEvent
  | ResumeRequestedEvent
  | ResumeDismissedEvent
  | SessionEndedEvent;

export type LearningEventOf<TType extends LearningEventType> = Extract<
  LearningEvent,
  { type: TType }
>;

/** Any event that carries a taskId in its payload. */
export type TaskScopedEvent = Extract<LearningEvent, { payload: { taskId: string } }>;

export interface LearningEventRecord {
  readonly id: string;
  readonly sessionId: string;
  readonly at: string;
  readonly type: LearningEventType;
  readonly source: LearningEventSource;
  readonly payload: Record<string, unknown>;
}

/** Event types that the state engine reacts to by changing state. */
export const STATE_AFFECTING_EVENTS: readonly LearningEventType[] = [
  'SESSION_STARTED',
  'TASK_STARTED',
  'TASK_COMPLETED',
  'HELP_REQUESTED',
  'QUIZ_INCORRECT',
  'QUIZ_CORRECT',
  'TAB_LEFT',
  'TAB_RETURNED',
  'IDLE_STARTED',
  'IDLE_ENDED',
  'RESUME_REQUESTED',
  'RESUME_DISMISSED',
  'SESSION_ENDED',
];

export interface StateTransition {
  readonly from: LearningState;
  readonly to: LearningState;
  readonly at: string;
  readonly eventId: string;
  readonly eventType: LearningEventType;
  readonly reason: string;
}
