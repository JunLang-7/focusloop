import { describe, expect, it } from 'vitest';
import type {
  Course,
  InterventionOutcome,
  LearningEvent,
  LearningEventType,
  LearningSession,
} from '@focusloop/shared-types';
import {
  buildInsightsSummary,
  buildStateTimeline,
  localDateKey,
  type InsightsSessionSource,
} from './insights';

const SESSION_ID = 'session-1';
const COURSE_ID = 'course-1';
/** Local time, so day bucketing matches what the learner sees in any timezone. */
const at = (day: number, hour: number, minute = 0): string =>
  new Date(2026, 5, day, hour, minute, 0, 0).toISOString();
const dayKey = (day: number): string => localDateKey(new Date(2026, 5, day, 12, 0, 0));

function event(
  id: string,
  type: LearningEventType,
  atIso: string,
  payload: Record<string, unknown> = {},
): LearningEvent {
  return { id, sessionId: SESSION_ID, at: atIso, type, source: 'user', payload } as LearningEvent;
}

function session(startedAt: string, endedAt?: string): LearningSession {
  return {
    id: SESSION_ID,
    courseId: COURSE_ID,
    startedAt,
    ...(endedAt === undefined ? {} : { endedAt }),
    state: 'FOCUSED',
    completedTaskIds: [],
    updatedAt: endedAt ?? startedAt,
  };
}

function source(overrides: Partial<InsightsSessionSource> = {}): InsightsSessionSource {
  return {
    session: session(at(15, 10), at(15, 11)),
    events: [
      event('e1', 'TASK_STARTED', at(15, 10), { taskId: 't1' }),
      event('e2', 'TASK_COMPLETED', at(15, 10, 30), { taskId: 't1' }),
    ],
    interruptionAt: [],
    outcomes: [],
    ...overrides,
  };
}

const COURSES: Course[] = [
  {
    id: COURSE_ID,
    title: 'Red-black trees',
    description: '',
    concepts: [],
    microTasks: [],
    quizzes: [],
  },
];

describe('localDateKey', () => {
  it('formats a local calendar date, zero-padded', () => {
    expect(localDateKey(new Date(2026, 0, 5, 23, 30))).toBe('2026-01-05');
    expect(localDateKey(new Date(2026, 11, 31, 0, 0))).toBe('2026-12-31');
  });
});

