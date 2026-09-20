import { describe, expect, it } from 'vitest';
import { STUCK_REASONS, isStuckReason } from './stuck';

describe('isStuckReason', () => {
  it('accepts every reason in the list', () => {
    // Pins the list: removing a reason from `STUCK_REASONS` without dealing with its action mapping
    // turns this red rather than silently narrowing what the policy can be told.
    for (const reason of STUCK_REASONS) {
      expect(isStuckReason(reason)).toBe(true);
    }
  });

  it('rejects a near miss', () => {
    // Hyphens are the shape of these strings, and `cannot_start` is the typo somebody will make.
    expect(isStuckReason('cannot_start')).toBe(false);
    expect(isStuckReason('stuck')).toBe(false);
  });

  it('rejects anything that is not a string', () => {
    expect(isStuckReason(undefined)).toBe(false);
    expect(isStuckReason(null)).toBe(false);
    expect(isStuckReason(0)).toBe(false);
  });
});
