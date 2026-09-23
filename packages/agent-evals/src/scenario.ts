/** JSON values accepted by the deterministic evaluation harness. */
export type JsonPrimitive = string | number | boolean | null;

export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];

export interface JsonObject {
  readonly [key: string]: JsonValue;
}

export const SCENARIO_SCHEMA_VERSION = 1 as const;
export const AG1_CAPABILITY = 'AG1' as const;
export const AG2_CAPABILITY = 'AG2' as const;
export const AG5_CAPABILITY = 'AG5' as const;

/** Capabilities intentionally supported by the deterministic scenario format. */
export type EvalCapability = typeof AG1_CAPABILITY | typeof AG2_CAPABILITY | typeof AG5_CAPABILITY;

export type ScenarioKind = 'happy' | 'edge' | 'adversarial';

export type AssertionType =
  'equals' | 'allowed-keys' | 'absent' | 'max-items' | 'max-length' | 'forbidden-value';

type AssertionName<T extends AssertionType> = { readonly type: T };

export type EqualsAssertion = AssertionName<'equals'> & {
  readonly path: string;
  readonly value: JsonValue;
};

export type AllowedKeysAssertion = AssertionName<'allowed-keys'> & {
  readonly path: string;
  readonly keys: readonly string[];
};

export type AbsentAssertion = AssertionName<'absent'> & { readonly path: string };

export type MaxItemsAssertion = AssertionName<'max-items'> & {
  readonly path: string;
  readonly max: number;
};

export type MaxLengthAssertion = AssertionName<'max-length'> & {
  readonly path: string;
  readonly max: number;
};

export type ForbiddenValueAssertion = AssertionName<'forbidden-value'> & {
  /** When omitted, the complete output is searched recursively. */
  readonly path?: string;
  readonly value: JsonValue;
};

export type EvalAssertion =
  | EqualsAssertion
  | AllowedKeysAssertion
  | AbsentAssertion
  | MaxItemsAssertion
  | MaxLengthAssertion
  | ForbiddenValueAssertion;

export interface EvalScenario {
  readonly schemaVersion: typeof SCENARIO_SCHEMA_VERSION;
  readonly id: string;
  readonly capability: EvalCapability;
  readonly kind: ScenarioKind;
  readonly input: JsonValue;
  readonly expected: readonly EvalAssertion[];
  readonly forbidden: readonly EvalAssertion[];
  readonly description?: string;
}

/** A validation error means the scenario itself cannot be evaluated safely. */
export class ScenarioValidationError extends Error {
  public readonly code = 'SCENARIO_VALIDATION_ERROR' as const;

  public constructor(message: string) {
    super(message);
    this.name = 'ScenarioValidationError';
  }
}

export function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;

  return Object.values(value).every(isJsonValue);
}

const PATH_PATTERN =
  /^[A-Za-z_][A-Za-z0-9_-]*(?:\.[A-Za-z_][A-Za-z0-9_-]*|\[(?:0|[1-9][0-9]*)\])*$/;

/**
 * Validate and split the deliberately small path language used by assertions.
 *
 * Paths are dotted object keys with numeric array indexes, for example
 * `response.steps[0].title`. No expression, wildcard, quoted key or JSONPath
 * construct is accepted.
 */
export function parsePath(path: string): readonly (string | number)[] {
  if (!PATH_PATTERN.test(path)) {
    throw new ScenarioValidationError(`Invalid assertion path: ${JSON.stringify(path)}`);
  }

  const segments: (string | number)[] = [];
  const tokens = path.split('.');
  for (const token of tokens) {
    const keyMatch = /^([A-Za-z_][A-Za-z0-9_-]*)/.exec(token);
    if (keyMatch === null) {
      throw new ScenarioValidationError(`Invalid assertion path: ${JSON.stringify(path)}`);
    }
    const key = keyMatch[1];
    if (key === undefined) {
      throw new ScenarioValidationError(`Invalid assertion path: ${JSON.stringify(path)}`);
    }
    segments.push(key);
    const indexText = token.slice(key.length);
    if (indexText.length > 0) {
      for (const match of indexText.matchAll(/\[(0|[1-9][0-9]*)\]/g)) {
        const index = match[1];
        if (index === undefined) {
          throw new ScenarioValidationError(`Invalid assertion path: ${JSON.stringify(path)}`);
        }
        segments.push(Number(index));
      }
    }
  }
  return segments;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertionType(value: Record<string, unknown>): AssertionType {
  const candidate = value.type ?? value.assertion;
  if (
    candidate !== 'equals' &&
    candidate !== 'allowed-keys' &&
    candidate !== 'absent' &&
    candidate !== 'max-items' &&
    candidate !== 'max-length' &&
    candidate !== 'forbidden-value'
  ) {
    throw new ScenarioValidationError(`Unknown assertion type: ${JSON.stringify(candidate)}`);
  }
  if (value.type !== undefined && value.assertion !== undefined && value.type !== value.assertion) {
    throw new ScenarioValidationError('Assertion type and assertion name disagree');
  }
  return candidate;
}

function validateLimit(value: unknown, field: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new ScenarioValidationError(`${field} must be a non-negative integer`);
  }
}

