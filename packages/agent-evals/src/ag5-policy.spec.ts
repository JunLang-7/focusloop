import { describe, expect, it } from 'vitest';
import customConfig from './scenarios/ag5/custom-policy-thresholds.json';
import invalidConfig from './scenarios/ag5/config-invalid-order.json';
import longBoundary from './scenarios/ag5/long-twenty-four-hour-boundary.json';
import mediumBoundary from './scenarios/ag5/medium-fifteen-minute-boundary.json';
import mediumBeforeLong from './scenarios/ag5/medium-before-long-boundary.json';
import shortUnderThreshold from './scenarios/ag5/short-under-threshold.json';
import shortOneMinute from './scenarios/ag5/short-one-minute.json';
import unknownGap from './scenarios/ag5/unknown-gap-conservative.json';
import { allScenariosPassed, parseScenario, runScenarios, type JsonValue } from './index';
import { runAg5PolicyAdapter } from './ag5-policy';

const scenarios = [
  shortOneMinute,
  shortUnderThreshold,
  mediumBoundary,
  mediumBeforeLong,
  longBoundary,
  unknownGap,
  customConfig,
  invalidConfig,
].map(parseScenario);

describe('AG5 resume tier scenarios', () => {
  it('passes all eight deterministic tier and boundary scenarios', () => {
    const first = runScenarios(scenarios, runAg5PolicyAdapter);
    const second = runScenarios(scenarios, runAg5PolicyAdapter);

    expect(first).toEqual(second);
    expect(allScenariosPassed(first)).toBe(true);
    expect(first).toHaveLength(8);
  });

  it('rejects malformed gaps at the adapter boundary', () => {
    expect(() => runAg5PolicyAdapter({ gapMs: 'unknown' } as unknown as JsonValue)).toThrow(
      'gapMs must be a finite number or null',
    );
  });
});
