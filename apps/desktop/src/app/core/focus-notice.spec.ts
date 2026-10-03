import { describe, expect, it } from 'vitest';
import { isFocusRoute, noticeIsFolded, selectFocusNotice } from './focus-notice';

const quiet = { resume: false, rescue: false, action: null, expired: false } as const;

describe('the single focus notice slot', () => {
  it('is empty when nothing is due', () => {
    expect(selectFocusNotice(quiet)).toBeNull();
    expect(selectFocusNotice({ ...quiet, action: 'NO_ACTION' })).toBeNull();
    expect(selectFocusNotice({ ...quiet, action: 'RESUME' })).toBeNull();
  });

  it('carries each moment', () => {
    expect(selectFocusNotice({ ...quiet, expired: true })).toBe('time-up');
    expect(selectFocusNotice({ ...quiet, rescue: true })).toBe('help');
    expect(selectFocusNotice({ ...quiet, action: 'BREAK' })).toBe('help');
    expect(selectFocusNotice({ ...quiet, resume: true })).toBe('resume');
  });

  it('recovers position before help, and puts help before time up', () => {
    const due = { resume: true, rescue: true, action: 'SIMPLIFY', expired: true } as const;
    expect(selectFocusNotice(due)).toBe('resume');
    expect(selectFocusNotice({ ...due, resume: false })).toBe('help');
    expect(selectFocusNotice({ ...due, resume: false, rescue: false, action: null })).toBe(
      'time-up',
    );
    // RESUME and NO_ACTION are the policy's "say nothing" actions: the clock still owns the slot.
    expect(
      selectFocusNotice({ resume: false, rescue: false, action: 'RESUME', expired: true }),
    ).toBe('time-up');
    expect(
      selectFocusNotice({ resume: false, rescue: true, action: 'NO_ACTION', expired: false }),
    ).toBe('help');
  });
});

describe('the focus route predicate', () => {
  it('accepts the route with its query, fragment and matrix forms', () => {
    expect(isFocusRoute('/focus')).toBe(true);
    expect(isFocusRoute('/focus?task=1')).toBe(true);
    expect(isFocusRoute('/focus#top')).toBe(true);
    expect(isFocusRoute('/focus;x=1')).toBe(true);
  });

  it('rejects other screens that merely start with the same characters', () => {
    expect(isFocusRoute('/focus-roundup')).toBe(false);
    expect(isFocusRoute('/dashboard')).toBe(false);
    expect(isFocusRoute('/')).toBe(false);
  });
});

describe('session-scoped folding', () => {
  it('is a property of the session, not of the notice or the component', () => {
    const fold = { sessionId: 'session-a', folded: true };
    expect(noticeIsFolded(fold, 'session-a')).toBe(true);
    expect(noticeIsFolded(fold, 'session-b')).toBe(false);
  });

  it('does not follow a learner into a new session or the no-session screen', () => {
    const fold = { sessionId: 'session-a', folded: true };
    expect(noticeIsFolded(fold, 'session-b')).toBe(false);
    expect(noticeIsFolded(fold, null)).toBe(false);
    expect(noticeIsFolded({ sessionId: 'session-a', folded: false }, 'session-a')).toBe(false);
  });
});
