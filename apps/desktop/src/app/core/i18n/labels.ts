/**
 * Closed vocabularies mapped to translation keys.
 *
 * These live in one place so a new learning state — or a new intervention action
 * — cannot be added without someone deciding how it reads in both languages.
 */
import type {
  InterventionAction,
  LearningEventSource,
  LearningEventType,
  LearningState,
  StuckReason,
  TutorFallbackReason,
} from '@focusloop/shared-types';
import type { MessageKey } from './messages.en';

export const STATE_KEYS: Record<LearningState, MessageKey> = {
  READY: 'state.READY',
  INITIATION_FRICTION: 'state.INITIATION_FRICTION',
  FOCUSED: 'state.FOCUSED',
  CONFUSED: 'state.CONFUSED',
  OVERLOADED: 'state.OVERLOADED',
  DISTRACTED: 'state.DISTRACTED',
  INTERRUPTED: 'state.INTERRUPTED',
  RESUMING: 'state.RESUMING',
};

export const ACTION_KEYS: Record<InterventionAction, MessageKey> = {
  NO_ACTION: 'agent.action.NO_ACTION',
  MICRO_START: 'agent.action.MICRO_START',
  SIMPLIFY: 'agent.action.SIMPLIFY',
  HINT: 'agent.action.HINT',
  EXAMPLE: 'agent.action.EXAMPLE',
  QUESTION: 'agent.action.QUESTION',
  BREAK: 'agent.action.BREAK',
  RESUME: 'agent.action.RESUME',
};

/**
 * How each kind of stuck reads, in the learner's own voice.
 *
 * These are the words on the buttons they press, so they are written as something a person would say
 * about themselves rather than as a label from a taxonomy. The keys are hyphenated to match the reason
 * values, which keeps the two from drifting apart in a way nobody notices.
 */
export const STUCK_REASON_KEYS: Record<StuckReason, MessageKey> = {
  'cannot-start': 'focus.stuck.cannot-start',
  'do-not-understand': 'focus.stuck.do-not-understand',
  'too-big': 'focus.stuck.too-big',
  'went-wrong': 'focus.stuck.went-wrong',
  'cannot-recall': 'focus.stuck.cannot-recall',
  tired: 'focus.stuck.tired',
};

export const KIND_KEYS: Record<string, MessageKey> = {
  read: 'kind.read',
  practice: 'kind.practice',
  quiz: 'kind.quiz',
};

/**
 * Tutor fallback codes → sentences.
 *
 * The domain returns only the closed `TutorFallbackReason`; this is the renderer's
 * side of the "no domain package produces a sentence" rule (see `docs/architecture.md`).
 * Four unavailabilities and five rejections — both languages are required by typecheck
 * and by `tutor-view.spec.ts`'s totality test.
 */
export const TUTOR_FALLBACK_KEYS: Record<TutorFallbackReason, MessageKey> = {
  'no-question': 'tutor.unavailable.no-question',
  'request-too-long': 'tutor.unavailable.request-too-long',
  'no-model': 'tutor.unavailable.no-model',
  'provider-failed': 'tutor.unavailable.provider-failed',
  unparseable: 'tutor.rejection.unparseable',
  'unexpected-part': 'tutor.rejection.unexpected-part',
  'missing-part': 'tutor.rejection.missing-part',
  'unquoted-confirmation': 'tutor.rejection.unquoted-confirmation',
  'not-from-the-material': 'tutor.rejection.not-from-the-material',
};

export function kindLabel(kind: string, t: (key: MessageKey) => string): string {
  const key = KIND_KEYS[kind];
  return key === undefined ? kind : t(key);
}

/**
 * How each kind of thing that happened reads, in the history rather than in the log.
 *
 * `Record<LearningEventType, MessageKey>` is the point: the event vocabulary is closed, so adding an
 * event type is a type error until someone has decided how it reads, in both languages, instead of a
 * `HELP_REQUESTED` appearing on a Chinese screen. The wording describes what happened to the learner -
 * "Help requested" says who asked, and the audit detail is still on the row's `title`.
 */
export const EVENT_TYPE_KEYS: Record<LearningEventType, MessageKey> = {
  SESSION_STARTED: 'event.type.SESSION_STARTED',
  TASK_STARTED: 'event.type.TASK_STARTED',
  TASK_COMPLETED: 'event.type.TASK_COMPLETED',
  HELP_REQUESTED: 'event.type.HELP_REQUESTED',
  QUIZ_CORRECT: 'event.type.QUIZ_CORRECT',
  QUIZ_INCORRECT: 'event.type.QUIZ_INCORRECT',
  TAB_LEFT: 'event.type.TAB_LEFT',
  TAB_RETURNED: 'event.type.TAB_RETURNED',
  IDLE_STARTED: 'event.type.IDLE_STARTED',
  IDLE_ENDED: 'event.type.IDLE_ENDED',
  RESUME_REQUESTED: 'event.type.RESUME_REQUESTED',
  RESUME_DISMISSED: 'event.type.RESUME_DISMISSED',
  SESSION_ENDED: 'event.type.SESSION_ENDED',
  AGENT_PROPOSAL_EXECUTED: 'event.type.AGENT_PROPOSAL_EXECUTED',
};

/**
 * Where something came from, in words a learner can act on.
 *
 * "simulator" and "extension" are provenance the history needs - whether the app was told or the
 * browser said so - but they are not words anyone reading their own history would use.
 */
export const EVENT_SOURCE_KEYS: Record<LearningEventSource, MessageKey> = {
  user: 'event.source.user',
  extension: 'event.source.extension',
  simulator: 'event.source.simulator',
  system: 'event.source.system',
  agent: 'event.source.agent',
};
