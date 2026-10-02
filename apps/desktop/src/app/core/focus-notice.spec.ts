import { describe, expect, it } from 'vitest';
import { noticeIsFolded, selectFocusNotice } from './focus-notice';

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
    // Slot selection neither mutates nor consumes a losing candidate.
    expect(due).toEqual({ resume: true, rescue: true, action: 'SIMPLIFY', expired: true });
  });
});

describe('session-scoped folding', () => {
  it('survives notification changes and route remounts in the same session', () => {
    const fold = { sessionId: 'session-a', folded: true };
    expect(noticeIsFolded(fold, 'session-a')).toBe(true);
    expect(noticeIsFolded({ ...fold }, 'session-a')).toBe(true);
  });

  it('does not follow a learner into a new session or the no-session screen', () => {
    const fold = { sessionId: 'session-a', folded: true };
    expect(noticeIsFolded(fold, 'session-b')).toBe(false);
    expect(noticeIsFolded(fold, null)).toBe(false);
    expect(noticeIsFolded({ sessionId: 'session-a', folded: false }, 'session-a')).toBe(false);
  });
});
