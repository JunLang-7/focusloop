import type { MicroTaskKind } from './course';
import type { LearningEventSource, SessionEndReason, LearningEventType } from './events';
import type { StuckReason } from './stuck';
import type { LearningState } from './state';
import type { LocalizedMessage } from './messages';

/**
 * What the agent is allowed to know about the current moment.
 *
 * The point of this type is its **boundaries**, not its fields. Handing a model the course list, the
 * session log and the database is easy to write and impossible to keep honest: the prompt grows with
 * the learner's history, the cost stops being predictable, and nothing states what the model may see.
 *
 * What this file actually guarantees, precisely: every field is either bounded by a limit named in
 * `AGENT_CONTEXT_LIMITS` or is a single record, and every exclusion is itemised in
 * `AgentContextOmission` rather than silently dropped. What it does **not** guarantee is the input —
 * the source is assembled by the caller, so this describes the shape of what is handed over, not the
 * policy for choosing it.
 *
 * The persisted checkpoint is projected into a bounded cognitive summary. Persistence identifiers do
 * not help the agent reason, and learner-authored goal or task text must not create an unbounded route
 * around the material and event budgets.
 *
 * The persistence model remains `LearningCheckpoint`; `AgentContextCheckpoint` is deliberately a
 * separate projection so adding a database field cannot silently widen the agent boundary.
 */

/** A bounded piece of the imported material — never the document. */
export interface MaterialExcerpt {
  readonly materialId: string | null;
  readonly title: string | null;
  readonly heading: string | null;
  readonly text: string;
  /** True when the section was longer than the excerpt, so `text` is its beginning. */
  readonly truncated: boolean;
}

export interface SessionContext {
  readonly sessionId: string;
  readonly startedAt: string;
  readonly elapsedMs: number;
  readonly completedTasks: number;
  readonly totalTasks: number;
}

export interface ConceptContext {
  readonly conceptId: string | null;
  readonly title: string | null;
  readonly summary: string | null;
  readonly keyPoints: readonly string[];
}

export interface TaskContext {
  readonly taskId: string | null;
  readonly title: string | null;
  readonly instructions: string | null;
  readonly kind: MicroTaskKind | null;
  readonly estimatedMinutes: number | null;
  /** One-based position inside the course, which is what "step 3 of 7" counts. */
  readonly step: number;
  readonly totalSteps: number;
}

/**
 * The event representation that may cross the agent boundary.
 *
 * This is deliberately not `LearningEvent`: event ids, session ids and the source payload are
 * persistence concerns, and several persisted payloads contain fields that must never be shown to
 * an agent. The builder projects a domain event into this closed, per-type allowlist.
 */
type AgentContextEventBase<TType extends LearningEventType, TPayload> = {
  readonly type: TType;
  readonly at: string;
  readonly source: LearningEventSource;
  readonly payload: TPayload;
};

type EmptyAgentContextPayload = Record<string, never>;

/** Events and payload fields that are safe for the agent context. */
export type AgentContextEvent =
  | AgentContextEventBase<'SESSION_STARTED', EmptyAgentContextPayload>
  | AgentContextEventBase<'TASK_STARTED', { readonly taskId: string }>
  | AgentContextEventBase<'TASK_COMPLETED', { readonly taskId: string }>
  | AgentContextEventBase<
      'HELP_REQUESTED',
      { readonly taskId?: string; readonly reason?: StuckReason }
    >
  | AgentContextEventBase<'QUIZ_CORRECT', { readonly taskId: string; readonly quizId: string }>
  | AgentContextEventBase<'QUIZ_INCORRECT', { readonly taskId: string; readonly quizId: string }>
  | AgentContextEventBase<'TAB_LEFT', EmptyAgentContextPayload>
  | AgentContextEventBase<'TAB_RETURNED', { readonly awayMs: number }>
  | AgentContextEventBase<'IDLE_STARTED', { readonly taskId?: string }>
  | AgentContextEventBase<'IDLE_ENDED', { readonly idleMs: number }>
  | AgentContextEventBase<'RESUME_REQUESTED', EmptyAgentContextPayload>
  | AgentContextEventBase<'RESUME_DISMISSED', EmptyAgentContextPayload>
  | AgentContextEventBase<'SESSION_ENDED', { readonly reason: SessionEndReason }>;

/** The bounded cognitive summary exposed to an agent, without persistence identifiers. */
export interface AgentContextCheckpoint {
  readonly conceptTitle: string;
  readonly goal: string;
  readonly mastered: readonly string[];
  readonly unresolved: readonly string[];
  readonly currentTaskTitle: string;
  readonly currentStep: number;
  readonly frictionState: LearningState;
  readonly nextBestAction: LocalizedMessage;
  readonly createdAt: string;
}

export interface AgentContext {
  readonly session: SessionContext;
  readonly concept: ConceptContext;
  readonly task: TaskContext;
  readonly material: MaterialExcerpt;
  readonly learningState: LearningState;
  /** The most recent events, oldest first. A window, never the whole log. */
  readonly recentEvents: readonly AgentContextEvent[];
  readonly checkpoint: AgentContextCheckpoint | null;
}

/**
 * Something the context deliberately does not carry.
 *
 * Recorded rather than dropped, because "the model was not shown the rest of the material" is a
 * claim worth being able to check. A context that silently excludes things is indistinguishable
 * from one that forgot them, and the difference matters the first time an answer is wrong.
 */
export interface AgentContextOmission {
  /**
   * Which part of the input this is about.
   *
   * `'checkpoint'` was added when the persisted checkpoint became a bounded projection: a rejected
   * or reduced checkpoint is none of the other three, and reporting it as events or material would
   * say something untrue about why it was dropped.
   * `'conversation'` covers bounded Tutor transcript and question inputs for AG3.
   */
  readonly field: 'events' | 'material' | 'courses' | 'session' | 'checkpoint' | 'conversation';
  readonly detail: string;
}

/** The context, and the account of how it was arrived at. */
export interface AgentContextReport {
  readonly context: AgentContext | null;
  readonly omissions: readonly AgentContextOmission[];
}

/**
 * The bounds, in one place, as numbers with reasons.
 *
 * Material is bounded by characters because the failure it prevents is a prompt that grows with the
 * length of whatever the learner happened to import. Events are bounded by count because the failure
 * it prevents is a prompt that grows with how long the session has been running. Both are small
 * enough to be worth reading in full, which is the actual requirement — an agent that needs more
 * than this to decide whether to help is an agent that has stopped being about the current moment.
 */
export const AGENT_CONTEXT_LIMITS = {
  materialCharacters: 1200,
  events: 12,
  /** Upper bound for any identifier copied from an event payload. */
  eventStringCharacters: 256,
  checkpointTextCharacters: 320,
  checkpointItems: 6,
  checkpointParams: 4,
} as const;
