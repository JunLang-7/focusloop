import { describe, expect, it } from 'vitest';
import scenariosJson from './scenarios/ag2/rescue.json';
import { allScenariosPassed, parseScenario, runScenarios, type JsonValue } from './index';
import { runAg2Adapter } from './ag2';

const scenarios = scenariosJson.map(parseScenario);

describe('AG2 deterministic rescue scenarios', () => {
  it('runs all 18 reason, lifecycle and adversarial cases deterministically', () => {
    const first = runScenarios(scenarios, (input: JsonValue) => runAg2Adapter(input));
    const second = runScenarios(scenarios, (input: JsonValue) => runAg2Adapter(input));
    expect(first).toEqual(second);
    expect(allScenariosPassed(first)).toBe(true);
    expect(first).toHaveLength(18);
  });
});
