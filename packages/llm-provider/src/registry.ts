import type {
  AIProvider,
  CompletionRequest,
  CompletionResult,
  ProviderFailure,
} from '@focusloop/shared-types';
import { ProviderError } from './errors';
import { MockAIProvider } from './mock-provider';

export interface ProviderSelection {
  readonly primary: AIProvider;
  /** Always present. Guarantees the golden path survives provider failure. */
  readonly fallback: AIProvider;
}

export function createProviderSelection(primary?: AIProvider | null): ProviderSelection {
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
 * Degraded mode in one place: try the primary provider, and on any failure fall
 * back to the deterministic mock provider and report why.
 */
export async function completeWithFallback(
  selection: ProviderSelection,
  request: CompletionRequest,
): Promise<CompleteWithFallbackResult> {
  try {
    const result = await selection.primary.complete(request);
    return { ...result, degraded: false, failure: null };
  } catch (error) {
    const failure = toProviderFailure(error, selection.primary.id);
    const result = await selection.fallback.complete(request);
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
