import type { ProviderFailureReason } from '@focusloop/shared-types';
import {
  assertExecutionActive,
  ExecutionAbortError,
  RuntimeDeadlineError,
  type ExecutionOptions,
} from './execution';

/**
 * Closed retry vocabulary. A reason is either retryable or terminal: the two lists below are
 * checked to partition every `ProviderFailureReason` by `retry-policy.spec.ts`, whose expectation
 * table must name every reason, and `classifyFailure` treats anything unlisted as terminal, so a
 * reason added to the shared type cannot silently inherit a retry.
 */
export type FailureClassification = 'retryable' | 'terminal';

/** Transient transport/quotas: the same provider may be asked again within the attempt limit. */
export const RETRYABLE_FAILURE_REASONS = Object.freeze([
  'offline',
  'timeout',
  'rate-limited',
] as const satisfies readonly ProviderFailureReason[]);

/**
 * `unauthorized`/`not-configured` need a human to fix configuration, and `bad-response` is a
 * deterministic contract violation: repeating the identical request reproduces it. Schema
 * validation has its own bounded retry for the *content* case, so `bad-response` adds no value here.
 */
export const TERMINAL_FAILURE_REASONS = Object.freeze([
  'unauthorized',
  'not-configured',
  'bad-response',
] as const satisfies readonly ProviderFailureReason[]);

export function classifyFailure(reason: ProviderFailureReason): FailureClassification {
  return (RETRYABLE_FAILURE_REASONS as readonly string[]).includes(reason)
    ? 'retryable'
    : 'terminal';
}

/** Process-local controls for one pause; never shared, persisted or sent to a provider. */
export interface RetrySleepControls {
  readonly signal?: AbortSignal;
  readonly deadlineMs?: number;
}
export type RetrySleep = (ms: number, controls: RetrySleepControls) => Promise<void>;

export interface RetryPolicy {
  /** Provider calls per provider for text/stream paths, including the first. */
  readonly maxTransportAttempts: number;
  /** Parse attempts per provider for structured output, including the first. */
  readonly maxSchemaAttempts: number;
  /** Hard cap on provider calls for the whole operation, across providers and retry kinds. */
  readonly maxModelCalls: number;
  /** First backoff delay; doubles per retry up to `maxBackoffMs`. */
  readonly baseBackoffMs: number;
  readonly maxBackoffMs: number;
  /** Injected so tests never wait on a real clock; the default honours signal/deadline. */
  readonly sleep: RetrySleep;
}

/** Signal-aware default pause. Zero delay never schedules a timer. */
async function defaultSleep(ms: number, controls: RetrySleepControls): Promise<void> {
  if (ms <= 0) return;
  await new Promise<void>((resolve, reject) => {
    const finish = (error?: unknown): void => {
      clearTimeout(timer);
      controls.signal?.removeEventListener('abort', onAbort);
      if (error === undefined) resolve();
      else reject(error);
    };
    const onAbort = (): void => finish(new ExecutionAbortError());
    const timer = setTimeout(() => finish(), ms);
    if (controls.signal?.aborted === true) {
      finish(new ExecutionAbortError());
      return;
    }
    controls.signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Product default: at most one transport retry per provider, one schema retry, and no more than
 * four provider calls in total — which always leaves the final call for the required local
 * fallback. Backoff is 250ms doubling to a 2s ceiling.
 */
export const DEFAULT_RETRY_POLICY: RetryPolicy = Object.freeze({
  maxTransportAttempts: 2,
  maxSchemaAttempts: 2,
  maxModelCalls: 4,
  baseBackoffMs: 250,
  maxBackoffMs: 2_000,
  sleep: defaultSleep,
});

export function resolveRetryPolicy(overrides?: Partial<RetryPolicy>): RetryPolicy {
  const policy: RetryPolicy = { ...DEFAULT_RETRY_POLICY, ...overrides };
  integer('maxTransportAttempts', policy.maxTransportAttempts, 1);
  integer('maxSchemaAttempts', policy.maxSchemaAttempts, 1);
  integer('maxModelCalls', policy.maxModelCalls, 2);
  integer('baseBackoffMs', policy.baseBackoffMs, 0);
  integer('maxBackoffMs', policy.maxBackoffMs, 0);
  if (policy.maxBackoffMs < policy.baseBackoffMs)
    throw new RangeError('maxBackoffMs must be at least baseBackoffMs');
  if (typeof policy.sleep !== 'function') throw new RangeError('sleep must be a function');
  return Object.freeze(policy);
}

function integer(field: string, value: number, minimum: number): void {
  if (!Number.isSafeInteger(value) || value < minimum)
    throw new RangeError(`${field} must be a safe integer >= ${minimum}`);
}

/** Deterministic exponential backoff; `retryIndex` is 1 for the first retry. */
export function backoffDelay(policy: RetryPolicy, retryIndex: number): number {
  const exponent = Math.max(0, Math.min(30, retryIndex - 1));
  return Math.min(policy.maxBackoffMs, policy.baseBackoffMs * 2 ** exponent);
}

/** Hard cap for one operation. Every provider call takes exactly one slot. */
export interface AttemptLedger {
  readonly used: number;
  readonly remaining: number;
  take(): boolean;
}

export function createAttemptLedger(maxModelCalls: number): AttemptLedger {
  integer('maxModelCalls', maxModelCalls, 1);
  let used = 0;
  return {
    get used() {
      return used;
    },
    get remaining() {
      return maxModelCalls - used;
    },
    take() {
      if (used >= maxModelCalls) return false;
      used += 1;
      return true;
    },
  };
}

/**
 * Calls the primary may spend, always leaving one slot for the required local fallback so a
 * retrying primary can never starve it.
 */
export function primaryCallLimit(
  policy: RetryPolicy,
  maxTransportAttempts = policy.maxTransportAttempts,
): number {
  return Math.min(maxTransportAttempts, Math.max(1, policy.maxModelCalls - 1));
}

/**
 * Bounded pause before the next attempt. Never sleeps past the absolute deadline and re-checks
 * cancellation afterwards, so no retry starts after either boundary was crossed.
 */
export async function pauseBeforeRetry(
  policy: RetryPolicy,
  controls: ExecutionOptions | undefined,
  providerId: string,
  retryIndex: number,
): Promise<void> {
  assertExecutionActive(controls, providerId);
  const delay = backoffDelay(policy, retryIndex);
  if (controls?.deadlineMs !== undefined && Date.now() + delay >= controls.deadlineMs)
    throw new RuntimeDeadlineError(providerId);
  await policy.sleep(delay, {
    ...(controls?.signal === undefined ? {} : { signal: controls.signal }),
    ...(controls?.deadlineMs === undefined ? {} : { deadlineMs: controls.deadlineMs }),
  });
  assertExecutionActive(controls, providerId);
}
