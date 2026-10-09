import { describe, expect, it } from 'vitest';
import type { ToolCallRecord } from '@focusloop/shared-types';
import { toolCallRowView } from './tool-call-view';

function record(overrides: Partial<ToolCallRecord> = {}): ToolCallRecord {
  return {
    id: 'tc-1',
    sessionId: 's1',
    tool: 'readCurrentTask',
    args: {},
    status: 'ok',
    confirmation: null,
    error: null,
    at: '2026-01-01T00:05:00.000Z',
    idempotencyKey: null,
    eventId: null,
    ...overrides,
  };
}

describe('a tool-call row as the inspector shows it (AG8.8)', () => {
  it('reads a refusal as the reason it carries, not as a generic failure', () => {
    const view = toolCallRowView(
      record({ tool: 'dropTable', status: 'refused', error: 'unknown-tool' }),
    );
    expect(view.tool).toBe('dropTable');
    expect(view.stateKey).toBe('tool.refusal.unknown-tool');
    expect(view.detail).toBe('');
  });

  it('reads a call that resolved an event as applied, and names the event', () => {
    const view = toolCallRowView(record({ eventId: 'evt-9' }));
    expect(view.stateKey).toBe('agent.inspector.tools.applied');
    expect(view.detail).toBe('evt-9');
  });

  it('reads a side-effect-free success as a run with nothing to link', () => {
    const view = toolCallRowView(record());
    expect(view.stateKey).toBe('agent.inspector.tools.ran');
    expect(view.detail).toBe('');
  });
});
