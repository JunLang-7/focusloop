import { buildTutorPrompt } from '@focusloop/agent-core';
import { isTutorMode, type TutorTurn } from '@focusloop/shared-types';
import { fixtureContext } from './ag2-fixtures';
import type { JsonObject, JsonValue } from './scenario';

function isRecord(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function turns(value: JsonValue | undefined): readonly TutorTurn[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error('AG3 follow-up turns must be a list');
  return value.map((turn) => {
    if (!isRecord(turn)) throw new Error('AG3 follow-up turn must be an object');
    const role = turn['role'];
    const text = turn['text'];
    if ((role !== 'learner' && role !== 'tutor') || typeof text !== 'string') {
      throw new Error('AG3 follow-up turn must have a learner/tutor role and text');
    }
    return { role, text };
  });
}

/**
 * A follow-up question in the tutor conversation (AG3), evaluated as AG10.1's scenarios.
 *
 * The three answers: a follow-up carries the turns that came before it, the question obeys its own
 * bound beside the context's, and a question that is nothing but the format's own labels is refused
 * rather than sent as an empty paid call — the artefact the clamp exists to prevent.
 */
export function runAg3FollowupAdapter(input: JsonValue): JsonValue {
  if (!isRecord(input)) throw new Error('AG3 follow-up input must be an object');
  const question = input['question'];
  if (typeof question !== 'string') throw new Error('AG3 follow-up question must be a string');

  const modeValue = input['mode'];
  if (modeValue !== undefined && !isTutorMode(modeValue)) {
    throw new Error(`AG3 follow-up unknown mode: ${JSON.stringify(modeValue)}`);
  }
  const expectTurn = input['expectTurn'];
  if (expectTurn !== undefined && typeof expectTurn !== 'string') {
    throw new Error('AG3 follow-up expectTurn must be a string');
  }

  const context = fixtureContext(input);
  if (context === null) throw new Error('AG3 follow-up fixture needs a session');

  const result = buildTutorPrompt({
    mode: modeValue === undefined ? 'EXPLAIN' : modeValue,
    context,
    question,
    turns: turns(input['turns']),
  });

  /*
   * SAFETY: every field below is produced by production code from validated input — the adapter's
   * only job is to rename them for the assertions; the JSON round-trip at the runner boundary is
   * what makes the structure verifiable.
   */
  return {
    status: result.status,
    reason: result.status === 'refused' ? result.reason : null,
    includesPriorTurn:
      result.status === 'built' && expectTurn !== undefined
        ? result.prompt.includes(expectTurn)
        : false,
    prompt: result.status === 'built' ? result.prompt : '',
    promptCharacters: result.status === 'built' ? result.prompt.length : 0,
    excerptCharacters: result.report.sent.excerptCharacters,
  } as unknown as JsonValue;
}
