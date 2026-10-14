import type { AgentProposal } from './proposal';
import type { LearningState } from './state';
import type { StuckReason } from './stuck';

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
  /** Audit trail for a confirmed structural proposal that actually ran. */
  'AGENT_PROPOSAL_EXECUTED',
  /**
   * A structural proposal exists and awaits the learner's confirmation (#209).
   *
   * The proposal rides in the payload because the one channel the renderer listens on is the event
   * push: the confirmation dialog must show exactly what will change, from the same object the
   * confirm call will be bound to. Deliberately not in `STATE_AFFECTING_EVENTS` — nothing about the
   * learner's position changes because something was *asked*.
   */
  'AGENT_PROPOSAL_PROPOSED',
  /**
   * The learner put the remaining micro tasks in the order they intend to do them.
   *
   * Not a learning-state transition, and deliberately not in `STATE_AFFECTING_EVENTS`: nothing about
   * where the learner is up to changes, only the order they mean to reach it in. It is an event rather
   * than a column because the order is a decision the learner made, and the log is where decisions are
   * kept (#23).
   */
  'TASKS_REORDERED',
  /**
   * The learner wrote out an answer for the step in front of them, without finishing it.
   *
   * `TASK_COMPLETED.answer` records what they said *when they were done*; this records what they said
   * *while they were on it* — the recall they wrote before the app would take their word for it, whether
   * they then completed the step in the same breath or went back to the material instead. It exists
   * because the two are different facts about a session, and because until it did, prose a learner wrote
   * on the way into a question lived only in the tutor's in-memory transcript: nothing durable, nothing
   * an agent could be shown, gone when the question was answered.
   *
   * Deliberately not in `STATE_AFFECTING_EVENTS`: writing something down moves nothing. Where the
   * learner is up to is `TASK_STARTED` and `TASK_COMPLETED`, and a step the learner has answered is
   * still a step they are on — the same reasoning as `TASKS_REORDERED` below.
   */
  'TASK_ANSWERED',
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
/**
 * The step is done — and, when the learner wrote something, what they wrote.
 *
 * `answer` is optional and was added after events with the old shape had already been written, so a
 * completion without one means "they finished it and said nothing", which is a different fact from any
 * answer and has to stay distinguishable. It is bounded by `LEARNER_ANSWER_CHARACTERS` at the point it
 * is written; the bound is stated in `shared-types` because the input, the row and the model's context
 * all have to agree on it.
 *
 * The learner's own words sit in the event rather than in a table of their own because that is what
 * this log is: the record of what happened, in one place, deleted in one place. What the agent then
 * gets is a *projection* of it with its own, smaller bound — the event is the truth, the context is the
 * budgeted view of it.
 */
export type TaskCompletedEvent = LearningEventBase<
  'TASK_COMPLETED',
  { taskId: string; answer?: string }
>;
export type HelpRequestedEvent = LearningEventBase<
  'HELP_REQUESTED',
  {
    taskId?: string;
    /**
     * Why the learner says they are stuck, when they have said.
     *
     * Optional on purpose: the button can be pressed before a reason is given, and events written
     * before this field existed are still read back out of the store. An absent reason means "they did
     * not say", which is different from any of the reasons and has to stay distinguishable.
     */
    reason?: StuckReason;
  }
>;
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
/**
 * The envelope's domain event: a confirmed proposal ran once.
 *
 * Deliberately not in `STATE_AFFECTING_EVENTS` — executing a proposal is an
 * audit fact, not a transition in the learning state machine.
 */
export type AgentProposalExecutedEvent = LearningEventBase<
  'AGENT_PROPOSAL_EXECUTED',
  { proposalId: string; kind: string; idempotencyKey: string }
>;
/**
 * The proposal itself, whole: id, payload, hash, expiry — everything the dialog shows and the
 * confirmation binds to. The only alternative was a read channel for pending proposals, and the
 * renderer's event push already reaches every screen this can appear on (#209).
 */
export type AgentProposalProposedEvent = LearningEventBase<
  'AGENT_PROPOSAL_PROPOSED',
  { proposal: AgentProposal }
>;
/**
 * The whole intended order of the tasks the learner can still see, front to back.
 *
 * The complete list rather than one move, because the reducer cannot resolve a move on its own: it
 * knows the session, not the course, so "move `t3` to position 1" would have to be replayed against a
 * task list it does not have. Carrying the result keeps the event self-describing and the reducer free
 * of course knowledge. The cost is that the client is the only thing that can produce it, so the
 * reducer validates the shape and leaves the meaning to `applyTaskOrder`, which is where the list it
 * has to be true of actually exists.
 */
export type TasksReorderedEvent = LearningEventBase<
  'TASKS_REORDERED',
  { order: readonly string[] }
>;
/**
 * What the learner wrote for a step they are still on.
 *
 * `text` is required where `TASK_COMPLETED.answer` is optional, and the asymmetry is the point: an
 * event whose whole content is the learner's own words has nothing to say without them, so an empty
 * one is not a quieter version of this fact — it is a caller that has made a mistake. Bounded by
 * `LEARNER_ANSWER_CHARACTERS` at the door, like the completion's answer, and projected into an agent
 * context under the smaller `answerCharacters` budget.
 */
export type TaskAnsweredEvent = LearningEventBase<
  'TASK_ANSWERED',
  { taskId: string; text: string }
>;

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
  | SessionEndedEvent
  | AgentProposalExecutedEvent
  | AgentProposalProposedEvent
  | TasksReorderedEvent
  | TaskAnsweredEvent;

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