describe('buildStateTimeline', () => {
  it('counts only the stretch it can stand behind, and invents no absence', () => {
    /*
     * An hour-long session with nothing in it. The app witnessed nothing, so it reports the one stretch it
     * can vouch for — the idle threshold after the session started — and stays silent about the other 58
     * minutes. Charging those as `DISTRACTED` is what turned a quiet evening of reading into
     * "99.6% 离开中" on the dashboard: the learner was at the desk, and the app said "away".
     */
    const segments = buildStateTimeline(session(at(15, 10), at(15, 11)), [], at(15, 11));
    expect(segments).toEqual([
      { state: 'READY', fromMs: Date.parse(at(15, 10)), toMs: Date.parse(at(15, 10, 2)) },
    ]);
  });

  it('attributes an event-free stretch to the state that was running', () => {
    const events = [event('e1', 'TASK_STARTED', at(15, 10), { taskId: 't1' })];
    // One minute of silence — under the idle threshold, so it stays FOCUSED.
    const segments = buildStateTimeline(session(at(15, 10), at(15, 10, 1)), events, at(15, 10, 1));
    expect(segments).toEqual([
      { state: 'FOCUSED', fromMs: Date.parse(at(15, 10)), toMs: Date.parse(at(15, 10, 1)) },
    ]);
  });

  it('credits silence up to the idle threshold, and counts nothing past it', () => {
    // 10 minutes of nothing. The engine's idle threshold is 2 minutes: that is what the app witnessed, and
    // the other 8 are not evidence of anything — least of all of being away.
    const events = [event('e1', 'TASK_STARTED', at(15, 10), { taskId: 't1' })];
    const segments = buildStateTimeline(
      session(at(15, 10), at(15, 10, 10)),
      events,
      at(15, 10, 10),
    );
    expect(segments).toEqual([
      { state: 'FOCUSED', fromMs: Date.parse(at(15, 10)), toMs: Date.parse(at(15, 10, 2)) },
    ]);
  });

  it('keeps a measured absence whole — away is what the bridge reported, not what silence hints at', () => {
    // `TAB_LEFT` then `TAB_RETURNED`: the learner really was away, and the whole hour is theirs to see.
    const events = [
      event('e1', 'TASK_STARTED', at(15, 10), { taskId: 't1' }),
      event('e2', 'TAB_LEFT', at(15, 10, 1)),
      event('e3', 'TAB_RETURNED', at(15, 11, 1), { awayMs: 60 * 60_000 }),
    ];
    const segments = buildStateTimeline(
      session(at(15, 10), at(15, 11, 30)),
      events,
      at(15, 11, 30),
    );
    const away = segments.find((s) => s.state === 'DISTRACTED');
    expect(away).toEqual({
      state: 'DISTRACTED',
      fromMs: Date.parse(at(15, 10, 1)),
      toMs: Date.parse(at(15, 11, 1)),
    });
  });

  it('honours a custom idle threshold', () => {
    const events = [event('e1', 'TASK_STARTED', at(15, 10), { taskId: 't1' })];
    const segments = buildStateTimeline(
      session(at(15, 10), at(15, 10, 10)),
      events,
      at(15, 10, 10),
      { idleThresholdMs: 60_000 },
    );
    const focused = segments.find((s) => s.state === 'FOCUSED');
    expect(focused?.toMs).toBe(Date.parse(at(15, 10, 1)));
  });

  it('bounds the tail of an open session at its last event plus the idle threshold', () => {
    /*
     * `TAB_LEFT` is a witnessed departure, but nothing witnesses how long it lasted: the app was left
     * open, so there is no end action to bound it. The tail is capped like any other silent stretch —
     * the alternative charged four days of `DISTRACTED` to the learner for one tab switch, and kept
     * growing while the app stayed open.
     */
    const events = [
      event('e1', 'TASK_STARTED', at(15, 10), { taskId: 't1' }),
      event('e2', 'TAB_LEFT', at(15, 10, 1)),
    ];
    const segments = buildStateTimeline(session(at(15, 10)), events, at(18, 12));
    expect(segments).toEqual([
      { state: 'FOCUSED', fromMs: Date.parse(at(15, 10)), toMs: Date.parse(at(15, 10, 1)) },
      { state: 'DISTRACTED', fromMs: Date.parse(at(15, 10, 1)), toMs: Date.parse(at(15, 10, 3)) },
    ]);
  });

  it('bounds an open session at `until`', () => {
    const segments = buildStateTimeline(session(at(15, 10)), [], at(15, 10, 1));
    expect(segments.reduce((sum, s) => sum + (s.toMs - s.fromMs), 0)).toBe(60_000);
  });

  it('ignores events that arrive after the session ended', () => {
    const events = [event('e1', 'TASK_STARTED', at(15, 12), { taskId: 't1' })];
    const segments = buildStateTimeline(session(at(15, 10), at(15, 11)), events, at(15, 13));
    expect(segments.some((s) => s.state === 'FOCUSED')).toBe(false);
  });

  it('returns nothing for a session that has not started yet', () => {
    expect(buildStateTimeline(session(at(15, 11)), [], at(15, 10))).toEqual([]);
  });
});

