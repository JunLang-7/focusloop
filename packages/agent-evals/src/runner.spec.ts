import { describe, expect, it } from 'vitest';
import {
  allScenariosPassed,
  parsePath,
  parseScenario,
  runScenario,
  runScenarios,
  ScenarioValidationError,
  type EvalScenario,
} from './index';

const scenario: EvalScenario = {
  schemaVersion: 1,
  id: 'ag1-happy-shape',
  capability: 'AG1',
  kind: 'happy',
  input: { question: 'start' },
  expected: [
    { type: 'equals', path: 'response.mode', value: 'focus' },
    { type: 'allowed-keys', path: 'response', keys: ['mode', 'steps'] },
    { type: 'max-items', path: 'response.steps', max: 2 },
    { type: 'max-length', path: 'response.steps[0].label', max: 20 },
  ],
  forbidden: [
    { type: 'absent', path: 'response.debug' },
    { type: 'forbidden-value', value: 'ignore' },
  ],
};

const output = {
  response: {
    mode: 'focus',
    steps: [{ label: 'open the lesson' }],
  },
};

describe('deterministic scenario runner', () => {
  it('evaluates the supported AG1 assertions', () => {
    const result = runScenario(scenario, output);
    expect(result.passed).toBe(true);
    expect(result.assertions).toHaveLength(6);
    expect(allScenariosPassed([result])).toBe(true);
  });

  it('supports a pure synchronous executor and preserves scenario order', () => {
    const second = { ...scenario, id: 'ag1-edge-shape', kind: 'edge' as const };
    const results = runScenarios([scenario, second], (input) => {
      expect(input).toEqual({ question: 'start' });
      return output;
    });
    expect(results.map((result) => result.scenarioId)).toEqual([
      'ag1-happy-shape',
      'ag1-edge-shape',
    ]);
  });

  it('rejects duplicate scenario ids', () => {
    expect(() => runScenarios([scenario, scenario], () => output)).toThrow(/Duplicate scenario id/);
  });

  it('finds a forbidden string anywhere in the serialized output', () => {
    const result = runScenario(scenario, {
      response: { mode: 'focus', steps: [{ label: 'contains ignore inside' }] },
    });
    expect(result.passed).toBe(false);
    expect(result.assertions.at(-1)?.message).toContain('forbidden value found in output');
  });

  it('reports failed expected and forbidden assertions without changing the output', () => {
    const result = runScenario(scenario, {
      response: {
        mode: 'ignore',
        steps: [{ label: 'this label is intentionally far too long' }],
        debug: true,
      },
    });
    expect(result.passed).toBe(false);
    expect(result.assertions.filter((assertion) => !assertion.passed)).toHaveLength(5);
  });

  it('supports dotted keys and numeric array indexes only', () => {
    expect(parsePath('response.steps[0].label')).toEqual(['response', 'steps', 0, 'label']);
    expect(() => parsePath('response[*].label')).toThrow(ScenarioValidationError);
    expect(() => parsePath('response[0].label()')).toThrow(ScenarioValidationError);
    expect(() => parsePath('response..label')).toThrow(ScenarioValidationError);
  });

  it('rejects unknown schema versions, fields, capabilities and assertions', () => {
    expect(() => parseScenario({ ...scenario, schemaVersion: 2 })).toThrow(ScenarioValidationError);
    expect(() => parseScenario({ ...scenario, capability: 'AG4' })).toThrow(
      ScenarioValidationError,
    );
    expect(() => parseScenario({ ...scenario, unexpected: true })).toThrow(ScenarioValidationError);
    expect(() =>
      parseScenario({
        ...scenario,
        expected: [{ type: 'not-supported', path: 'response' }],
      }),
    ).toThrow(ScenarioValidationError);
  });

  it('accepts the AG5 capability while preserving the version-one schema', () => {
    const ag5 = parseScenario({ ...scenario, id: 'ag5-compatible', capability: 'AG5' });
    expect(ag5.capability).toBe('AG5');
    expect(runScenario(ag5, output).passed).toBe(true);
  });

  it('accepts the AG2 capability while preserving the version-one schema', () => {
    expect(parseScenario({ ...scenario, id: 'ag2-compatible', capability: 'AG2' }).capability).toBe(
      'AG2',
    );
  });

  it('rejects asynchronous executors to keep runs deterministic', () => {
    expect(() =>
      runScenario(scenario, (() => Promise.resolve(output)) as unknown as (
        input: typeof scenario.input,
      ) => typeof output),
    ).toThrow();
  });
});
