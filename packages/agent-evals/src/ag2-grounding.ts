import { buildRescueGrounding } from '@focusloop/agent-core';
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
   * SAFETY: every field below is produced by production code from validated input — the adapter's
   * only job is to rename them for the assertions; the JSON round-trip at the runner boundary is
   * what makes the structure verifiable.
   */
  return {
    action,
    source: grounding === null ? null : grounding.source,
    text: grounding === null ? null : grounding.text,
    grounded: grounding !== null,
  } as unknown as JsonValue;
}
