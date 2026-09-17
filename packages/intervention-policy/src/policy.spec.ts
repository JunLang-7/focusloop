import { describe, expect, it } from 'vitest';
import type { Intervention } from '@focusloop/shared-types';
import { DOMAIN_MESSAGE_KEYS } from '@focusloop/shared-types';
import { createIntervention, decideIntervention, type DecideInterventionInput } from './policy';
import { resolvePolicyConfig, type InterventionPolicyConfig } from './config';
import { at, engineWith, eventWith, interventionWith, T0, taskWith } from './fixtures';

function decide(
  patch: Partial<DecideInterventionInput> = {},
  config: Partial<InterventionPolicyConfig> = {},
) {
  return decideIntervention(
    {
      engineState: engineWith(),
      recentEvents: [],
      shownInterventions: [],
      currentTask: null,
      now: T0,
      ...patch,
    },
    config,
  );
}

describe('intervention policy — quiet by default', () => {
  it('does nothing while the learner is focused', () => {
    const decision = decide({ engineState: engineWith({ state: 'FOCUSED', currentTaskId: 't1' }) });
    expect(decision.action).toBe('NO_ACTION');
  });

  it('does nothing in the initial READY state', () => {
    expect(decide().action).toBe('NO_ACTION');
  });

  it('does nothing while the learner is merely distracted', () => {
    const decision = decide({
      engineState: engineWith({ state: 'DISTRACTED', awaySince: T0 }),
      now: at(1_000),
    });
    expect(decision.action).toBe('NO_ACTION');
    expect(decision.reason.key).toBe('reason.distracted');
  });

  it('does nothing while resuming', () => {
    expect(decide({ engineState: engineWith({ state: 'RESUMING' }) }).action).toBe('NO_ACTION');
  });

  it('never returns an action without a reason', () => {
    const states = [
      'READY',
      'FOCUSED',
      'DISTRACTED',
      'CONFUSED',
      'OVERLOADED',
      'INTERRUPTED',
      'INITIATION_FRICTION',
      'RESUMING',
    ] as const;
    for (const state of states) {
      const decision = decide({ engineState: engineWith({ state }) });
      expect(DOMAIN_MESSAGE_KEYS).toContain(decision.reason.key);
      expect(decision.confidence).toBeGreaterThanOrEqual(0);
      expect(decision.confidence).toBeLessThanOrEqual(1);
    }
  });
});

describe('intervention policy — state driven actions', () => {
  it('offers RESUME when the learner is back from an interruption', () => {
    const decision = decide({
      engineState: engineWith({ state: 'INTERRUPTED', awaitingResume: true }),
    });
    expect(decision).toMatchObject({ action: 'RESUME', confidence: 1 });
  });

  it('offers BREAK when overloaded', () => {
    const decision = decide({ engineState: engineWith({ state: 'OVERLOADED' }) });
    expect(decision.action).toBe('BREAK');
    expect(decision.estimatedMinutes).toBe(5);
  });

  it('offers HINT when confused after a single failure', () => {
    const decision = decide({
      engineState: engineWith({ state: 'CONFUSED', consecutiveIncorrect: 1 }),
    });
    expect(decision.action).toBe('HINT');
  });

  it('escalates to EXAMPLE after repeated failures', () => {
    const decision = decide({
      engineState: engineWith({ state: 'CONFUSED', consecutiveIncorrect: 2 }),
    });
    expect(decision.action).toBe('EXAMPLE');
  });

  it('offers MICRO_START when the learner cannot begin', () => {
    const decision = decide({ engineState: engineWith({ state: 'INITIATION_FRICTION' }) });
    expect(decision.action).toBe('MICRO_START');
  });

  it('asks a self-explanation question after one wrong answer', () => {
    const decision = decide({
      engineState: engineWith({ state: 'FOCUSED', consecutiveIncorrect: 1, currentTaskId: 't1' }),
      currentTask: taskWith(),
      now: at(60_000),
    });
    expect(decision.action).toBe('QUESTION');
  });

  it('suggests SIMPLIFY when a task runs far past its estimate', () => {
    const decision = decide({
      engineState: engineWith({ state: 'FOCUSED', currentTaskId: 't1', taskStartedAt: T0 }),
      currentTask: taskWith({ estimatedMinutes: 5 }),
      now: at(15 * 60_000),
    });
    expect(decision.action).toBe('SIMPLIFY');
    expect(decision.reason.key).toBe('reason.simplify');
  });

  it('does not SIMPLIFY inside the estimate', () => {
    const decision = decide({
      engineState: engineWith({ state: 'FOCUSED', currentTaskId: 't1', taskStartedAt: T0 }),
      currentTask: taskWith({ estimatedMinutes: 5 }),
      now: at(6 * 60_000),
    });
    expect(decision.action).toBe('NO_ACTION');
  });
});

