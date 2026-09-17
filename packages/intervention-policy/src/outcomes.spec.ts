import { describe, expect, it } from 'vitest';
import type { Intervention, InterventionOutcome } from '@focusloop/shared-types';
import {
  acceptanceRate,
  averageResumeLatencyMs,
  recordOutcome,
  summarizeOutcomes,
} from './outcomes';
import { at, interventionWith, T0 } from './fixtures';

function outcomeFixture(
  overrides: Partial<InterventionOutcome> & { intervention: Intervention },
): InterventionOutcome {
  const { intervention, ...rest } = overrides;
  return recordOutcome({
    id: `outcome-${intervention.id}`,
    intervention,
    at: T0,
    accepted: true,
    dismissed: false,
    taskCompleted: false,
    resumeLatencyMs: null,
    quizOutcome: null,
    ...rest,
  });
}

describe('recordOutcome', () => {
  it('copies the intervention identity and state', () => {
    const intervention = interventionWith(T0, 'BREAK');
    const outcome = outcomeFixture({ intervention });
    expect(outcome).toMatchObject({
      interventionId: intervention.id,
      sessionId: intervention.sessionId,
      action: 'BREAK',
      state: 'CONFUSED',
    });
  });

  it('preserves a null resume latency', () => {
    const outcome = outcomeFixture({ intervention: interventionWith(T0), resumeLatencyMs: null });
    expect(outcome.resumeLatencyMs).toBeNull();
  });

  it('records the quiz outcome when the learner answered', () => {
    const outcome = outcomeFixture({
      intervention: interventionWith(T0),
      quizOutcome: 'incorrect',
    });
    expect(outcome.quizOutcome).toBe('incorrect');
  });
});

describe('summarizeOutcomes', () => {
  it('always emits a row for every known action', () => {
    const summary = summarizeOutcomes([]);
    expect(summary.map((row) => row.action)).toContain('NO_ACTION');
    expect(summary.map((row) => row.action)).toContain('RESUME');
    expect(summary.every((row) => row.total === 0)).toBe(true);
  });

  it('aggregates accept / dismiss / completion counts per action', () => {
    const summary = summarizeOutcomes([
      outcomeFixture({
        intervention: interventionWith(at(1), 'HINT'),
        accepted: true,
        taskCompleted: true,
      }),
      outcomeFixture({
        intervention: interventionWith(at(2), 'HINT'),
        accepted: false,
        dismissed: true,
      }),
      outcomeFixture({ intervention: interventionWith(at(3), 'BREAK'), accepted: true }),
    ]);

    const hint = summary.find((row) => row.action === 'HINT');
    expect(hint).toMatchObject({ total: 2, accepted: 1, dismissed: 1, tasksCompleted: 1 });
    const breakRow = summary.find((row) => row.action === 'BREAK');
    expect(breakRow).toMatchObject({ total: 1, accepted: 1 });
  });
});

describe('averageResumeLatencyMs', () => {
  it('returns null when nothing recorded a latency', () => {
    expect(averageResumeLatencyMs([])).toBeNull();
    expect(
      averageResumeLatencyMs([outcomeFixture({ intervention: interventionWith(T0) })]),
    ).toBeNull();
  });

  it('averages the recorded latencies', () => {
    const outcomes = [
      outcomeFixture({ intervention: interventionWith(at(1)), resumeLatencyMs: 1_000 }),
      outcomeFixture({ intervention: interventionWith(at(2)), resumeLatencyMs: 3_000 }),
    ];
    expect(averageResumeLatencyMs(outcomes)).toBe(2_000);
  });

  it('ignores non-finite values', () => {
    const outcomes = [
      outcomeFixture({ intervention: interventionWith(at(1)), resumeLatencyMs: 2_000 }),
      outcomeFixture({ intervention: interventionWith(at(2)), resumeLatencyMs: Number.NaN }),
    ];
    expect(averageResumeLatencyMs(outcomes)).toBe(2_000);
  });
});

describe('acceptanceRate', () => {
  it('is null when nothing was ever shown', () => {
    expect(acceptanceRate([])).toBeNull();
    expect(
      acceptanceRate([outcomeFixture({ intervention: interventionWith(T0, 'NO_ACTION') })]),
    ).toBeNull();
  });

  it('ignores NO_ACTION outcomes in the denominator', () => {
    const outcomes = [
      outcomeFixture({ intervention: interventionWith(at(1), 'HINT'), accepted: true }),
      outcomeFixture({ intervention: interventionWith(at(2), 'HINT'), accepted: false }),
      outcomeFixture({ intervention: interventionWith(at(3), 'NO_ACTION'), accepted: false }),
    ];
    expect(acceptanceRate(outcomes)).toBeCloseTo(0.5);
  });
});
