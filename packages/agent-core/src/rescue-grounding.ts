import {
  ADAPTIVE_TASK_LIMITS,
  type AgentContext,
  type RescueAction,
  type RescueGrounding,
} from '@focusloop/shared-types';
import { groundedSplitTexts, materialSentence } from './adaptive-task';

/**
 * What a HINT or an EXAMPLE card quotes (AG2.5 / AG2.6).
 *
 * Pure and offline: it picks a passage the agent context already carries, so the card says something
 * about *this* concept without a provider, a prompt or a second source of truth.
 *
 * - HINT quotes the concept's idea (its summary, else its first key point). It points at what applies
 *   here and deliberately stops short of the task's own wording, so it is a cue and not the answer.
 * - EXAMPLE quotes a passage of the learner's own material (else the concept's last key point), so the
 *   pattern they are asked to notice is one they have in front of them.
 *
 * `null` is the ordinary answer when nothing is grounded: the card keeps its fixed steps. A passage
 * that merely repeats the task, or is longer than a drafted step may be, is not help and is not used.
 */
export function buildRescueGrounding(
  action: RescueAction,
  context: AgentContext | null,
): RescueGrounding | null {
  if (context === null) return null;
  const keyPoints = groundedSplitTexts(context);
  if (action === 'HINT') {
    const summary = quotable(context.concept.summary, context);
    if (summary !== null) return { source: 'concept-summary', text: summary };
    const first = keyPoints[0];
    return first === undefined ? null : { source: 'concept-key-point', text: first };
  }
  if (action === 'EXAMPLE') {
    const sentence = materialSentence(context);
    if (sentence !== null) return { source: 'material-sentence', text: sentence };
    const last = keyPoints[keyPoints.length - 1];
    return last === undefined ? null : { source: 'concept-key-point', text: last };
  }
  return null;
}

function quotable(value: string | null, context: AgentContext): string | null {
  if (value === null) return null;
  const text = value.trim();
  if (text.length === 0 || [...text].length > ADAPTIVE_TASK_LIMITS.focusCharacters) return null;
  if (text === context.task.title?.trim() || text === context.task.instructions?.trim())
    return null;
  return text;
}
