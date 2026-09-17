/**
 * Closed vocabularies mapped to translation keys.
 *
 * These live in one place so a new learning state — or a new intervention action
 * — cannot be added without someone deciding how it reads in both languages.
 */
import type { InterventionAction, LearningState } from '@focusloop/shared-types';
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

export const KIND_KEYS: Record<string, MessageKey> = {
  read: 'kind.read',
  practice: 'kind.practice',
  quiz: 'kind.quiz',
};

export function kindLabel(kind: string, t: (key: MessageKey) => string): string {
  const key = KIND_KEYS[kind];
  return key === undefined ? kind : t(key);
}
