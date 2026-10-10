import { describe, expect, it } from 'vitest';
import directSafeRead from './scenarios/ag8/safe-read-crosses-the-direct-path.json';
import reversibleRefused from './scenarios/ag8/reversible-write-crosses-into-permission.json';
import structuralRefused from './scenarios/ag8/structural-write-crosses-into-permission.json';
import unknownTool from './scenarios/ag8/unknown-tool-refused.json';
import malformedArgs from './scenarios/ag8/malformed-args-refused.json';
import wrongSession from './scenarios/ag8/wrong-session-refused.json';
import unforgedConfirm from './scenarios/ag8/execute-without-confirm-refused.json';
import forgedKey from './scenarios/ag8/forged-key-refused.json';
import replayOnce from './scenarios/ag8/replay-executes-once.json';
import { allScenariosPassed, parseScenario, runScenarios } from './index';
import { runAg8ToolSafetyAdapter } from './ag8-tool-safety';

const scenarios = [
  directSafeRead,
  reversibleRefused,
  structuralRefused,
  unknownTool,
  malformedArgs,
  wrongSession,
  unforgedConfirm,
  forgedKey,
  replayOnce,
].map(parseScenario);

describe('AG8 tool-call safety scenarios (AG10.6)', () => {
  it('passes all nine scenarios, deterministically, over the real contract', () => {
    const first = runScenarios(scenarios, runAg8ToolSafetyAdapter);
    const second = runScenarios(scenarios, runAg8ToolSafetyAdapter);

    expect(first).toEqual(second);
    expect(allScenariosPassed(first)).toBe(true);
    expect(first).toHaveLength(9);
  });

  it('is not vacuous: an assertion the contract would violate fails the suite', () => {
    // Flip what the contract actually does — the reversible cell's real answer is `permission` —
    // and the scenario must go red. A suite that passes a flipped expectation measures nothing.
    const mutated = scenarios.map((scenario) => {
      if (scenario.id !== 'ag8-reversible-write-crosses-into-permission') return scenario;
      return {
        ...scenario,
        expected: scenario.expected.map((assertion) =>
          assertion.type === 'equals' && assertion.path === 'reason'
            ? { ...assertion, value: 'ok-but-whatever' }
            : assertion,
        ),
      };
    });
    expect(allScenariosPassed(runScenarios(mutated, runAg8ToolSafetyAdapter))).toBe(false);
  });

  it('refuses to evaluate a scenario whose input the adapter does not know', () => {
    expect(() => runAg8ToolSafetyAdapter({ case: 'no-such-case' })).toThrow(
      /no-such-case|unknown/i,
    );
  });
});
