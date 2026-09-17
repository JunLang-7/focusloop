export interface CompletionRequest {
  readonly system?: string;
  readonly prompt: string;
  readonly maxTokens?: number;
  readonly temperature?: number;
  /** Hint for deterministic replay in tests. */
  readonly seed?: number;
}

export interface CompletionResult {
  readonly text: string;
  readonly providerId: string;
  readonly model: string;
  readonly latencyMs: number;
}

export interface AIProvider {
  readonly id: string;
  readonly model: string;
  /** `true` when the provider can run with no network and no credentials. */
  readonly offline: boolean;
  complete(request: CompletionRequest): Promise<CompletionResult>;
}

export type ProviderFailureReason =
  'offline' | 'timeout' | 'unauthorized' | 'rate-limited' | 'bad-response' | 'not-configured';

/**
 * Degraded mode contract: a provider failure must never break the golden path.
 * Callers fall back to the mock provider and surface this reason in the UI.
 */
export interface ProviderFailure {
  readonly reason: ProviderFailureReason;
  readonly message: string;
  readonly providerId: string;
}
