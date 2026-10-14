import type { ProviderFailureReason } from '@focusloop/shared-types';

/**
 * One status-to-reason mapping for every adapter that reads an HTTP response, so the same status
 * cannot be one reason on the completion path and another during model discovery.
 *
 * Two of these are worth naming: 429 is the transient quota *window* and stays `rate-limited`,
 * while 402 is the account itself — no balance, or a hard quota with nothing left — and is
 * `quota-exceeded`, which no retry can clear. Everything else that is not authentication is
 * `bad-response`: the request or the reply broke a contract this adapter publishes, and repeating
 * it reproduces the failure.
 */
export function mapStatusToReason(status: number): ProviderFailureReason {
  if (status === 401 || status === 403) return 'unauthorized';
  if (status === 402) return 'quota-exceeded';
  if (status === 429) return 'rate-limited';
  return 'bad-response';
}
