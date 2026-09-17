import { describe, expect, it } from 'vitest';
import { ACTION_PRIORITY, decideIntervention } from './policy';
import { at, engineWith, interventionWith, T0, taskWith } from './fixtures';

describe('intervention policy — cooldown escalation', () => {
  it('allows a more urgent action through the cooldown', () => {
    const decision = decideIntervention({
      engineState: engineWith({ state: 'OVERLOADED' }),
      recentEvents: [],
      shownInterventions: [interventionWith(at(1_000), 'HINT')],
      currentTask: taskWith(),
      now: at(20_000),
    });
    expect(decision.action).toBe('BREAK');
  });

  it('suppresses an equally urgent (or smaller) action', () => {
    const decision = decideIntervention({
      engineState: engineWith({ state: 'CONFUSED' }),
      recentEvents: [],
      shownInterventions: [interventionWith(at(1_000), 'HINT')],
      currentTask: taskWith(),
      now: at(20_000),
    });
    expect(decision.action).toBe('NO_ACTION');
  });

  it('ranks the actions in a stable, documented order', () => {
    expect(ACTION_PRIORITY.RESUME).toBeGreaterThan(ACTION_PRIORITY.BREAK);
    expect(ACTION_PRIORITY.BREAK).toBeGreaterThan(ACTION_PRIORITY.EXAMPLE);
    expect(ACTION_PRIORITY.EXAMPLE).toBeGreaterThan(ACTION_PRIORITY.HINT);
    expect(ACTION_PRIORITY.HINT).toBeGreaterThan(ACTION_PRIORITY.QUESTION);
    expect(ACTION_PRIORITY.QUESTION).toBeGreaterThan(ACTION_PRIORITY.NO_ACTION);
  });

  it('does not suppress the first action of a session', () => {
    const decision = decideIntervention({
      engineState: engineWith({ state: 'CONFUSED' }),
      recentEvents: [],
      shownInterventions: [],
      currentTask: taskWith(),
      now: T0,
    });
    expect(decision.action).toBe('HINT');
  });
});
