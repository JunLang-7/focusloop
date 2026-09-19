import { describe, expect, it } from 'vitest';
import { PLAN_INITIAL_OPEN, nextPlanOpen } from './plan-visibility';

describe('the plan panel open state', () => {
  it('starts closed, so a running step is never behind a card', () => {
    expect(PLAN_INITIAL_OPEN).toBe(false);
  });

  it('opens when the trigger is pressed', () => {
    expect(nextPlanOpen(false, 'toggle')).toBe(true);
  });

  it('closes when the trigger is pressed again', () => {
    expect(nextPlanOpen(true, 'toggle')).toBe(false);
  });

  it('closes on Escape, so the keyboard is not a trap', () => {
    expect(nextPlanOpen(true, 'escape')).toBe(false);
  });

  it('closes on a click outside it', () => {
    expect(nextPlanOpen(true, 'outside')).toBe(false);
  });

  it('closes when a step starts, so the card is not left over the task', () => {
    expect(nextPlanOpen(true, 'start')).toBe(false);
  });

  it('closes when a step is finished, so the next one is not behind it', () => {
    expect(nextPlanOpen(true, 'finish')).toBe(false);
  });
});
