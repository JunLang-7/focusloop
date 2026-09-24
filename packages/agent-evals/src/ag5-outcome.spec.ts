import { describe, expect, it } from 'vitest';
import helpAgainScenario from './scenarios/ag5/accept-then-help-again.json';
import { allScenariosPassed, parseScenario, runScenarios, type JsonValue } from './index';
import { runAg5OutcomeAdapter } from './ag5-outcome';

const scenarios = [helpAgainScenario].map(parseScenario);

describe('AG5 resume outcome scenarios', () => {
  it('counts accept-then-help-again as reengaged without progressed', () => {
    const first = runScenarios(scenarios, executeAg5OutcomeFixture);
    const second = runScenarios(scenarios, executeAg5OutcomeFixture);

    expect(first).toEqual(second);
    expect(allScenariosPassed(first)).toBe(true);
    expect(first[0]?.scenarioId).toBe('ag5-accept-then-help-again');
  });

  it('is the case the old single success rate called success', () => {
    const output = runAg5OutcomeAdapter(helpAgainScenario.input as JsonValue);
    expect(output).toMatchObject({
      reengaged: true,
      progressed: false,
      stalledAgain: true,
      status: 'observed',
    });
    expect(output).not.toHaveProperty('succeeded');
    expect(output).not.toHaveProperty('rate');
  });
});

function executeAg5OutcomeFixture(input: JsonValue): JsonValue {
  return runAg5OutcomeAdapter(input);
}
