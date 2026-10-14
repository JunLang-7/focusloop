import type { ProviderFailureReason } from '@focusloop/shared-types';

/** Typed failure so callers can decide how to degrade. */
export class ProviderError extends Error {
  readonly reason: ProviderFailureReason;
  readonly providerId: string;
  /**
   * HTTP status when the failure came from a response. It is a number and nothing else — never a
   * body, a URL or a credential — and it is what separates two failures that share a reason: a 402
   * that says "top the account up" from a 500 that says "try again".
   */
  readonly status?: number;

  constructor(reason: ProviderFailureReason, providerId: string, message: string, status?: number) {
    super(message);
    this.name = 'ProviderError';
    this.reason = reason;
    this.providerId = providerId;
    if (status !== undefined) this.status = status;
  }
}
