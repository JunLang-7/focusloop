import { describe, expect, it } from 'vitest';
import { keepsRail } from './focus-phase';

describe('keepsRail', () => {
  it('keeps the full chrome before any commitment is made', () => {
    expect(keepsRail('ready')).toBe(false);
  });

  it('narrows the shell in every phase that follows a commitment', () => {
    for (const phase of ['active', 'paused', 'expired', 'complete'] as const) {
      expect(keepsRail(phase), phase).toBe(true);
    }
  });

  // The regression this guards: the rail used to be scoped to `active` and `paused`, so running
  // out of time or finishing a step put the sidebar, the Today summary and the settings back on
  // screen while the learner was still inside the focus workspace.
  it('does not release the rail when the timer runs out', () => {
    expect(keepsRail('expired')).toBe(true);
  });

  it('does not release the rail on the confirmation after a step', () => {
    expect(keepsRail('complete')).toBe(true);
  });
});
