import { describe, expect, it } from 'vitest';
import type { AgentMemorySummary } from '@focusloop/shared-types';
import { AGENT_MEMORY_SOURCES, AGENT_MEMORY_SCOPES } from '@focusloop/shared-types';
import {
  MEMORY_IMPACT_KEYS,
  MEMORY_REASON_KEYS,
  MEMORY_SCOPE_KEYS,
  MEMORY_SOURCE_KEYS,
  PREFERENCE_SCOPE_KEYS,
  memoryRefusalKey,
  memoryRows,
  preferenceRowView,
} from './memory-view';
import { LEARNER_PREFERENCE_SCOPES, type LearnerPreference } from '@focusloop/shared-types';

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

function preference(overrides: Partial<LearnerPreference> = {}): LearnerPreference {
  return {
    id: 'pref-1',
    sessionId: 's1',
    scope: 'task-size',
    value: { stepMinutes: 2 },
    evidence: {
      windowStart: '2026-01-01T00:00:00.000Z',
      windowEnd: '2026-01-08T00:00:00.000Z',
      sampleSize: 6,
    },
    source: 'ag6.task-size',
    confirmedAt: '2026-01-08T00:05:00.000Z',
    expiresAt: null,
    createdAt: '2026-01-08T00:05:00.000Z',
    ...overrides,
  };
}

describe('a stored preference as the panel shows it (AG7.4/7.6)', () => {
  const clock = (iso: string | null): string => (iso === null ? '—' : iso.slice(11, 16));

  it('names every scope in the closed vocabulary', () => {
    for (const scope of LEARNER_PREFERENCE_SCOPES) {
      expect(PREFERENCE_SCOPE_KEYS[scope]).toBe(`app.data.preference.scope.${scope}`);
    }
  });

  it('shows the value as bounded text, the evidence as its window, and whether it is confirmed', () => {
    const row = preferenceRowView(preference(), clock);
    expect(row.scopeKey).toBe('app.data.preference.scope.task-size');
    expect(row.valueText).toBe('{"stepMinutes":2}');
    expect(row.evidenceParams).toEqual({
      samples: '6',
      from: '00:00',
      to: '00:00',
    });
    expect(row.confirmedAt).not.toBeNull();
  });

  it('says plainly when nothing has confirmed it yet, and bounds a value that would grow the row', () => {
    const unconfirmed = preferenceRowView(preference({ confirmedAt: null }), clock);
    expect(unconfirmed.confirmedAt).toBeNull();

    const long = preferenceRowView(preference({ value: { note: 'x'.repeat(500) } }), clock);
    expect(long.valueText.length).toBeLessThanOrEqual(140);
    expect(long.valueText.endsWith('…')).toBe(true);
  });
});
