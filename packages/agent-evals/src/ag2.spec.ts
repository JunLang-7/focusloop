import { describe, expect, it } from 'vitest';
import scenariosJson from './scenarios/ag2/rescue.json';
import groundingJson from './scenarios/ag2/hint-grounding.json';
import { allScenariosPassed, parseScenario, runScenarios, type JsonValue } from './index';
import { runAg2Adapter } from './ag2';

const scenarios = scenariosJson.map(parseScenario);
const groundingScenarios = groundingJson.map(parseScenario);

describe('AG2 deterministic rescue scenarios', () => {
  it('runs all 18 reason, lifecycle and adversarial cases deterministically', () => {
    const first = runScenarios(scenarios, (input: JsonValue) => runAg2Adapter(input));
    const second = runScenarios(scenarios, (input: JsonValue) => runAg2Adapter(input));
    expect(first).toEqual(second);
    expect(allScenariosPassed(first)).toBe(true);
    expect(first).toHaveLength(18);
  });
});

describe('AG2 hint and example grounding scenarios', () => {
  /*
   * What a HINT or an EXAMPLE actually quotes (AG2.5/2.6). The rescue scenarios above would stay
   * green if the cards quoted nothing at all, because a card with no grounding is a valid card — so
   * the passage itself is pinned here, including the cases where there deliberately is not one.
   */
  it('runs every grounding case deterministically', () => {
    const first = runScenarios(groundingScenarios, (input: JsonValue) => runAg2Adapter(input));
    const second = runScenarios(groundingScenarios, (input: JsonValue) => runAg2Adapter(input));
    expect(first).toEqual(second);
    expect(allScenariosPassed(first)).toBe(true);
    expect(first).toHaveLength(8);
  });
});
