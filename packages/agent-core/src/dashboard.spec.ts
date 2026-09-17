import { describe, expect, it } from 'vitest';
import type { LearningSession } from '@focusloop/shared-types';
import { buildDashboardSummary, formatDuration, formatLatency } from './dashboard';
import { demoCourse } from './demo-course';

const T0 = '2026-01-01T00:00:00.000Z';

function session(overrides: Partial<LearningSession> = {}): LearningSession {
  return {
    id: 's1',
    courseId: 'course-red-black-trees',
    startedAt: T0,
    state: 'FOCUSED',
    completedTaskIds: [],
    updatedAt: T0,
    ...overrides,
  };
}

describe('buildDashboardSummary', () => {
  it('returns an empty summary with the full action list when there is no session', () => {
    const summary = buildDashboardSummary({
      session: null,
      course: null,
      outcomes: [],
      checkpointCount: 0,
      now: T0,
    });
    expect(summary.sessionId).toBeNull();
    expect(summary.interventionOutcomes.length).toBeGreaterThan(0);
    expect(summary.averageResumeLatencyMs).toBeNull();
  });

  it('measures the running duration while the session is open', () => {
    const summary = buildDashboardSummary({
      session: session(),
      course: demoCourse(),
      outcomes: [],
      checkpointCount: 0,
      now: '2026-01-01T00:03:00.000Z',
    });
    expect(summary.sessionDurationMs).toBe(180_000);
  });

  it('freezes the duration once the session ended', () => {
    const summary = buildDashboardSummary({
      session: session({ endedAt: '2026-01-01T00:02:00.000Z' }),
      course: demoCourse(),
      outcomes: [],
      checkpointCount: 0,
      now: '2026-01-01T09:00:00.000Z',
    });
    expect(summary.sessionDurationMs).toBe(120_000);
  });

  it('reports task progress against the course', () => {
    const summary = buildDashboardSummary({
      session: session({ completedTaskIds: ['rbt-t1', 'rbt-t2'] }),
      course: demoCourse(),
      outcomes: [],
      checkpointCount: 0,
      now: T0,
    });
    expect(summary).toMatchObject({ tasksCompleted: 2, tasksTotal: 5 });
  });

  it('counts one interruption per checkpoint, however the interruption was detected', () => {
    const summary = buildDashboardSummary({
      session: session(),
      course: demoCourse(),
      outcomes: [],
      checkpointCount: 3,
      now: T0,
    });
    expect(summary.interruptCount).toBe(3);
  });

  it('never reports a negative interruption count', () => {
    const summary = buildDashboardSummary({
      session: session(),
      course: demoCourse(),
      outcomes: [],
      checkpointCount: -5,
      now: T0,
    });
    expect(summary.interruptCount).toBe(0);
  });

  it('reports a null course title when the course is missing', () => {
    const summary = buildDashboardSummary({
      session: session(),
      course: null,
      outcomes: [],
      checkpointCount: 0,
      now: T0,
    });
    expect(summary.courseTitle).toBeNull();
    expect(summary.tasksTotal).toBe(0);
  });

  it('never reports a negative duration when the clock is behind', () => {
    const summary = buildDashboardSummary({
      session: session({ startedAt: '2026-01-02T00:00:00.000Z' }),
      course: demoCourse(),
      outcomes: [],
      checkpointCount: 0,
      now: T0,
    });
    expect(summary.sessionDurationMs).toBe(0);
  });
});

describe('formatting helpers', () => {
  it('formats durations as m:ss', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(65_000)).toBe('1:05');
    expect(formatDuration(Number.NaN)).toBe('0:00');
  });

  it('formats latencies for humans', () => {
    expect(formatLatency(null)).toBe('—');
    expect(formatLatency(250)).toBe('250 ms');
    expect(formatLatency(2_500)).toBe('2.5 s');
  });
});
