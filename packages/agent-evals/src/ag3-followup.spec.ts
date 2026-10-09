import { describe, expect, it } from 'vitest';
import carriesConversation from './scenarios/ag3/followup-carries-the-conversation.json';
import clippedQuestion from './scenarios/ag3/followup-question-clipped-to-its-bound.json';
import labelOnly from './scenarios/ag3/followup-label-only-question-refused.json';
import { allScenariosPassed, parseScenario, runScenarios } from './index';
import { runAg3FollowupAdapter } from './ag3-followup';

const scenarios = [carriesConversation, clippedQuestion, labelOnly].map(parseScenario);

describe('AG3 follow-up scenarios (AG10.1)', () => {
  it('passes all three conversation scenarios, deterministically', () => {
    const first = runScenarios(scenarios, runAg3FollowupAdapter);
    const second = runScenarios(scenarios, runAg3FollowupAdapter);

    expect(first).toEqual(second);
    expect(allScenariosPassed(first)).toBe(true);
    expect(first).toHaveLength(3);
  });
});
