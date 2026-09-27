/**
 * Insights — what the learner has actually been doing, aggregated over time.
 *
 * Two rules shape everything here:
 *
 * 1. **Nothing is stored twice.** The summary is rebuilt from the event log by
 *    replaying it through the real state machine, so the dashboard cannot
 *    disagree with the engine about what happened.
 * 2. **Silence is neither focus nor away.** A learner who walks away generates no
 *    events, so a naive reconstruction would count the whole gap as `FOCUSED`. The
 *    opposite guess is worse: charging it as `DISTRACTED` invents an absence nobody
 *    observed, which is how a quiet hour of reading came out as "99.6% 离开中" and a
 *    session left open overnight filed sixteen hours of it against the learner.
 *    Silence is credited to the state it was in for at most `idleThresholdMs` and
 *    not counted past that, while an absence the app actually witnessed (`TAB_LEFT`,
 *    an idle report) keeps its whole stretch. `totalMs` is therefore the time the app
 *    can stand behind, not the session's wall-clock; the labels that read it, the
 *    wiki page for this feature, and `docs/architecture.md` say so.
 */
import {
  createInitialState,
  reduceState,
  resolveStateEngineConfig,
  type StateEngineConfig,
} from '@focusloop/learning-state';
import type {
  Course,
  DailyActivity,
  InsightRange,
  InsightsSummary,
  InterventionOutcome,
  LearningEvent,
  LearningSession,
  LearningState,
  StateShare,
} from '@focusloop/shared-types';
import { averageResumeLatencyMs } from '@focusloop/intervention-policy';

const MS_PER_DAY = 86_400_000;

/** One session, with everything the summary needs about it. */
export interface InsightsSessionSource {
  readonly session: LearningSession;
  /** Ascending by `at`. */
  readonly events: readonly LearningEvent[];
  /** `createdAt` of every checkpoint in the session — one per interruption. */
  readonly interruptionAt: readonly string[];
  readonly outcomes: readonly InterventionOutcome[];
}

export interface BuildInsightsInput {
  readonly range: InsightRange;
  /** "Now" — the exclusive end of every calendar window. */
  readonly now: string;
  readonly sources: readonly InsightsSessionSource[];
  readonly courses: readonly Course[];
  /** The session on screen, used by the `session` range. */
  readonly currentSessionId: string | null;
  readonly config?: Partial<StateEngineConfig>;
}

/** A stretch of time attributed to one learning state. */
export interface StateSegment {
  readonly state: LearningState;
  readonly fromMs: number;
  readonly toMs: number;
}

/** Local calendar date as `YYYY-MM-DD`. */
export function localDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Rebuilds the learning-state timeline of one session by replaying its events
 * through the same reducer the live engine uses.
 *
 * `untilIso` bounds an open session; a closed one is bounded by its own `endedAt`. The segments account
 * for the time the events witness — the idle threshold after each one, and for an open session no more
 * than that after its last — and leave the rest out rather than filling it with a state nobody measured.
 * See `credit` below for why that matters to a learner reading their own dashboard.
 */
