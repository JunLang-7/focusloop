import { describe, expect, it } from 'vitest';
import hintSummary from './scenarios/ag2/grounding-hint-quotes-summary.json';
import exampleKeyPoint from './scenarios/ag2/grounding-example-falls-back.json';
import repeatingTask from './scenarios/ag2/grounding-summary-repeats-task.json';
import generatedLine from './scenarios/ag2/grounding-generated-line-shown.json';
import generatedEmpty from './scenarios/ag2/grounding-generated-empty-falls-back.json';
import generatedOversized from './scenarios/ag2/grounding-generated-oversized-falls-back.json';
import { allScenariosPassed, parseScenario, runScenarios } from './index';
import { runAg2GroundingAdapter } from './ag2-grounding';

const scenarios = [
  hintSummary,
  exampleKeyPoint,
  repeatingTask,
  generatedLine,
  generatedEmpty,
  generatedOversized,
].map(parseScenario);

describe('AG2 grounding scenarios (AG10.4)', () => {
  it('passes the three grounded-quote and three generated-line scenarios, deterministically', () => {
    const first = runScenarios(scenarios, runAg2GroundingAdapter);
    const second = runScenarios(scenarios, runAg2GroundingAdapter);

    expect(first).toEqual(second);
    expect(allScenariosPassed(first)).toBe(true);
    expect(first).toHaveLength(6);
  });
});
