import { describe, expect, it } from 'vitest';
import type { AgentMemorySummary } from '@focusloop/shared-types';
import { AGENT_MEMORY_SOURCES, AGENT_MEMORY_SCOPES } from '@focusloop/shared-types';
import {
  MEMORY_IMPACT_KEYS,
  MEMORY_REASON_KEYS,
  MEMORY_SCOPE_KEYS,
  MEMORY_SOURCE_KEYS,
  memoryRefusalKey,
  memoryRows,
} from './memory-view';

function summary(counts: Record<string, number>): AgentMemorySummary {
  return {
    sessionId: 's1',
    sources: AGENT_MEMORY_SOURCES.map((source) => ({
      source,
      count: counts[source] ?? 0,
      latestAt: counts[source] ? '2026-01-01T00:05:00.000Z' : null,
    })),
    cleared: null,
  };
}

describe('memory rows as the data panel shows them (AG7.5)', () => {
  it('names every source, scope, impact and refusal in the closed vocabularies', () => {
    for (const source of AGENT_MEMORY_SOURCES) {
      expect(MEMORY_SOURCE_KEYS[source]).toBe(`app.data.memory.source.${source}`);
      expect(MEMORY_IMPACT_KEYS[source]).toBeDefined();
    }
    for (const scope of AGENT_MEMORY_SCOPES) {
      expect(MEMORY_SCOPE_KEYS[scope]).toBe(`app.data.memory.scope.${scope}`);
    }
    for (const reason of ['wrong-session', 'no-session'] as const) {
      expect(MEMORY_REASON_KEYS[reason]).toBe(`memory.refusal.${reason}`);
    }
  });

  it('shows only what exists, grouped working → episodic → preference', () => {
    const rows = memoryRows(
      summary({
        transcript: 4,
        learning_events: 12,
        agent_proposals: 1,
        learner_preferences: 2,
      }),
    );
    expect(rows.map((row) => row.source)).toEqual([
      'transcript',
      'learning_events',
      'agent_proposals',
      'learner_preferences',
    ]);
    expect(rows.every((row) => row.count > 0)).toBe(true);
    expect(rows.find((row) => row.source === 'transcript')?.scope).toBe('working');
    expect(rows.find((row) => row.source === 'learner_preferences')?.scope).toBe('preference');
    expect(rows[0]?.latestAt).toBe('2026-01-01T00:05:00.000Z');
  });

  it('has no rows when nothing is remembered — the panel’s empty state', () => {
    expect(memoryRows(summary({}))).toEqual([]);
  });

  it('maps a refusal to the key it already carries', () => {
    expect(
      memoryRefusalKey({
        ok: false,
        reason: 'wrong-session',
        messageKey: 'memory.refusal.wrong-session',
      }),
    ).toBe('memory.refusal.wrong-session');
    expect(
      memoryRefusalKey({
        ok: false,
        reason: 'no-session',
        messageKey: 'memory.refusal.no-session',
      }),
    ).toBe('memory.refusal.no-session');
  });
});
