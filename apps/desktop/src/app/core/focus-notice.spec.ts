import { describe, expect, it } from 'vitest';
import { isFocusRoute, noticeIsFolded, selectFocusNotice } from './focus-notice';

const quiet = { resume: false } as const;

describe('the single focus notice slot', () => {
  /*
   * It used to answer a three-way question (a resume card, the agent's proposal, an expired timer) and the
   * tests here pinned that precedence. The slot is now one thing, and the pin is what the *screen* may put
   * over a learner who is working: the return card, and nothing else. The agent's suggestion is drawn in
   * the step it is about and the expired timer is answered by the control that turns into "+1 minute", so
   * neither can arrive here even though both are still reachable.
   */
  it('is the return card, or nothing', () => {
    expect(selectFocusNotice(quiet)).toBeNull();
    expect(selectFocusNotice({ resume: true })).toBe('resume');
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