export function buildStateTimeline(
  session: LearningSession,
  events: readonly LearningEvent[],
  untilIso: string,
  config: Partial<StateEngineConfig> = {},
): StateSegment[] {
  const startedMs = Date.parse(session.startedAt);
  if (!Number.isFinite(startedMs)) return [];

  const untilMs = Date.parse(untilIso);
  const endedMs = session.endedAt === undefined ? untilMs : Date.parse(session.endedAt);
  const limitMs = Math.min(Number.isFinite(endedMs) ? endedMs : untilMs, untilMs);
  if (!Number.isFinite(limitMs) || limitMs <= startedMs) return [];

  const { idleThresholdMs } = resolveStateEngineConfig(config);
  const segments: StateSegment[] = [];

  /**
   * Charges a stretch of silence to the state the engine was in.
   *
   * The app reports what it witnessed and nothing else. A state it actually measured — `DISTRACTED`
   * arrives from a `TAB_LEFT` or an idle report the bridge sent — keeps the whole stretch, because that
   * absence was observed. Silence between two events is a different thing entirely: it is not evidence of
   * anything, so it is capped at the idle threshold.
   *
   * The cap is a product decision that borrows the engine's constant rather than the engine's own rule:
   * `evaluateTimeBasedState` measures away and idle from an *explicit* report (`awaySince`, `idleSince`),
   * and without one it leaves a silent learner `FOCUSED` indefinitely. This replay has no such report to
   * go on between two events, so it takes the threshold as "how long a silence may be credited" and
   * stops guessing past it.
   *
   * The uncapped version charged every quiet stretch as `DISTRACTED`, and that is where the dashboard's
   * "99.6% 离开中" came from: a 59-minute session with two events in it spent 35 of those minutes being
   * called away, and a session left open overnight put sixteen hours of 离开中 into the day. The learner
   * was at the desk; the app simply had nothing to say about the time and said "away" instead.
   *
   * What is neither credited nor charged is not counted at all, so `totalMs` is the time the app can
   * stand behind rather than the wall-clock a session window happened to span.
   */
  const credit = (state: LearningState, fromMs: number, toMs: number): void => {
    const span = toMs - fromMs;
    if (span <= 0) return;
    const credited = state === 'DISTRACTED' ? span : Math.min(span, idleThresholdMs);
    if (credited > 0) segments.push({ state, fromMs, toMs: fromMs + credited });
  };

  let engineState = createInitialState(session.startedAt);
  let cursor = startedMs;

  for (const event of events) {
    const atMs = Date.parse(event.at);
    if (!Number.isFinite(atMs) || atMs < cursor || atMs > limitMs) continue;
    credit(engineState.state, cursor, atMs);
    engineState = reduceState(engineState, event, config).state;
    cursor = atMs;
  }

  /*
   * The tail, which is bounded differently for an open session and for a closed one.
   *
   * A closed session ends at an action: the learner pressed stop, and an action is a witness. An open
   * session has none, so its tail counts for one idle threshold and no further — the app cannot tell
   * "still focused" from "still away" four days later, and charging the whole span to `DISTRACTED` is
   * what filed sixteen hours of 离开中 against a day from a single `TAB_LEFT`, and four days against the
   * all-time window. `DISTRACTED` is still kept whole *within* the session, where the next event bounds
   * it; this only stops an unwitnessed tail from running to `now`.
   */
  const tailLimitMs = session.endedAt === undefined ? cursor + idleThresholdMs : limitMs;
  credit(engineState.state, cursor, Math.min(tailLimitMs, limitMs));
  return segments;
}

/** Splits `[fromMs, toMs)` at local midnight so each piece belongs to one day. */
function splitByLocalDay(fromMs: number, toMs: number): { date: string; ms: number }[] {
  const pieces: { date: string; ms: number }[] = [];
  let cursor = fromMs;
  while (cursor < toMs) {
    const nextMidnight = new Date(cursor);
    nextMidnight.setHours(24, 0, 0, 0);
    const boundary = Math.min(nextMidnight.getTime(), toMs);
    pieces.push({ date: localDateKey(new Date(cursor)), ms: boundary - cursor });
    cursor = boundary;
  }
  return pieces;
}

