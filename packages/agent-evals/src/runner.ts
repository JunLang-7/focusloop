import {
  type EvalAssertion,
  type EvalScenario,
  isJsonValue,
  parsePath,
  parseScenario,
  ScenarioValidationError,
  type JsonValue,
} from './scenario';

export interface AssertionResult {
  readonly assertion: EvalAssertion;
  readonly passed: boolean;
  readonly message: string;
}

export interface ScenarioResult {
  readonly scenarioId: string;
  readonly capability: EvalScenario['capability'];
  readonly kind: EvalScenario['kind'];
  readonly output: JsonValue;
  readonly passed: boolean;
  readonly assertions: readonly AssertionResult[];
}

export type ScenarioExecutor = (input: JsonValue) => JsonValue;

function isObject(value: JsonValue): value is { readonly [key: string]: JsonValue } {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function deepEqual(left: JsonValue, right: JsonValue): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return (
      left.length === right.length &&
      left.every((item, index) => {
        const other = right[index];
        return other !== undefined && deepEqual(item, other);
      })
    );
  }
  if (isObject(left) && isObject(right)) {
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    return (
      leftKeys.length === rightKeys.length &&
      leftKeys.every((key, index) => {
        const otherKey = rightKeys[index];
        const leftValue = left[key];
        const rightValue = right[key];
        return (
          otherKey !== undefined &&
          leftValue !== undefined &&
          rightValue !== undefined &&
          key === otherKey &&
          deepEqual(leftValue, rightValue)
        );
      })
    );
  }
  return false;
}

function containsValue(container: JsonValue, forbidden: JsonValue): boolean {
  if (deepEqual(container, forbidden)) return true;
  if (typeof forbidden === 'string' && JSON.stringify(container).includes(forbidden)) return true;
  if (Array.isArray(container)) return container.some((item) => containsValue(item, forbidden));
  if (isObject(container)) {
    return Object.values(container).some((item) => containsValue(item, forbidden));
  }
  return false;
}

function readPath(
  root: JsonValue,
  path: string,
): { readonly exists: boolean; readonly value?: JsonValue } {
  let current: JsonValue = root;
  for (const segment of parsePath(path)) {
    if (typeof segment === 'number') {
      if (!Array.isArray(current) || segment >= current.length) return { exists: false };
      const next = current[segment];
      if (next === undefined) return { exists: false };
      current = next;
    } else {
      if (!isObject(current) || !Object.prototype.hasOwnProperty.call(current, segment)) {
        return { exists: false };
      }
      const next = current[segment];
      if (next === undefined) return { exists: false };
      current = next;
    }
  }
  return { exists: true, value: current };
}

function evaluateAssertion(assertion: EvalAssertion, output: JsonValue): AssertionResult {
  const located =
    assertion.type === 'forbidden-value' && assertion.path === undefined
      ? { exists: true as const, value: output }
      : readPath(output, assertion.path ?? 'output');
  let passed: boolean;
  let message: string;

  switch (assertion.type) {
    case 'equals':
      passed = located.exists && deepEqual(located.value ?? null, assertion.value);
      message = passed
        ? `equals passed at ${assertion.path}`
        : `expected ${assertion.path} to equal ${JSON.stringify(assertion.value)}`;
      break;
    case 'allowed-keys':
      if (!located.exists || located.value === undefined || !isObject(located.value)) {
        passed = false;
      } else {
        passed = Object.keys(located.value).every((key) => assertion.keys.includes(key));
      }
      message = passed
        ? `allowed-keys passed at ${assertion.path}`
        : `expected ${assertion.path} to contain only allowed keys`;
      break;
    case 'absent':
      passed = !located.exists;
      message = passed
        ? `absent passed at ${assertion.path}`
        : `expected ${assertion.path} to be absent`;
      break;
    case 'max-items':
      passed =
        located.exists && Array.isArray(located.value) && located.value.length <= assertion.max;
      message = passed
        ? `max-items passed at ${assertion.path}`
        : `expected ${assertion.path} to be an array with at most ${assertion.max} items`;
      break;
    case 'max-length':
      passed =
        located.exists &&
        typeof located.value === 'string' &&
        located.value.length <= assertion.max;
      message = passed
        ? `max-length passed at ${assertion.path}`
        : `expected ${assertion.path} to be a string with at most ${assertion.max} characters`;
      break;
    case 'forbidden-value':
      passed =
        !located.exists ||
        (located.value !== undefined && !containsValue(located.value, assertion.value));
      message = passed
        ? `forbidden-value passed${assertion.path === undefined ? '' : ` at ${assertion.path}`}`
        : `forbidden value found${assertion.path === undefined ? ' in output' : ` at ${assertion.path}`}`;
      break;
    default:
      throw new ScenarioValidationError('Unknown assertion type');
  }

  return { assertion, passed, message };
}

function evaluateAssertions(
  assertions: readonly EvalAssertion[],
  output: JsonValue,
): readonly AssertionResult[] {
  return assertions.map((assertion) => evaluateAssertion(assertion, output));
}

/**
 * Evaluate one validated scenario against a JSON output or a pure synchronous executor.
 *
 * The executor form exists for future capability adapters, but it intentionally does not accept
 * promises: this first harness must remain deterministic and free of hidden clocks or I/O.
 */
export function runScenario(scenario: EvalScenario, output: JsonValue): ScenarioResult;
export function runScenario(scenario: EvalScenario, execute: ScenarioExecutor): ScenarioResult;
export function runScenario(
  scenario: EvalScenario,
  outputOrExecute: JsonValue | ScenarioExecutor,
): ScenarioResult {
  const validated = parseScenario(scenario);
  const output =
    typeof outputOrExecute === 'function'
      ? (outputOrExecute as ScenarioExecutor)(validated.input)
      : outputOrExecute;
  if (!isJsonValue(output)) {
    throw new ScenarioValidationError(
      'Scenario output must be a JSON value; asynchronous executors are not supported',
    );
  }
  const assertions = [
    ...evaluateAssertions(validated.expected, output),
    ...evaluateAssertions(validated.forbidden, output),
  ];
  return {
    scenarioId: validated.id,
    capability: validated.capability,
    kind: validated.kind,
    output,
    passed: assertions.every((result) => result.passed),
    assertions,
  };
}

/** Run scenarios in input order, preserving deterministic result order. */
export function runScenarios(
  scenarios: readonly EvalScenario[],
  execute: ScenarioExecutor | Readonly<Record<string, JsonValue>>,
): readonly ScenarioResult[] {
  const validated = scenarios.map((scenario) => parseScenario(scenario));
  const ids = new Set<string>();
  for (const scenario of validated) {
    if (ids.has(scenario.id)) {
      throw new ScenarioValidationError(`Duplicate scenario id: ${scenario.id}`);
    }
    ids.add(scenario.id);
  }

  return validated.map((scenario) => {
    if (typeof execute === 'function') return runScenario(scenario, execute);
    const output = execute[scenario.id];
    if (output === undefined) {
      throw new ScenarioValidationError(
        `No deterministic output supplied for scenario: ${scenario.id}`,
      );
    }
    return runScenario(scenario, output);
  });
}

export function allScenariosPassed(results: readonly ScenarioResult[]): boolean {
  return results.every((result) => result.passed);
}
