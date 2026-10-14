import { describe, expect, it } from 'vitest';
import { mapStatusToReason } from './http-status';

describe('the HTTP status vocabulary is one closed mapping', () => {
  it.each([
    [401, 'unauthorized'],
    [403, 'unauthorized'],
    [402, 'quota-exceeded'],
    [429, 'rate-limited'],
    [400, 'bad-response'],
    [404, 'bad-response'],
    [500, 'bad-response'],
    [503, 'bad-response'],
  ] as const)('maps %i to %s', (status, reason) => {
    expect(mapStatusToReason(status)).toBe(reason);
  });

  it('separates an empty account from a spent quota window', () => {
    // The distinction the nightly live probe needed: 402 needs a human, 429 needs a moment.
    expect(mapStatusToReason(402)).not.toBe(mapStatusToReason(429));
  });
});