function startOfLocalDay(ms: number): number {
  const date = new Date(ms);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

interface Window {
  readonly fromMs: number;
  readonly toMs: number;
  readonly sessionOnlyId: string | null;
}

function resolveWindow(input: BuildInsightsInput, nowMs: number): Window {
  switch (input.range) {
    case 'today':
      return { fromMs: startOfLocalDay(nowMs), toMs: nowMs, sessionOnlyId: null };
    case 'week':
      return {
        fromMs: startOfLocalDay(nowMs - 6 * MS_PER_DAY),
        toMs: nowMs,
        sessionOnlyId: null,
      };
    case 'all': {
      const starts = input.sources
        .map((source) => Date.parse(source.session.startedAt))
        .filter((value) => Number.isFinite(value));
      return {
        fromMs: starts.length === 0 ? startOfLocalDay(nowMs) : Math.min(...starts),
        toMs: nowMs,
        sessionOnlyId: null,
      };
    }
    case 'session': {
      const current =
        input.sources.find((source) => source.session.id === input.currentSessionId) ??
        input.sources[0];
      if (current === undefined) {
        return { fromMs: startOfLocalDay(nowMs), toMs: nowMs, sessionOnlyId: null };
      }
      const startedMs = Date.parse(current.session.startedAt);
      return {
        fromMs: Number.isFinite(startedMs) ? startedMs : nowMs,
        toMs: nowMs,
        sessionOnlyId: current.session.id,
      };
    }
    default:
      return { fromMs: startOfLocalDay(nowMs), toMs: nowMs, sessionOnlyId: null };
  }
}

function emptyDay(date: string): DailyActivity {
  return { date, durationMs: 0, tasksCompleted: 0, interruptions: 0 };
}

export function buildInsightsSummary(input: BuildInsightsInput): InsightsSummary {
  const nowMs = Date.parse(input.now);
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  const window = resolveWindow(input, now);

  const stateMs = new Map<LearningState, number>();
  const dayMs = new Map<string, number>();
  const dayTasks = new Map<string, number>();
  const dayInterruptions = new Map<string, number>();
  const courseMs = new Map<string, number>();

  let totalMs = 0;
  let sessionCount = 0;
  let tasksCompleted = 0;
  let interruptions = 0;
  const outcomes: InterventionOutcome[] = [];

  const add = (map: Map<string, number>, key: string, value: number): void => {
    map.set(key, (map.get(key) ?? 0) + value);
  };

  for (const source of input.sources) {
    if (window.sessionOnlyId !== null && source.session.id !== window.sessionOnlyId) continue;

    const sessionStartMs = Date.parse(source.session.startedAt);
    const sessionEndMs =
      source.session.endedAt === undefined ? now : Date.parse(source.session.endedAt);
    if (!Number.isFinite(sessionStartMs)) continue;
    if (!Number.isFinite(sessionEndMs)) continue;

    // Overlap between the session and the window, or skip it entirely.
    const overlapFrom = Math.max(sessionStartMs, window.fromMs);
    const overlapTo = Math.min(sessionEndMs, window.toMs, now);
    if (overlapTo <= overlapFrom) continue;

    sessionCount += 1;
    outcomes.push(...source.outcomes);
    interruptions += source.interruptionAt.length;
    for (const at of source.interruptionAt) {
      const atMs = Date.parse(at);
      // The window ends `now` and `now` counts: an interruption recorded at this
      // very instant is the most recent one, not an out-of-range one.
      if (atMs >= window.fromMs && atMs <= window.toMs) {
        add(dayInterruptions, localDateKey(new Date(atMs)), 1);
      }
    }

    const seenTasks = new Set<string>();
    for (const event of source.events) {
      if (event.type !== 'TASK_COMPLETED') continue;
      const atMs = Date.parse(event.at);
      if (!Number.isFinite(atMs) || atMs < window.fromMs || atMs > window.toMs) continue;
      const taskId = (event.payload as { taskId?: unknown }).taskId;
      const key = typeof taskId === 'string' ? taskId : event.id;
      if (seenTasks.has(key)) continue;
      seenTasks.add(key);
      tasksCompleted += 1;
      add(dayTasks, localDateKey(new Date(atMs)), 1);
    }

    for (const segment of buildStateTimeline(
      source.session,
      source.events,
      new Date(Math.max(overlapTo, sessionStartMs)).toISOString(),
      input.config,
    )) {
      const fromMs = Math.max(segment.fromMs, window.fromMs, sessionStartMs);
      const toMs = Math.min(segment.toMs, window.toMs, now, sessionEndMs);
      if (toMs <= fromMs) continue;

      const span = toMs - fromMs;
      totalMs += span;
      stateMs.set(segment.state, (stateMs.get(segment.state) ?? 0) + span);
      add(courseMs, source.session.courseId, span);
      for (const piece of splitByLocalDay(fromMs, toMs)) {
        add(dayMs, piece.date, piece.ms);
      }
    }
  }

  const stateShares: StateShare[] = [...stateMs.entries()]
    .filter(([, durationMs]) => durationMs > 0)
    .map(([state, durationMs]) => ({
      state,
      durationMs,
      share: totalMs === 0 ? 0 : durationMs / totalMs,
    }))
    .sort((a, b) => b.durationMs - a.durationMs);

  const courseShares = [...courseMs.entries()]
    .filter(([, durationMs]) => durationMs > 0)
    .map(([courseId, durationMs]) => ({
      courseId,
      title: input.courses.find((course) => course.id === courseId)?.title ?? courseId,
      durationMs,
      share: totalMs === 0 ? 0 : durationMs / totalMs,
    }))
    .sort((a, b) => b.durationMs - a.durationMs);

  const daily: DailyActivity[] = [];
  const firstDayMs = startOfLocalDay(window.fromMs);
  for (let ms = firstDayMs; ms <= window.toMs; ms += MS_PER_DAY) {
    const date = localDateKey(new Date(ms));
    daily.push({
      date,
      durationMs: dayMs.get(date) ?? 0,
      tasksCompleted: dayTasks.get(date) ?? 0,
      interruptions: dayInterruptions.get(date) ?? 0,
    });
  }
  if (daily.length === 0) daily.push(emptyDay(localDateKey(new Date(window.toMs))));

  const activeDays = daily.filter((day) => day.durationMs > 0).length;
  const maxDailyMs = daily.reduce((max, day) => Math.max(max, day.durationMs), 0);

  return {
    range: input.range,
    from: new Date(window.fromMs).toISOString(),
    to: new Date(window.toMs).toISOString(),
    totalMs,
    sessionCount,
    tasksCompleted,
    interruptions,
    averageResumeLatencyMs: averageResumeLatencyMs(outcomes),
    activeDays,
    dailyAverageMs: activeDays === 0 ? 0 : Math.round(totalMs / activeDays),
    stateShares,
    daily,
    maxDailyMs,
    courseShares,
  };
}
