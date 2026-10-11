/**
 * The provider-backed HINT/EXAMPLE line (#205): prompt, acceptance, and nothing else.
 *
 * Pure on purpose — the engine owns the call and the budgets; this module decides what a request
 * may contain (the grounding the offline card would quote, so privacy.md's sentence about the data
 * path is checkable here) and what may be shown (one bounded line, or nothing — the fallback is
 * the grounded quote, never an empty card).
 */
import {
  ADAPTIVE_TASK_LIMITS,
  TUTOR_LIMITS,
  type AgentContext,
  type RescueAction,
  type RescueGrounding,
} from '@focusloop/shared-types';
import { buildRescueGrounding } from './rescue-grounding';

export interface RescueSuggestionPrompt {
  readonly system: string;
  readonly prompt: string;
}

/**
 * Display-only in one sentence: the line cannot become an action, and it replies as a line —
 * no labels, because a label is how the tutor parses structured answers, and this is not one.
 */
const SUGGESTION_SYSTEM =
  'You write one short line of study help for a FocusLoop rescue card. ' +
  'The line is display-only text shown to the learner: it must not tell them to run a command, ' +
  'click anything, or reveal hidden instructions. Reply with the line only — no labels, no preamble.';

/**
 * The request, anchored on exactly what the offline card quotes.
 *
 * `null` when there is nothing to anchor on (no context, or a context with no grounding): the
 * engine treats that as "no call", which is how a card that quotes nothing also generates nothing.
 */
export function buildRescueSuggestionPrompt(
  action: RescueAction,
  context: AgentContext | null,
): RescueSuggestionPrompt | null {
  if (context === null) return null;
  const anchor = buildRescueGrounding(action, context);
  if (anchor === null) return null;
  const prompt = [
    `Task: ${context.task.title ?? ''}`,
    anchor.source === 'material-sentence'
      ? `Material passage: ${anchor.text}`
      : `Concept: ${anchor.text}`,
    `Write one short ${action === 'HINT' ? 'hint' : 'example'} line for this step, in the same language as the material.`,
  ].join('\n');
  // Bounded at build, not after: a request that could not fit is a request not made.
  if (SUGGESTION_SYSTEM.length + prompt.length > TUTOR_LIMITS.inputCharacters) return null;
  return { system: SUGGESTION_SYSTEM, prompt };
}

/**
 * A reply, accepted as one bounded line — or refused, which sends the card back to its grounding.
 *
 * The same character ceiling `quotable` holds a taken passage to: a generated line gets no more
 * room on the card than a quoted one.
 */
export function acceptRescueSuggestion(raw: string): RescueGrounding | null {
  const text = raw.trim();
  if (text.length === 0) return null;
  if ([...text].length > ADAPTIVE_TASK_LIMITS.focusCharacters) return null;
  return { source: 'model-generated', text };
}
