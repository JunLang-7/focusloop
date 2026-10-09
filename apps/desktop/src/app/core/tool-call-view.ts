/**
 * A tool-call row as the inspector shows it (AG8.8).
 *
 * Pure so the interesting decision — what this row *means* to a reader — is unit-tested: a refusal
 * is the reason it already carries, a call that resolved an event is "applied" and names it, and a
 * read that wrote nothing is simply "ran".
 */
import { TOOL_REFUSAL_MESSAGE_KEYS, type ToolCallRecord } from '@focusloop/shared-types';
import type { MessageKey } from './i18n/messages.en';

export interface ToolCallRowView {
  readonly tool: string;
  readonly at: string;
  readonly stateKey: MessageKey;
  /** The event id when the call resolved one; empty otherwise. */
  readonly detail: string;
}

export function toolCallRowView(record: ToolCallRecord): ToolCallRowView {
  if (record.status === 'refused' && record.error !== null) {
    return {
      tool: record.tool,
      at: record.at,
      stateKey: TOOL_REFUSAL_MESSAGE_KEYS[record.error],
      detail: '',
    };
  }
  if (record.eventId !== null) {
    return {
      tool: record.tool,
      at: record.at,
      stateKey: 'agent.inspector.tools.applied',
      detail: record.eventId,
    };
  }
  return { tool: record.tool, at: record.at, stateKey: 'agent.inspector.tools.ran', detail: '' };
}
