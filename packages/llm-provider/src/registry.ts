import type { CompletionRequest, CompletionResult, ProviderFailure } from '@focusloop/shared-types';
import { ProviderError } from './errors';
import { MockAIProvider } from './mock-provider';
import {
  assertExecutionActive,
  isExecutionAbort,
  RuntimeDeadlineError,
  withExecution,
  type ExecutableAIProvider,
  type ExecutionOptions,
} from './execution';

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
}

/**
 * Try the primary, then bounded deterministic fallback on a provider failure.
 * Caller cancellation and the total deadline are terminal, never fallback triggers.
 */
export async function completeWithFallback(
  selection: ProviderSelection,
  request: CompletionRequest,
  options?: ExecutionOptions,
): Promise<CompleteWithFallbackResult> {
  assertExecutionActive(options, selection.primary.id);
  try {
    const result = await withExecution(
      (signal) => selection.primary.complete(request, { signal }),
      options,
      selection.primary.id,
    );
    assertExecutionActive(options, selection.primary.id);
    return { ...result, degraded: false, failure: null };
  } catch (error) {
    assertExecutionActive(options, selection.primary.id);
    if (isExecutionAbort(error) || error instanceof RuntimeDeadlineError) throw error;
    const failure = toProviderFailure(error, selection.primary.id);
    const result = await withExecution(
      (signal) => selection.fallback.complete(request, { signal }),
      options,
      selection.fallback.id,
    );
    assertExecutionActive(options, selection.fallback.id);
    return { ...result, degraded: true, failure };
  }
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
