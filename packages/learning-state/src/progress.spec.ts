import { describe, expect, it } from 'vitest';
import { computeSessionProgress } from './progress';

const START = '2026-01-01T00:00:00.000Z';

describe('computeSessionProgress', () => {
  it('reports ratio 0 for an empty course', () => {
    const progress = computeSessionProgress({
      sessionId: 's1',
      startedAt: START,
      totalTasks: 0,
      completedTaskIds: [],
      now: START,
    });
    expect(progress.completionRatio).toBe(0);
  });

  it('computes completion ratio and elapsed time', () => {
    const progress = computeSessionProgress({
      sessionId: 's1',
      startedAt: START,
      totalTasks: 5,
      completedTaskIds: ['a', 'b'],
      now: '2026-01-01T00:10:00.000Z',
    });
    expect(progress.completedTasks).toBe(2);
    expect(progress.completionRatio).toBeCloseTo(0.4);
    expect(progress.elapsedMs).toBe(600_000);
  });

  it('freezes elapsed time once the session has ended', () => {
    const progress = computeSessionProgress({
      sessionId: 's1',
      startedAt: START,
      endedAt: '2026-01-01T00:05:00.000Z',
      totalTasks: 5,
      completedTaskIds: ['a'],
      now: '2026-01-01T01:00:00.000Z',
    });
    expect(progress.elapsedMs).toBe(300_000);
  });

  it('never reports more completed tasks than exist', () => {
    const progress = computeSessionProgress({
      sessionId: 's1',
      startedAt: START,
      totalTasks: 2,
      completedTaskIds: ['a', 'b', 'c'],
      now: START,
    });
    expect(progress.completedTasks).toBe(2);
    expect(progress.completionRatio).toBe(1);
  });

  it('clamps negative elapsed time to zero', () => {
    const progress = computeSessionProgress({
      sessionId: 's1',
      startedAt: '2026-01-01T00:10:00.000Z',
      totalTasks: 1,
      completedTaskIds: [],
      now: START,
    });
    expect(progress.elapsedMs).toBe(0);
  });
});