describe('intervention policy — anti-nagging', () => {
  it('stays quiet inside the cooldown window', () => {
    const decision = decide({
      engineState: engineWith({ state: 'CONFUSED' }),
      shownInterventions: [interventionWith(at(10_000))],
      now: at(30_000),
    });
    expect(decision.action).toBe('NO_ACTION');
    expect(decision.reason.key).toBe('reason.cooldown');
  });

  it('acts again once the cooldown has passed', () => {
    const decision = decide({
      engineState: engineWith({ state: 'CONFUSED' }),
      shownInterventions: [interventionWith(at(10_000))],
      now: at(200_000),
    });
    expect(decision.action).toBe('HINT');
  });

  it('still offers RESUME inside the cooldown — it is the one that matters', () => {
    const decision = decide({
      engineState: engineWith({ state: 'INTERRUPTED', awaitingResume: true }),
      shownInterventions: [interventionWith(at(10_000))],
      now: at(20_000),
    });
    expect(decision.action).toBe('RESUME');
  });

  it('stops entirely once the session budget is spent', () => {
    const shownInterventions: Intervention[] = Array.from({ length: 12 }, (_, index) =>
      interventionWith(at(index * 200_000)),
    );
    const decision = decide({
      engineState: engineWith({ state: 'CONFUSED' }),
      shownInterventions,
      now: at(12 * 200_000),
    });
    expect(decision.action).toBe('NO_ACTION');
    expect(decision.reason.key).toBe('reason.budget');
  });

  it('backs off after a dismissed resume', () => {
    const decision = decide({
      engineState: engineWith({ state: 'CONFUSED' }),
      recentEvents: [eventWith('RESUME_DISMISSED', at(10_000), { checkpointId: 'cp1' })],
      now: at(30_000),
    });
    expect(decision.action).toBe('NO_ACTION');
    expect(decision.reason.key).toBe('reason.resume.dismissed');
  });

  it('re-offers resume even if an earlier card was dismissed', () => {
    const decision = decide({
      engineState: engineWith({ state: 'INTERRUPTED', awaitingResume: true }),
      recentEvents: [eventWith('RESUME_DISMISSED', at(10_000), { checkpointId: 'cp1' })],
      now: at(30_000),
    });
    expect(decision.action).toBe('RESUME');
  });

  it('forgets the dismissal once the cooldown elapses', () => {
    const decision = decide({
      engineState: engineWith({ state: 'CONFUSED' }),
      recentEvents: [eventWith('RESUME_DISMISSED', at(10_000), { checkpointId: 'cp1' })],
      now: at(200_000),
    });
    expect(decision.action).toBe('HINT');
  });
});

describe('intervention policy — determinism and configuration', () => {
  it('is deterministic for the same input', () => {
    const input: DecideInterventionInput = {
      engineState: engineWith({ state: 'CONFUSED', consecutiveIncorrect: 2 }),
      recentEvents: [],
      shownInterventions: [],
      currentTask: taskWith(),
      now: at(1_000),
    };
    expect(decideIntervention(input)).toEqual(decideIntervention(input));
  });

  it('honours custom thresholds', () => {
    const input: DecideInterventionInput = {
      engineState: engineWith({ state: 'FOCUSED', currentTaskId: 't1', taskStartedAt: T0 }),
      recentEvents: [],
      shownInterventions: [],
      currentTask: taskWith({ estimatedMinutes: 5 }),
      now: at(8 * 60_000),
    };
    expect(decideIntervention(input).action).toBe('NO_ACTION');
    expect(decideIntervention(input, { simplifyAfterRatio: 1 }).action).toBe('SIMPLIFY');
  });

  it('rejects invalid configuration', () => {
    expect(() => resolvePolicyConfig({ cooldownMs: -1 })).toThrow(RangeError);
    expect(() => resolvePolicyConfig({ simplifyAfterRatio: Number.NaN })).toThrow(RangeError);
  });
});

describe('createIntervention', () => {
  it('turns a decision into a persisted record', () => {
    const record = createIntervention(
      { id: 'i1', sessionId: 's1', at: T0 },
      {
        action: 'HINT',
        state: 'CONFUSED',
        reason: { key: 'reason.confused.hint', params: {} },
        confidence: 0.7,
        estimatedMinutes: 2,
      },
    );
    expect(record).toEqual({
      id: 'i1',
      sessionId: 's1',
      at: T0,
      state: 'CONFUSED',
      action: 'HINT',
      reason: { key: 'reason.confused.hint', params: {} },
      shownAt: T0,
    });
  });
});
