import { describe, expect, it } from 'vitest';
import type { MicroTask, MicroTaskKind } from '@focusloop/shared-types';
import { KIND_GLYPHS, buildPlan } from './session-plan';

const task = (id: string, estimatedMinutes: number, kind: MicroTaskKind = 'read'): MicroTask => ({
  id,
  courseId: 'course-1',
  conceptId: 'concept-1',
  title: `Task ${id}`,
  instructions: '',
  kind,
  estimatedMinutes,
  order: 0,
});

describe('buildPlan', () => {
  it('sizes a block in proportion to its estimate', () => {
    const plan = buildPlan([task('a', 2), task('b', 4)], { pxPerMinute: 10, minBlockPx: 1 });
    expect(plan.blocks[0]?.height).toBe(20);
    expect(plan.blocks[1]?.height).toBe(40);
  });

  it('never renders a block shorter than the floor', () => {
    const plan = buildPlan([task('a', 0), task('b', 1)], { pxPerMinute: 10, minBlockPx: 34 });
    expect(plan.blocks[0]?.height).toBe(34);
    expect(plan.blocks[1]?.height).toBe(34);
  });

  it('tiles the column: each block starts exactly where the last one ended', () => {
    const plan = buildPlan([task('a', 1), task('b', 5), task('c', 2)], {
      pxPerMinute: 10,
      minBlockPx: 34,
    });
    expect(plan.blocks[0]?.offset).toBe(0);
    expect(plan.blocks[1]?.offset).toBe(plan.blocks[0]?.height);
    expect(plan.blocks[2]?.offset).toBe(
      (plan.blocks[1]?.offset ?? 0) + (plan.blocks[1]?.height ?? 0),
    );
  });

  it('reports a track height that covers the last block exactly', () => {
    const plan = buildPlan([task('a', 3), task('b', 6)]);
    const last = plan.blocks[plan.blocks.length - 1];
    expect(plan.height).toBe((last?.offset ?? 0) + (last?.height ?? 0));
  });

  it('sums the estimates, which the track height is not proportional to', () => {
    const plan = buildPlan([task('a', 2), task('b', 3), task('c', 8)]);
    expect(plan.totalMinutes).toBe(13);
    expect(plan.height).toBeGreaterThan(plan.totalMinutes);
  });

  it('treats a negative estimate as nothing rather than as a negative block', () => {
    const plan = buildPlan([task('a', -5)], { pxPerMinute: 10, minBlockPx: 34 });
    expect(plan.blocks[0]?.minutes).toBe(0);
    expect(plan.blocks[0]?.height).toBe(34);
    expect(plan.totalMinutes).toBe(0);
  });

  it('returns an empty plan for a finished session', () => {
    expect(buildPlan([])).toEqual({ blocks: [], height: 0, totalMinutes: 0 });
  });

  it('carries the kind through, and gives every kind a distinct glyph', () => {
    const plan = buildPlan([task('a', 2, 'read'), task('b', 2, 'practice'), task('c', 2, 'quiz')]);
    expect(plan.blocks.map((block) => block.kind)).toEqual(['read', 'practice', 'quiz']);

    const glyphs = Object.values(KIND_GLYPHS);
    expect(new Set(glyphs).size).toBe(glyphs.length);
  });

  it('preserves the order it was given', () => {
    const plan = buildPlan([task('c', 2), task('a', 2), task('b', 2)]);
    expect(plan.blocks.map((block) => block.id)).toEqual(['c', 'a', 'b']);
  });
});
