import { describe, expect, it } from 'vitest';
import type {
  Intervention,
  InterventionOutcome,
  LearningCheckpoint,
  LearningEvent,
  LearnerPreference,
  ResumeCardTiming,
} from '@focusloop/shared-types';
import { buildWeeklyReflection } from './reflection';
import { weekWindow } from './insights';
import { createTestEngine } from './test-helpers';
import { DEMO_COURSE_ID } from './demo-course';

const FROM = '2026-05-25T00:00:00.000Z';
const TO = '2026-06-01T00:00:00.000Z';
const IN = '2026-05-28T00:00:00.000Z';
const OUT = '2026-05-01T00:00:00.000Z';

const intervention = (
  id: string,
  at: string,
  action: Intervention['action'] = 'HINT',
): Intervention =>
  ({
    id,
    sessionId: 's1',
    at,
    state: 'CONFUSED',
    action,
    reason: { key: 'reason.x', params: {} },
    shownAt: at,
  }) as unknown as Intervention;

const outcome = (
  id: string,
  interventionId: string,
  at: string,
  flags: { accepted?: boolean; dismissed?: boolean } = {},
): InterventionOutcome =>
  ({
    id,
    interventionId,
    sessionId: 's1',
    at,
    state: 'CONFUSED',
    action: 'HINT',
    accepted: flags.accepted ?? false,
    dismissed: flags.dismissed ?? false,
    taskCompleted: false,
    resumeLatencyMs: null,
    quizOutcome: null,
  }) as unknown as InterventionOutcome;

const timing = (shownAt: string, acceptedAt?: string, dismissedAt?: string): ResumeCardTiming => ({
  checkpointId: 'cp-1',
  shownAt,
  ...(acceptedAt === undefined ? {} : { acceptedAt }),
  ...(dismissedAt === undefined ? {} : { dismissedAt }),
});

const input = (
  over: Partial<Parameters<typeof buildWeeklyReflection>[0]> = {},
): Parameters<typeof buildWeeklyReflection>[0] => ({
  windowFrom: FROM,
  windowTo: TO,
  interventions: [],
  outcomes: [],
  resumeTimings: [],
  checkpoints: [],
  tasksCompleted: [],
  preferences: [],
  ...over,
});

describe('the weekly reflection builder (AG6.5)', () => {
  it('counts only what is inside the window, and every count states its rows', () => {
    const reflection = buildWeeklyReflection(
      input({
        interventions: [intervention('i1', IN), intervention('i2', OUT)],
        outcomes: [
          outcome('o1', 'i1', IN, { accepted: true }),
          outcome('o2', 'i1', IN, { accepted: true }),
          outcome('o3', 'i1', IN, { dismissed: true }),
          outcome('o4', 'i1', IN),
          outcome('o5', 'i1', IN),
        ],
        checkpoints: [{ createdAt: IN } as unknown as LearningCheckpoint],
        tasksCompleted: [
          { at: IN, type: 'TASK_COMPLETED' } as unknown as LearningEvent,
          { at: OUT } as unknown as LearningEvent,
        ],
      }),
    );

    const stat = (key: string) => reflection.stats.find((row) => row.key === key);
    // The intervention outside the window is not this week's.
    expect(stat('interventions.shown')).toEqual({
      key: 'interventions.shown',
      value: 1,
      samples: 1,
    });
    // Ratios carry their denominator: two accepted of five outcomes *shown*.
    expect(stat('interventions.accepted')).toEqual({
      key: 'interventions.accepted',
      value: 2,
      samples: 5,
    });
    expect(stat('interventions.dismissed')).toEqual({
      key: 'interventions.dismissed',
      value: 1,
      samples: 5,
    });
    expect(stat('checkpoints.taken')).toEqual({ key: 'checkpoints.taken', value: 1, samples: 1 });
    expect(stat('tasks.completed')).toEqual({ key: 'tasks.completed', value: 1, samples: 1 });
    // Counts that are zero are omitted, not printed as zeros: their absence is the honest week.
    expect(stat('resumes.accepted')).toBeUndefined();
    expect(stat('interventions.dismissed')).toBeDefined();
  });

  it('changes when a row changes — a claim the spec can trace', () => {
    const before = buildWeeklyReflection(
      input({ outcomes: [outcome('o1', 'i1', IN, { accepted: true })] }),
    );
    const after = buildWeeklyReflection(
      input({
        outcomes: [
          outcome('o1', 'i1', IN, { accepted: true }),
          outcome('o2', 'i1', IN, { dismissed: true }),
        ],
      }),
    );
    expect(before.stats.find((row) => row.key === 'interventions.dismissed')).toBeUndefined();
    const dismissed = after.stats.find((row) => row.key === 'interventions.dismissed');
    expect(dismissed).toEqual({ key: 'interventions.dismissed', value: 1, samples: 2 });
    // The mutation moved exactly the claim it touched, and the accepted count's denominator with it.
    expect(after.stats.find((row) => row.key === 'interventions.accepted')?.samples).toBe(2);
  });

  it('counts the resumes the week showed — accepted and declined out of those shown', () => {
    const reflection = buildWeeklyReflection(
      input({
        resumeTimings: [
          timing(IN, IN), // accepted inside the window
          timing(IN, undefined, IN), // declined inside the window
          timing(IN), // shown, undecided — a denominator, not a claim
          timing(OUT, OUT), // shown last month: not this week's card
        ],
      }),
    );
    const stat = (key: string) => reflection.stats.find((row) => row.key === key);
    expect(stat('resumes.accepted')).toEqual({ key: 'resumes.accepted', value: 1, samples: 3 });
    expect(stat('resumes.dismissed')).toEqual({ key: 'resumes.dismissed', value: 1, samples: 3 });
    // Three shown in the window: the undecided card and the two decided ones count towards the
    // evidence; the card shown outside the window counts towards nothing.
    expect(stat('interventions.shown')).toBeUndefined();
  });

  it('an empty week is empty — no zero-stat filler, no stable guess', () => {
    const reflection = buildWeeklyReflection(input());
    expect(reflection.stats).toEqual([]);
    expect(reflection.preferences).toEqual([]);
  });

  it('is byte-identical when run twice', () => {
    const rows = input({
      interventions: [intervention('i1', IN)],
      outcomes: [outcome('o1', 'i1', IN, { accepted: true })],
      checkpoints: [{ createdAt: IN } as unknown as LearningCheckpoint],
    });
    expect(JSON.stringify(buildWeeklyReflection(rows))).toBe(
      JSON.stringify(buildWeeklyReflection(rows)),
    );
  });

  it('quotes a preference with ITS evidence — the window behind the claim, not the week', () => {
    const claim = (overrides: Partial<LearnerPreference>): LearnerPreference =>
      ({
        id: 'p1',
        sessionId: 's1',
        scope: 'task-size',
        value: { preferredStepMinutes: 2 },
        evidence: {
          windowStart: '2026-05-01T00:00:00.000Z',
          windowEnd: '2026-05-20T00:00:00.000Z',
          sampleSize: 4,
        },
        source: 'ag6.task-size',
        confirmedAt: null,
        expiresAt: null,
        createdAt: '2026-05-20T00:00:00.000Z',
        ...overrides,
      }) as LearnerPreference;

    const reflection = buildWeeklyReflection(input({ preferences: [claim({})] }));
    expect(reflection.preferences).toHaveLength(1);
    expect(reflection.preferences[0]).toEqual({
      scope: 'task-size',
      value: { preferredStepMinutes: 2 },
      samples: 4,
      windowFrom: '2026-05-01T00:00:00.000Z',
      windowTo: '2026-05-20T00:00:00.000Z',
    });

    // Expired before the week closed: never quoted as current (AG6.1).
    const expired = buildWeeklyReflection(
      input({ preferences: [claim({ expiresAt: '2026-05-30T00:00:00.000Z' })] }),
    );
    expect(expired.preferences).toEqual([]);
  });
});

