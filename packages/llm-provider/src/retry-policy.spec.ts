import { describe, expect, it, vi } from 'vitest';
import type { ProviderFailureReason } from '@focusloop/shared-types';
import {
  backoffDelay,
  classifyFailure,
  createAttemptLedger,
  DEFAULT_RETRY_POLICY,
  RETRYABLE_FAILURE_REASONS,
  resolveRetryPolicy,
  TERMINAL_FAILURE_REASONS,
  type FailureClassification,
} from './retry-policy';

/**
 * Exhaustive by construction: the record must name every `ProviderFailureReason`, so a new reason
 * fails the type check here instead of silently escaping the partition below.
 */
const EXPECTED_CLASSIFICATION: Record<ProviderFailureReason, FailureClassification> = {
  offline: 'retryable',
  timeout: 'retryable',
  'rate-limited': 'retryable',
  unauthorized: 'terminal',
  'not-configured': 'terminal',
  'bad-response': 'terminal',
};

const ALL_REASONS = Object.keys(EXPECTED_CLASSIFICATION) as ProviderFailureReason[];

describe('the retry classification is a closed policy', () => {
  it('partitions every known failure reason exactly once', () => {
    expect([...RETRYABLE_FAILURE_REASONS, ...TERMINAL_FAILURE_REASONS].sort()).toEqual(
      [...ALL_REASONS].sort(),
    );
    expect(new Set(RETRYABLE_FAILURE_REASONS).size).toBe(RETRYABLE_FAILURE_REASONS.length);
    for (const reason of ALL_REASONS) {
      const expected = (RETRYABLE_FAILURE_REASONS as readonly ProviderFailureReason[]).includes(
        reason,
      )
        ? 'retryable'
        : 'terminal';
      expect(classifyFailure(reason)).toBe(expected);
      expect(expected).toBe(EXPECTED_CLASSIFICATION[reason]);
    }
    expect(Object.isFrozen(RETRYABLE_FAILURE_REASONS)).toBe(true);
    expect(Object.isFrozen(TERMINAL_FAILURE_REASONS)).toBe(true);
  });

  it('never retries unauthorized, not-configured or bad-response', () => {
    expect(classifyFailure('unauthorized')).toBe('terminal');
    expect(classifyFailure('not-configured')).toBe('terminal');
    expect(classifyFailure('bad-response')).toBe('terminal');
  });
});

describe('the default policy is finite, documented and deterministic', () => {
  it('reserves at least one call for the required fallback and is frozen', () => {
    expect(Object.isFrozen(DEFAULT_RETRY_POLICY)).toBe(true);
    expect(DEFAULT_RETRY_POLICY.maxTransportAttempts).toBeGreaterThanOrEqual(1);
    expect(DEFAULT_RETRY_POLICY.maxSchemaAttempts).toBeGreaterThanOrEqual(1);
    expect(DEFAULT_RETRY_POLICY.maxModelCalls).toBeGreaterThanOrEqual(2);
    expect(Number.isSafeInteger(DEFAULT_RETRY_POLICY.maxModelCalls)).toBe(true);
    expect(typeof DEFAULT_RETRY_POLICY.sleep).toBe('function');
  });

  it('applies overrides without mutating the shared default', () => {
    const resolved = resolveRetryPolicy({ maxTransportAttempts: 5, baseBackoffMs: 1 });
    expect(resolved.maxTransportAttempts).toBe(5);
    expect(resolved.baseBackoffMs).toBe(1);
    expect(resolved.maxModelCalls).toBe(DEFAULT_RETRY_POLICY.maxModelCalls);
    expect(Object.isFrozen(resolved)).toBe(true);
    expect(DEFAULT_RETRY_POLICY.maxTransportAttempts).not.toBe(5);
  });

  it.each([
    ['maxTransportAttempts', 0],
    ['maxTransportAttempts', -1],
    ['maxTransportAttempts', 1.5],
    ['maxSchemaAttempts', 0],
    ['maxModelCalls', 1],
    ['maxModelCalls', 3.5],
    ['baseBackoffMs', -1],
    ['baseBackoffMs', Number.POSITIVE_INFINITY],
    ['maxBackoffMs', -1],
    ['maxBackoffMs', Number.NaN],
  ])('rejects an invalid %s of %s', (field, value) => {
    expect(() => resolveRetryPolicy({ [field]: value })).toThrow(RangeError);
  });

  it.each([
    [10, 25, 1, 10],
    [10, 25, 2, 20],
    [10, 25, 3, 25],
    [10, 25, 9, 25],
    [0, 25, 4, 0],
  ])('backoff base %i cap %i at retry %i is %i', (baseBackoffMs, maxBackoffMs, retry, expected) => {
    const policy = resolveRetryPolicy({ baseBackoffMs, maxBackoffMs });
    expect(backoffDelay(policy, retry)).toBe(expected);
  });
});

describe('the attempt ledger is the single combined bound', () => {
  it('counts every provider call and refuses to exceed the cap', () => {
    const ledger = createAttemptLedger(3);
    expect(ledger.remaining).toBe(3);
    expect(ledger.used).toBe(0);
    expect([ledger.take(), ledger.take(), ledger.take(), ledger.take()]).toEqual([
      true,
      true,
      true,
      false,
    ]);
    expect(ledger.used).toBe(3);
    expect(ledger.remaining).toBe(0);
  });

  it('rejects a non-positive or fractional cap', () => {
    expect(() => createAttemptLedger(0)).toThrow(RangeError);
    expect(() => createAttemptLedger(2.5)).toThrow(RangeError);
  });
});

describe('the policy unit is not secretly a clock', () => {
  it('uses the injected sleep instead of a real timer', async () => {
    const sleep = vi.fn(async () => undefined);
    const policy = resolveRetryPolicy({ sleep });
    await policy.sleep(5, {});
    expect(sleep).toHaveBeenCalledWith(5, {});
  });
});
