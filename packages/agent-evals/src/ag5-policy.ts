import { classifyResumeGap } from '@focusloop/continuity';
import type { ResumePolicyOverrides } from '@focusloop/shared-types';
import type { JsonObject, JsonValue } from './scenario';

export interface Ag5PolicyOutput {
  readonly variant: 'short' | 'medium' | 'long' | 'invalid-config';
  readonly gapMs: number | null;
  readonly refresherRequired: boolean;
}

function isRecord(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Minimal JSON boundary for deterministic tier fixtures. */
export function runAg5PolicyAdapter(input: JsonValue): JsonValue {
  if (!isRecord(input)) throw new Error('AG5 policy fixture input must be an object');
  const rawGap = input['gapMs'];
  if (rawGap !== null && (typeof rawGap !== 'number' || !Number.isFinite(rawGap))) {
    throw new Error('AG5 policy fixture gapMs must be a finite number or null');
  }
  const configValue = input['config'];
  if (configValue !== undefined && !isRecord(configValue)) {
    throw new Error('AG5 policy fixture config must be an object');
  }
  const config = configValue as ResumePolicyOverrides | undefined;
  const gapMs = rawGap as number | null;
  let variant: Ag5PolicyOutput['variant'];
  try {
    variant = classifyResumeGap(gapMs, config);
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    return { variant: 'invalid-config', gapMs, refresherRequired: false } as unknown as JsonValue;
  }
  const output: Ag5PolicyOutput = {
    variant,
    gapMs,
    refresherRequired: variant === 'long',
  };
  return output as unknown as JsonValue;
}