function validateAssertion(value: unknown): EvalAssertion {
  if (!isRecord(value)) throw new ScenarioValidationError('Assertion must be an object');
  const type = assertionType(value);
  if (type !== 'forbidden-value' && typeof value.path !== 'string') {
    throw new ScenarioValidationError('Assertion path must be a string');
  }
  if (value.path !== undefined) {
    if (typeof value.path !== 'string') {
      throw new ScenarioValidationError('Assertion path must be a string');
    }
    parsePath(value.path);
  }

  switch (type) {
    case 'equals':
      if (!isJsonValue(value.value))
        throw new ScenarioValidationError(`${type} value must be JSON`);
      return { type, path: value.path as string, value: value.value };
    case 'forbidden-value':
      if (!isJsonValue(value.value))
        throw new ScenarioValidationError(`${type} value must be JSON`);
      return {
        type,
        ...(value.path === undefined ? {} : { path: value.path as string }),
        value: value.value,
      };
    case 'allowed-keys':
      if (
        !Array.isArray(value.keys) ||
        !value.keys.every((key): key is string => typeof key === 'string') ||
        new Set(value.keys).size !== value.keys.length
      ) {
        throw new ScenarioValidationError('allowed-keys keys must be unique strings');
      }
      return { type, path: value.path as string, keys: [...value.keys] };
    case 'absent':
      return { type, path: value.path as string };
    case 'max-items':
    case 'max-length':
      validateLimit(value.max, `${type}.max`);
      return { type, path: value.path as string, max: value.max };
  }
}

const SCENARIO_KEYS = new Set([
  'schemaVersion',
  'id',
  'capability',
  'kind',
  'input',
  'expected',
  'forbidden',
  'description',
]);

/** Parse and validate an unknown JSON scenario at the package boundary. */
export function parseScenario(value: unknown): EvalScenario {
  if (!isRecord(value)) throw new ScenarioValidationError('Scenario must be an object');
  for (const key of Object.keys(value)) {
    if (!SCENARIO_KEYS.has(key))
      throw new ScenarioValidationError(`Unknown scenario field: ${key}`);
  }
  if (value.schemaVersion !== SCENARIO_SCHEMA_VERSION) {
    throw new ScenarioValidationError(
      `Unsupported scenario schema version: ${String(value.schemaVersion)}`,
    );
  }
  if (typeof value.id !== 'string' || value.id.length === 0) {
    throw new ScenarioValidationError('Scenario id must be a non-empty string');
  }
  if (
    value.capability !== AG1_CAPABILITY &&
    value.capability !== AG2_CAPABILITY &&
    value.capability !== AG5_CAPABILITY
  ) {
    throw new ScenarioValidationError(`Unsupported capability: ${String(value.capability)}`);
  }
  if (value.kind !== 'happy' && value.kind !== 'edge' && value.kind !== 'adversarial') {
    throw new ScenarioValidationError(`Unknown scenario kind: ${String(value.kind)}`);
  }
  if (!isJsonValue(value.input)) throw new ScenarioValidationError('Scenario input must be JSON');
  if (!Array.isArray(value.expected) || !Array.isArray(value.forbidden)) {
    throw new ScenarioValidationError('Scenario expected and forbidden must be arrays');
  }
  if (value.description !== undefined && typeof value.description !== 'string') {
    throw new ScenarioValidationError('Scenario description must be a string');
  }

  return {
    schemaVersion: SCENARIO_SCHEMA_VERSION,
    id: value.id,
    capability: value.capability,
    kind: value.kind,
    input: value.input,
    expected: value.expected.map(validateAssertion),
    forbidden: value.forbidden.map(validateAssertion),
    ...(value.description === undefined ? {} : { description: value.description }),
  };
}
