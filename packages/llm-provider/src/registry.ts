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
}

/**
 * Try the primary, then bounded deterministic fallback on a provider failure.
 * Caller cancellation and the total deadline are terminal, never fallback triggers.
 */
export async function completeWithFallback(
  selection: ProviderSelection,
  request: CompletionRequest,
  options?: BudgetExecutionOptions,
): Promise<CompleteWithFallbackResult> {
  const prepared = prepareBudget(request, options?.budgets);
  const bounded = prepared.request;
  assertExecutionActive(options, selection.primary.id);
  try {
    const result = await withExecution(
      (signal) => selection.primary.complete(bounded, { signal }),
      options,
      selection.primary.id,
    );
    const budget = completionBudget(prepared.report, result);
    assertExecutionActive(options, selection.primary.id);
    return budgetedResult(result, budget, false, null);
  } catch (error) {
    // Both boundaries are enforced here, before anything is classified: a caller's cancellation
    // throws ExecutionAbortError and a passed deadline throws RuntimeDeadlineError, so only a
    // genuine provider failure reaches the fallback below. An `AbortError` that gets this far was
    // authored by the provider itself (an adapter bounding its own transport), which is a provider
    // failure and must degrade to the deterministic mock exactly as it did before this change.
    assertExecutionActive(options, selection.primary.id);
    const failure = toProviderFailure(error, selection.primary.id);
    const result = await withExecution(
      (signal) => selection.fallback.complete(bounded, { signal }),
      options,
      selection.fallback.id,
    );
    const budget = completionBudget(prepared.report, result);
    assertExecutionActive(options, selection.fallback.id);
    return budgetedResult(result, budget, true, failure);
  }
}

function budgetedResult(
  result: CompletionResult,
  budget: RuntimeBudgetReport,
  degraded: boolean,
  failure: ProviderFailure | null,
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
