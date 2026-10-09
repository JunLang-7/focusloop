import { describe, expect, it } from 'vitest';
import reasonAnswers from './scenarios/ag2/intervention-reason-answers-request.json';
import cooldownQuiet from './scenarios/ag2/intervention-cooldown-stays-quiet.json';
import budgetSilences from './scenarios/ag2/intervention-budget-trumps-request.json';
import { allScenariosPassed, parseScenario, runScenarios } from './index';
import { runAg2InterventionAdapter } from './ag2-intervention';

const scenarios = [reasonAnswers, cooldownQuiet, budgetSilences].map(parseScenario);

describe('AG2 intervention-appropriateness scenarios (AG10.5)', () => {
  it('passes all three speak-or-stay-quiet scenarios, deterministically', () => {
    const first = runScenarios(scenarios, runAg2InterventionAdapter);
    const second = runScenarios(scenarios, runAg2InterventionAdapter);

    expect(first).toEqual(second);
    expect(allScenariosPassed(first)).toBe(true);
    expect(first).toHaveLength(3);
  });
});
