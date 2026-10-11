import { acceptRescueSuggestion, buildRescueGrounding } from '@focusloop/agent-core';
import { ADAPTIVE_TASK_LIMITS } from '@focusloop/shared-types';
import { fixtureContext } from './ag2-fixtures';
import type { JsonObject, JsonValue } from './scenario';

function isRecord(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * What a HINT or an EXAMPLE actually quotes (AG2.5/2.6, evaluated as AG10.4).
 *
 * Runs the production `buildRescueGrounding` against a context the production builder produced, so
 * the scenarios pin the selector — summary else key point, material sentence else last key point,
 * and the `quotable` guard that refuses text merely repeating the task — against real output rather
 * than a copy of the rule.
 */
export function runAg2GroundingAdapter(input: JsonValue): JsonValue {
  if (!isRecord(input)) throw new Error('AG2 grounding input must be an object');
  const action = input['action'];
  if (action !== 'HINT' && action !== 'EXAMPLE') {
    throw new Error('AG2 grounding action must be HINT or EXAMPLE');
  }
  const context = fixtureContext(input);
  if (context === null) throw new Error('AG2 grounding fixture needs a session');
  const grounding = buildRescueGrounding(action, context);
  /*
   * #205: when the scenario names a generated line, the acceptance layer runs over it first —
   * a line inside the card's bound becomes the grounding, marked `model-generated`; an empty or
   * over-bound line falls back to the taken quote. The fallback IS the assertion: the card shows
   * the grounded text, never nothing.
   */
  let shown = grounding;
  if (input['generatedOverBound'] === true) {
    shown =
      acceptRescueSuggestion('x'.repeat(ADAPTIVE_TASK_LIMITS.focusCharacters + 1)) ?? grounding;
  } else if (typeof input['generated'] === 'string') {
    shown = acceptRescueSuggestion(input['generated']) ?? grounding;
  }
  /*
   * SAFETY: every field below is produced by production code from validated input — the adapter's
   * only job is to rename them for the assertions; the JSON round-trip at the runner boundary is
   * what makes the structure verifiable.
   */
  return {
    action,
    source: shown === null ? null : shown.source,
    text: shown === null ? null : shown.text,
    grounded: shown !== null,
  } as unknown as JsonValue;
}
