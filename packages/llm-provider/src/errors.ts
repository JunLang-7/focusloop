import type { ProviderFailureReason } from '@focusloop/shared-types';

/** Typed failure so callers can decide how to degrade. */
export class ProviderError extends Error {
  readonly reason: ProviderFailureReason;
  readonly providerId: string;

  constructor(reason: ProviderFailureReason, providerId: string, message: string) {
    super(message);
    this.name = 'ProviderError';
    this.reason = reason;
    this.providerId = providerId;
  }
}
