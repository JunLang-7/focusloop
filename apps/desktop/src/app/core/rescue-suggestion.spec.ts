import { describe, expect, it } from 'vitest';
import type { RescueView } from '@focusloop/shared-types';
import { shouldSuggestRescueText } from './rescue-suggestion';

/** The card as the engine hands it to the renderer: an active HINT with a grounded quote. */
function rescue(action: 'HINT' | 'BREAK'): RescueView {
  return {
    interventionId: 'iv-1',
    sessionId: 's1',
    phase: 'active',
    decision: {
      action,
      state: 'CONFUSED',
      reason: { key: 'reason.confused.hint', params: {} },
      confidence: 1,
      estimatedMinutes: 3,
    },
    plan: {
      interventionId: 'iv-1',
      sessionId: 's1',
      taskId: 'rbt-t1',
      action,
      steps: [],
      grounding: { source: 'concept-summary', text: 'A rotation restructures three nodes.' },
      estimatedMinutes: 3,
      source: 'deterministic-local',
    },
  };
}

describe('when the renderer asks for a generated suggestion line (#205)', () => {
  it('asks once for an active HINT/EXAMPLE when — and only when — a provider is configured', () => {
    expect(
      shouldSuggestRescueText({
        rescue: rescue('HINT'),
        providerOffline: false,
        attempted: new Set<string>(),
      }),
    ).toBe(true);
  });

  it('does not ask when the provider is the offline default, or before one is known', () => {
    expect(
      shouldSuggestRescueText({
        rescue: rescue('HINT'),
        providerOffline: true,
        attempted: new Set<string>(),
      }),
    ).toBe(false);
    // Runtime info has not landed yet: asking now would be a call the config never authorised.
    expect(
      shouldSuggestRescueText({
        rescue: rescue('HINT'),
        providerOffline: undefined,
        attempted: new Set<string>(),
      }),
    ).toBe(false);
  });

  it('never asks twice for the same card — the budget is one call per rescue', () => {
    const attempted = new Set(['iv-1']);
    expect(
      shouldSuggestRescueText({ rescue: rescue('HINT'), providerOffline: false, attempted }),
    ).toBe(false);
    expect(
      shouldSuggestRescueText({
        rescue: rescue('HINT'),
        providerOffline: false,
        attempted: new Set<string>(),
      }),
    ).toBe(true);
  });

  it('skips cards with no line to write: no rescue, no plan, or a non-HINT action', () => {
    expect(
      shouldSuggestRescueText({ rescue: null, providerOffline: false, attempted: new Set() }),
    ).toBe(false);
    expect(
      shouldSuggestRescueText({
        rescue: { ...rescue('HINT'), plan: null },
        providerOffline: false,
        attempted: new Set(),
      }),
    ).toBe(false);
    expect(
      shouldSuggestRescueText({
        rescue: rescue('BREAK'),
        providerOffline: false,
        attempted: new Set(),
      }),
    ).toBe(false);
  });
});