describe('buildInsightsSummary', () => {
  const RANGES = ['session', 'today', 'week', 'all'] as const;

  it('returns an empty but well-formed summary when nothing was recorded', () => {
    const summary = buildInsightsSummary({
      range: 'week',
      now: at(15, 12),
      sources: [],
      courses: [],
      currentSessionId: null,
    });
    expect(summary.totalMs).toBe(0);
    expect(summary.stateShares).toEqual([]);
    expect(summary.courseShares).toEqual([]);
    expect(summary.activeDays).toBe(0);
    expect(summary.dailyAverageMs).toBe(0);
    expect(summary.daily.length).toBe(7);
    expect(summary.averageResumeLatencyMs).toBeNull();
  });

  it('fills the window with one daily entry per calendar day, ascending', () => {
    const summary = buildInsightsSummary({
      range: 'week',
      now: at(15, 12),
      sources: [source()],
      courses: COURSES,
      currentSessionId: SESSION_ID,
    });
    expect(summary.daily.map((day) => day.date)).toEqual([
      dayKey(9),
      dayKey(10),
      dayKey(11),
      dayKey(12),
      dayKey(13),
      dayKey(14),
      dayKey(15),
    ]);
  });

  it('counts the time it can stand behind, across the states it passed through', () => {
    const summary = buildInsightsSummary({
      range: 'session',
      now: at(15, 12),
      sources: [source()],
      courses: COURSES,
      currentSessionId: SESSION_ID,
    });
    // 10:00 → 11:00 with events at 10:00 and 10:30: two stretches of the idle threshold, 4 minutes, not the
    // hour the window happened to span.
    expect(summary.totalMs).toBe(4 * 60_000);
    const shares = summary.stateShares.reduce((sum, s) => sum + s.share, 0);
    expect(shares).toBeCloseTo(1, 10);
    const durations = summary.stateShares.reduce((sum, s) => sum + s.durationMs, 0);
    expect(durations).toBe(summary.totalMs);
  });

  it('orders the state shares by duration', () => {
    const summary = buildInsightsSummary({
      range: 'session',
      now: at(15, 12),
      sources: [source()],
      courses: COURSES,
      currentSessionId: SESSION_ID,
    });
    const durations = summary.stateShares.map((s) => s.durationMs);
    expect([...durations].sort((a, b) => b - a)).toEqual(durations);
  });

  it('counts completed tasks once per task, in the day they happened', () => {
    const replay = source({
      events: [
        event('e1', 'TASK_STARTED', at(15, 10), { taskId: 't1' }),
        event('e2', 'TASK_COMPLETED', at(15, 10, 30), { taskId: 't1' }),
        // Same task reported twice by a retrying bridge: must not count twice.
        event('e3', 'TASK_COMPLETED', at(15, 10, 40), { taskId: 't1' }),
        event('e4', 'TASK_COMPLETED', at(15, 10, 50), { taskId: 't2' }),
      ],
    });
    const summary = buildInsightsSummary({
      range: 'session',
      now: at(15, 12),
      sources: [replay],
      courses: COURSES,
      currentSessionId: SESSION_ID,
    });
    expect(summary.tasksCompleted).toBe(2);
    expect(summary.daily.find((day) => day.date === dayKey(15))?.tasksCompleted).toBe(2);
  });

  it('counts interruptions from the checkpoints that caused a resume card', () => {
    const summary = buildInsightsSummary({
      range: 'session',
      now: at(15, 12),
      sources: [source({ interruptionAt: [at(15, 10, 20), at(15, 10, 40)] })],
      courses: COURSES,
      currentSessionId: SESSION_ID,
    });
    expect(summary.interruptions).toBe(2);
    expect(summary.daily.find((day) => day.date === dayKey(15))?.interruptions).toBe(2);
  });

  it('splits a stretch that crosses local midnight across both days', () => {
    /*
     * Driven by events, with the threshold given here rather than taken from the default: an event-free
     * session accounts for two minutes now, so a fixture that leaned on the default would quietly turn
     * into a test of the threshold value instead of a test of the split.
     */
    const overnight = source({
      // Ends at the second event, so the only minute-pair under test is the one that straddles midnight.
      session: session(at(15, 23, 59), at(16, 0, 1)),
      events: [
        event('e1', 'TASK_STARTED', at(15, 23, 59), { taskId: 't1' }),
        event('e2', 'TASK_COMPLETED', at(16, 0, 1), { taskId: 't1' }),
      ],
    });
    const summary = buildInsightsSummary({
      range: 'week',
      now: at(16, 12),
      sources: [overnight],
      courses: COURSES,
      currentSessionId: SESSION_ID,
      config: { idleThresholdMs: 5 * 60_000 },
    });
    const first = summary.daily.find((day) => day.date === dayKey(15));
    const second = summary.daily.find((day) => day.date === dayKey(16));
    // One minute on each side of midnight, from the event pair rather than from the threshold.
    expect(first?.durationMs).toBe(60_000);
    expect(second?.durationMs).toBe(60_000);
    expect((first?.durationMs ?? 0) + (second?.durationMs ?? 0)).toBe(summary.totalMs);
  });

  it('scopes the session range to the session on screen', () => {
    const other = source({
      session: { ...session(at(15, 9), at(15, 9, 30)), id: 'session-2', courseId: 'course-2' },
    });
    const summary = buildInsightsSummary({
      range: 'session',
      now: at(15, 12),
      sources: [other, source()],
      courses: COURSES,
      currentSessionId: SESSION_ID,
    });
    expect(summary.sessionCount).toBe(1);
    expect(summary.courseShares.map((c) => c.courseId)).toEqual([COURSE_ID]);
  });

  it('excludes work from before the window', () => {
    const yesterday = source({
      session: { ...session(at(14, 10), at(14, 11)), id: 'session-old' },
    });
    const summary = buildInsightsSummary({
      range: 'today',
      now: at(15, 12),
      sources: [yesterday, source()],
      courses: COURSES,
      currentSessionId: SESSION_ID,
    });
    expect(summary.sessionCount).toBe(1);
    expect(summary.daily).toHaveLength(1);
    expect(summary.daily[0]?.date).toBe(dayKey(15));
  });

  it('averages over active days only', () => {
    const summary = buildInsightsSummary({
      range: 'week',
      now: at(15, 12),
      sources: [source()],
      courses: COURSES,
      currentSessionId: SESSION_ID,
    });
    expect(summary.activeDays).toBe(1);
    expect(summary.dailyAverageMs).toBe(summary.totalMs);
  });

  it('scales the heatmap against the busiest day', () => {
    const summary = buildInsightsSummary({
      range: 'week',
      now: at(15, 12),
      sources: [source()],
      courses: COURSES,
      currentSessionId: SESSION_ID,
    });
    const longest = summary.daily.reduce((max, day) => Math.max(max, day.durationMs), 0);
    expect(summary.maxDailyMs).toBe(longest);
  });

  it('groups time by course and resolves the title', () => {
    const second = source({
      session: { ...session(at(15, 11), at(15, 11, 30)), id: 'session-2', courseId: 'course-2' },
    });
    const courses: Course[] = [
      ...COURSES,
      { ...COURSES[0]!, id: 'course-2', title: 'Binary search' },
    ];
    const summary = buildInsightsSummary({
      range: 'all',
      now: at(15, 12),
      sources: [source(), second],
      courses,
      currentSessionId: SESSION_ID,
    });
    expect(summary.sessionCount).toBe(2);
    expect(summary.courseShares.map((c) => c.title)).toEqual(['Red-black trees', 'Binary search']);
  });

  it('falls back to the course id when the course is gone', () => {
    const summary = buildInsightsSummary({
      range: 'session',
      now: at(15, 12),
      sources: [source()],
      courses: [],
      currentSessionId: SESSION_ID,
    });
    expect(summary.courseShares[0]?.title).toBe(COURSE_ID);
  });

  it('reports the average resume latency of the outcomes inside the window', () => {
    const outcomes: InterventionOutcome[] = [
      {
        id: 'o1',
        interventionId: 'i1',
        sessionId: SESSION_ID,
        at: at(15, 10, 30),
        state: 'INTERRUPTED',
        action: 'RESUME',
        accepted: true,
        dismissed: false,
        taskCompleted: true,
        resumeLatencyMs: 4_000,
        quizOutcome: null,
      },
      {
        id: 'o2',
        interventionId: 'i2',
        sessionId: SESSION_ID,
        at: at(15, 10, 45),
        state: 'INTERRUPTED',
        action: 'RESUME',
        accepted: true,
        dismissed: false,
        taskCompleted: true,
        resumeLatencyMs: 8_000,
        quizOutcome: null,
      },
    ];
    const summary = buildInsightsSummary({
      range: 'session',
      now: at(15, 12),
      sources: [source({ outcomes })],
      courses: COURSES,
      currentSessionId: SESSION_ID,
    });
    expect(summary.averageResumeLatencyMs).toBe(6_000);
  });

  it('produces a well-formed summary for every range', () => {
    for (const range of RANGES) {
      const summary = buildInsightsSummary({
        range,
        now: at(15, 12),
        sources: [source()],
        courses: COURSES,
        currentSessionId: SESSION_ID,
      });
      expect(summary.range).toBe(range);
      expect(summary.daily.length).toBeGreaterThan(0);
      expect(summary.totalMs).toBeGreaterThanOrEqual(0);
      expect(Date.parse(summary.from)).toBeLessThanOrEqual(Date.parse(summary.to));
    }
  });
});
