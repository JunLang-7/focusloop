/**
 * Closed vocabularies mapped to translation keys.
 *
 * These live in one place so a new learning state — or a new intervention action
 * — cannot be added without someone deciding how it reads in both languages.
 */
import type { InterventionAction, LearningState, StuckReason } from '@focusloop/shared-types';
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

export function kindLabel(kind: string, t: (key: MessageKey) => string): string {
  const key = KIND_KEYS[kind];
  return key === undefined ? kind : t(key);
}
