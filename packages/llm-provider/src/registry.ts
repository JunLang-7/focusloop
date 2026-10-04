import type {
  CompletionRequest,
  CompletionResult,
  ProviderFailure,
  RuntimeBudgetReport,
} from '@focusloop/shared-types';
import { completionBudget, prepareBudget, type BudgetExecutionOptions } from './budgets';
import { ProviderError } from './errors';
import { MockAIProvider } from './mock-provider';
import { assertExecutionActive, withExecution, type ExecutableAIProvider } from './execution';
import {
  classifyFailure,
  createAttemptLedger,
  pauseBeforeRetry,
  primaryCallLimit,
  resolveRetryPolicy,
  type RetryPolicy,
} from './retry-policy';

export interface ProviderSelection {
  readonly primary: ExecutableAIProvider;
  /** Always present. Guarantees the golden path survives provider failure. */
  readonly fallback: ExecutableAIProvider;
}

export function createProviderSelection(primary?: ExecutableAIProvider | null): ProviderSelection {
  return {
    primary: primary ?? new MockAIProvider(),
    fallback: new MockAIProvider(),
  };
}

export interface CompleteWithFallbackResult extends CompletionResult {
  readonly degraded: boolean;
  readonly failure: ProviderFailure | null;
  readonly budget: RuntimeBudgetReport;
  /** Provider calls spent in total; at most the policy's `maxModelCalls`. */
  readonly attempts: number;
  /** Every failed attempt, in order, so provenance survives retries. */
  readonly failures: readonly ProviderFailure[];
}

/**
 * Try the primary — with bounded, classified retries — then the bounded deterministic fallback.
 * Caller cancellation and the total deadline are terminal, never fallback triggers, and the
 * ledger reserves a call for the fallback so retrying the primary cannot starve it.
 */
export async function completeWithFallback(
  selection: ProviderSelection,
  request: CompletionRequest,
  options?: BudgetExecutionOptions,
  retry?: Partial<RetryPolicy>,
): Promise<CompleteWithFallbackResult> {
  const policy = resolveRetryPolicy(retry);
  const prepared = prepareBudget(request, options?.budgets);
  const bounded = prepared.request;
  const ledger = createAttemptLedger(policy.maxModelCalls);
  const failures: ProviderFailure[] = [];
  let lastError: unknown;
  const providers = [
    { provider: selection.primary, limit: primaryCallLimit(policy) },
    { provider: selection.fallback, limit: policy.maxTransportAttempts },
  ];
  for (const [index, entry] of providers.entries()) {
    assertExecutionActive(options, entry.provider.id);
    const limit = Math.min(entry.limit, ledger.remaining);
    for (let attempt = 1; attempt <= limit; attempt += 1) {
      if (!ledger.take()) break;
      try {
        const result = await withExecution(
          (signal) => entry.provider.complete(bounded, { signal }),
          options,
          entry.provider.id,
        );
        const budget = completionBudget(prepared.report, result);
        assertExecutionActive(options, entry.provider.id);
        return budgetedResult(
          result,
          budget,
          index > 0,
          failures[0] ?? null,
          ledger.used,
          failures,
        );
      } catch (error) {
        // Reaching here means neither boundary was crossed: abort/deadline are terminal.
        assertExecutionActive(options, entry.provider.id);
        lastError = error;
        const failure = toProviderFailure(error, entry.provider.id);
        failures.push(failure);
        const exhausted = classifyFailure(failure.reason) === 'terminal';
        if (exhausted || attempt >= limit || ledger.remaining === 0) break;
        await pauseBeforeRetry(policy, options, entry.provider.id, attempt);
      }
    }
  }
  throw lastError;
}

function budgetedResult(
  result: CompletionResult,
  budget: RuntimeBudgetReport,
  degraded: boolean,
  failure: ProviderFailure | null,
  attempts: number,
  failures: readonly ProviderFailure[],
): CompleteWithFallbackResult {
  return {
    text: result.text,
    providerId: result.providerId,
    model: result.model,
    latencyMs: result.latencyMs,
    ...(budget.usage === undefined ? {} : { usage: budget.usage }),
    budget,
    degraded,
    failure,
    attempts,
    failures,
  };
}

export function toProviderFailure(error: unknown, providerId: string): ProviderFailure {
  if (error instanceof ProviderError) {
    return { reason: error.reason, message: error.message, providerId: error.providerId };
  }
  return {
    reason: 'bad-response',
    message: error instanceof Error ? error.message : 'Unknown provider failure',
    providerId,
  };
}
