import { describe, expect, it } from 'vitest';
import { contextInspectorVisibleOn } from './inspector-visibility';

describe('contextInspectorVisibleOn', () => {
  it('does not lay the inspector over the dashboard', () => {
    expect(contextInspectorVisibleOn('/dashboard')).toBe(false);
    expect(contextInspectorVisibleOn('/dashboard?window=today')).toBe(false);
    // Angular's matrix parameters are part of the path, so this is still the dashboard route.
    expect(contextInspectorVisibleOn('/dashboard;window=today')).toBe(false);
  });

  it('keeps it on the screens the learner works in', () => {
    expect(contextInspectorVisibleOn('/focus')).toBe(true);
    expect(contextInspectorVisibleOn('/home')).toBe(true);
    expect(contextInspectorVisibleOn('/')).toBe(true);
  });

  it('reads the route, not a word it starts with', () => {
    // `/dashboard-roundup` is a different screen; a prefix match would hide the inspector there too.
    expect(contextInspectorVisibleOn('/dashboards')).toBe(true);
    expect(contextInspectorVisibleOn('/dashboard-roundup')).toBe(true);
  });
});
