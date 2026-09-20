import { describe, expect, it } from 'vitest';
import { STUCK_REASONS } from '@focusloop/shared-types';
import { helpRequestPayload } from './stuck-picker';

/**
 * The only producer of the reason the policy acts on.
 *
 * These assertions look trivial, and that is the point: the payload is three keys wide, and it was in
 * a template callback where nothing read it. Deleting the reason, or renaming the key, is what the
 * suite is here to make impossible.
 */
describe('helpRequestPayload', () => {
  it('carries the reason the learner chose', () => {
    expect(helpRequestPayload('t1', 'too-big')).toEqual({ taskId: 't1', reason: 'too-big' });
  });

  it.each([...STUCK_REASONS])('carries %s under the key the policy reads', (reason) => {
    // The payload is typed, so the field name cannot drift silently in TypeScript — but it is written
    // through IPC, where the type is gone and the name is the whole contract.
    expect(Object.keys(helpRequestPayload('t1', reason)).sort()).toEqual(['reason', 'taskId']);
    expect(helpRequestPayload('t1', reason).reason).toBe(reason);
  });

  it('leaves the reason out when the learner would rather not say', () => {
    const payload = helpRequestPayload('t1', null);

    expect(payload).toEqual({ taskId: 't1' });
    // Not `reason: null` and not `reason: undefined`: an absent field is what "they did not say" has
    // always looked like, and the policy distinguishes the two.
    expect('reason' in payload).toBe(false);
  });

  it('names the task it is asking about', () => {
    // Without it the request cannot be tied to the task the learner was looking at.
    expect(helpRequestPayload('task-9', 'tired').taskId).toBe('task-9');
  });
});
