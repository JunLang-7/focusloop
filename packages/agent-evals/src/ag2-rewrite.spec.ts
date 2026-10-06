import { describe, expect, it } from 'vitest';
import rewriteJson from './scenarios/ag2/rewrite.json';
import { allScenariosPassed, parseScenario, runScenarios, type JsonValue } from './index';
import { runAg2RewriteAdapter } from './ag2-rewrite';

const scenarios = rewriteJson.map(parseScenario);

describe('AG2 task rewrite scenarios', () => {
  /*
   * MICRO_START and SIMPLIFY change the task, so the fixture reads back the task the learner would be
   * shown rather than the card's wording. Deterministic twice over, as the other AG2 suites are.
   */
  it('runs every rewrite case deterministically', () => {
    const first = runScenarios(scenarios, (input: JsonValue) => runAg2RewriteAdapter(input));
    const second = runScenarios(scenarios, (input: JsonValue) => runAg2RewriteAdapter(input));
    expect(first).toEqual(second);
    expect(allScenariosPassed(first)).toBe(true);
    expect(first).toHaveLength(8);
  });
});
