import { describe, expect, it } from 'vitest';
import type {
  LearningCheckpoint,
  LearningEvent,
  LearningSession,
  ResumeCardTiming,
} from '@focusloop/shared-types';
import {
  buildDashboardSummary,
  emptyResumeOutcomeSummary,
  formatDuration,
  formatLatency,
  summarizeResumeOutcomes,
} from './dashboard';
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

function checkpoint(id: string): LearningCheckpoint {
  return {
    id,
    sessionId: 's1',
    conceptId: 'c1',
    conceptTitle: 'Rotations',
    goal: 'Learn',
    mastered: [],
    unresolved: [],
    currentTaskId: 'rbt-t1',
    currentTaskTitle: 'Read rotations',
    currentStep: 1,
    frictionState: 'FOCUSED',
    nextBestAction: { key: 'action.read.summarise', params: {} },
    createdAt: T0,
  };
}

function helpEvent(at: string, id = 'e-help'): LearningEvent {
  return {
    id,
    sessionId: 's1',
    at,
    type: 'HELP_REQUESTED',
    source: 'user',
    payload: { taskId: 'rbt-t1', reason: 'tired' },
  } as LearningEvent;
}

function completeEvent(at: string): LearningEvent {
  return {
    id: 'e-done',
    sessionId: 's1',
    at,
    type: 'TASK_COMPLETED',
    source: 'user',
    payload: { taskId: 'rbt-t1' },
  } as LearningEvent;
}

describe('summarizeResumeOutcomes', () => {
  const acceptedAt = '2026-01-01T00:01:00.000Z';
  const timing: ResumeCardTiming = {
    checkpointId: 'cp-1',
    shownAt: T0,
    acceptedAt,
  };

  it('counts accept-then-help-again as reengaged without progressed', () => {
    const summary = summarizeResumeOutcomes({
      timings: [timing],
      checkpoints: [checkpoint('cp-1')],
      events: [helpEvent('2026-01-01T00:01:30.000Z')],
      now: '2026-01-01T00:02:00.000Z',
    });

    expect(summary).toMatchObject({
      accepted: 1,
      reengaged: 1,
      progressed: 0,
      stalledAgain: 1,
      pending: 0,
    });
    expect(summary.reengageRate).toBe(1);
    expect(summary.progressRate).toBe(0);
  });

  it('keeps pending out of both rate denominators', () => {
    const pendingTiming: ResumeCardTiming = {
      checkpointId: 'cp-2',
      shownAt: T0,
      acceptedAt: '2026-01-01T00:04:30.000Z',
    };
    const summary = summarizeResumeOutcomes({
      timings: [timing, pendingTiming],
      checkpoints: [checkpoint('cp-1'), checkpoint('cp-2')],
      events: [completeEvent('2026-01-01T00:02:00.000Z')],
      now: '2026-01-01T00:05:00.000Z',
    });

    expect(summary.pending).toBe(1);
    expect(summary.reengageRate).toBe(1);
    expect(summary.progressRate).toBe(1);
    expect(summary.accepted).toBe(2);
  });

  it('does not double-count a session end as expired', () => {
    const summary = summarizeResumeOutcomes({
      timings: [timing],
      checkpoints: [checkpoint('cp-1')],
      events: [],
      sessionEndedAt: '2026-01-01T00:02:00.000Z',
      now: '2026-01-01T00:10:00.000Z',
    });
    expect(summary.stalledAgain).toBe(1);
    expect(summary.expired).toBe(0);
    expect(summary.reengaged).toBe(0);
  });

  it('excludes dismissed cards from every denominator', () => {
    const summary = summarizeResumeOutcomes({
      timings: [
        {
          checkpointId: 'cp-1',
          shownAt: T0,
          dismissedAt: '2026-01-01T00:01:00.000Z',
        },
      ],
      checkpoints: [checkpoint('cp-1')],
      events: [],
      now: '2026-01-01T00:10:00.000Z',
    });
    expect(summary).toEqual(emptyResumeOutcomeSummary());
  });
});

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
    expect(summary.resumeOutcomes.reengageRate).toBeNull();
    expect(summary.resumeOutcomes.progressRate).toBeNull();
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

  it('rebuilds resume outcomes from timings, checkpoints and events', () => {
    const summary = buildDashboardSummary({
      session: session(),
      course: demoCourse(),
      outcomes: [],
      checkpointCount: 1,
      resumeTimings: [
        { checkpointId: 'cp-1', shownAt: T0, acceptedAt: '2026-01-01T00:01:00.000Z' },
      ],
      checkpoints: [checkpoint('cp-1')],
      events: [helpEvent('2026-01-01T00:01:30.000Z')],
      now: '2026-01-01T00:02:00.000Z',
    });
    expect(summary.resumeOutcomes).toMatchObject({
      reengaged: 1,
      progressed: 0,
      stalledAgain: 1,
      reengageRate: 1,
      progressRate: 0,
    });
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