describe('the reflection over the store (engine)', () => {
  it('gathers across sessions, the way the week view does', () => {
    const ctx = createTestEngine();
    try {
      const first = ctx.engine.startSession(DEMO_COURSE_ID);
      ctx.engine.dispatch({
        sessionId: first.session.id,
        type: 'TASK_COMPLETED',
        source: 'user',
        payload: { taskId: 'rbt-t1' },
      });
      ctx.engine.endSession({ sessionId: first.session.id, reason: 'user' });
      const second = ctx.engine.startSession(DEMO_COURSE_ID);
      ctx.engine.dispatch({
        sessionId: second.session.id,
        type: 'TASK_COMPLETED',
        source: 'user',
        payload: { taskId: 'rbt-t2' },
      });

      const reflection = ctx.engine.getWeeklyReflection();
      const completed = reflection.stats.find((row) => row.key === 'tasks.completed');
      // Both sessions' weeks are this week: the gather is cross-session, like the dashboard's view.
      expect(completed?.value).toBe(2);
      expect(reflection.preferences).toEqual([]);
    } finally {
      ctx.close();
    }
  });

  it('the window is the dashboard week: now, and six days back to the start of a local day', () => {
    const ctx = createTestEngine();
    try {
      const reflection = ctx.engine.getWeeklyReflection();
      const now = Date.parse(ctx.clock.now());
      const from = Date.parse(reflection.windowFrom);
      expect(reflection.windowTo).toBe(ctx.clock.now());
      expect(from).toBeLessThanOrEqual(now - 6 * 86_400_000);
      expect(from).toBeGreaterThan(now - 7 * 86_400_000);
    } finally {
      ctx.close();
    }
  });

  it('an engine with nothing reflects nothing', () => {
    const ctx = createTestEngine();
    try {
      const reflection = ctx.engine.getWeeklyReflection();
      expect(reflection.stats).toEqual([]);
      expect(reflection.preferences).toEqual([]);
    } finally {
      ctx.close();
    }
  });
});

describe('weekWindow (AG6.5)', () => {
  it('is the dashboard week: six days back to the start of a local day, and refuses nonsense', () => {
    const now = Date.parse('2026-06-01T12:00:00.000Z');
    const { fromMs, toMs } = weekWindow(now);
    expect(toMs).toBe(now);
    expect(fromMs).toBeLessThanOrEqual(now - 6 * 86_400_000);
    expect(fromMs).toBeGreaterThan(now - 7 * 86_400_000);
    expect(() => weekWindow(Number.NaN)).toThrow(RangeError);
  });
});
