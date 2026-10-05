import { describe, expect, it } from 'vitest';
import { DEFAULT_RETRY_POLICY } from '@focusloop/llm-provider';
import scenariosJson from './scenarios/ag9/runtime-failures.json';
import { allScenariosPassed, parseScenario, runScenarios } from './index';
import { buildAg9Outputs, runAg9Scenario } from './ag9';

const scenarios = scenariosJson.map(parseScenario);

describe('AG9 deterministic runtime-failure scenarios', () => {
  it('runs every provider-failure case through the production runtime, twice, identically', async () => {
    const first = runScenarios(scenarios, await buildAg9Outputs(scenarios));
    const second = runScenarios(scenarios, await buildAg9Outputs(scenarios));

    expect(first).toEqual(second);
    expect(allScenariosPassed(first)).toBe(true);
    expect(first).toHaveLength(10);
    // Named rather than counted, so a scenario that stops running is a failure and not a smaller pass.
    expect(first.map((result) => result.scenarioId)).toEqual([
      'ag9-provider-unavailable',
      'ag9-provider-timeout',
      'ag9-provider-rate-limited',
      'ag9-malformed-output-schema-retry',
      'ag9-authentication-is-terminal',
      'ag9-bad-response-is-terminal',
      'ag9-fallback-exhaustion',
      'ag9-attempt-limit-one',
      'ag9-cancellation',
      'ag9-expiration',
    ]);
    const failed = first.flatMap((result) =>
      result.assertions
        .filter((assertion) => !assertion.passed)
        .map((assertion) => `${result.scenarioId}: ${assertion.message}`),
    );
    expect(failed).toEqual([]);
  });

  it('pins the transport pause to the published policy rather than to a copied number', async () => {
    const outputs = await buildAg9Outputs([{ id: 'transient', input: { failure: 'timeout' } }]);
    expect(outputs['transient']).toMatchObject({ pauses: [DEFAULT_RETRY_POLICY.baseBackoffMs] });
  });

  it('refuses an unknown failure instead of evaluating it as a pass', async () => {
    await expect(runAg9Scenario({ failure: 'invented' })).rejects.toThrow(
      'AG9 failure must be one of',
    );
    await expect(runAg9Scenario({ failure: 'offline', fallback: 'invented' })).rejects.toThrow(
      'AG9 fallback must be valid or prose',
    );
    await expect(runAg9Scenario({ failure: 'offline', timing: 'invented' })).rejects.toThrow(
      'AG9 timing must be none, cancel-during-primary or expired',
    );
    await expect(
      runAg9Scenario({ failure: 'offline', maxAttemptsPerProvider: 1.5 }),
    ).rejects.toThrow('AG9 maxAttemptsPerProvider must be an integer');
  });
});
