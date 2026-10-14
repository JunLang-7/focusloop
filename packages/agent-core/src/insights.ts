/**
 * Insights — what the learner has actually been doing, aggregated over time.
 *
 * Two rules shape everything here:
 *
 * 1. **Nothing is stored twice.** The summary is rebuilt from the event log by
 *    replaying it through the real state machine, so the dashboard cannot
 *    disagree with the engine about what happened.
 * 2. **Study time is a measure, not a sum of event gaps.** The timeline is the single
 *    source of truth: replaying the reducer gives the state at every instant, and the
 *    time credited is the measure of the intervals in which the learner was studying.
 *    A stretch bounded by two events is credited whole, so splitting it with another
 *    event cannot change the total — the property the old rule broke, where the same
 *    ten minutes of reading counted as ten with an event every two minutes and as two
 *    with only a start and an end. Only two bounds remain, and neither is the old
 *    per-segment cap: the *unobserved* tail after the last event of an open session is
 *    bounded at `presenceTimeoutMs` for a study state and at `idleThresholdMs`
 *    otherwise, and a *non-study* state (away, interrupted, ready) is bounded
 *    everywhere, so a night away cannot inflate the recorded total. `totalMs` is the
 *    time the app can stand behind; the labels that read it, the wiki page for this
 *    feature, and `docs/architecture.md` say so.
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

/**
 * The states a learner can be *studying* in.
 *
 * Being on task is not the same as being `FOCUSED`: a learner who is confused or overloaded is still
 * working on the step, and a rule that only counted `FOCUSED` would read "I was stuck on this for ten
 * minutes" as "I did not study". `READY` is a session with no task running, `INITIATION_FRICTION` is time
 * not yet spent on one, and `DISTRACTED` and `INTERRUPTED` are the states this product exists to shorten —
 * none of them is study time, however long it lasted.
 */
const STUDY_STATES: ReadonlySet<LearningState> = new Set<LearningState>([
  'FOCUSED',
  'RESUMING',
  'CONFUSED',
  'OVERLOADED',
]);

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
 * `untilIso` bounds an open session; a closed one is bounded by its own `endedAt`. The returned segments
 * are already *credited*, not raw: an interval observed between two events keeps its whole span in a study
 * state, the unobserved tail is bounded by the presence timeout, and a state that is not study time is
 * bounded everywhere. See `credit` below for why each bound is where it is.
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

  const { idleThresholdMs, presenceTimeoutMs } = resolveStateEngineConfig(config);
  const segments: StateSegment[] = [];

  /**
   * Charges a stretch of time to the state the engine was in.
   *
   * Three rules, and the difference between them is the whole point.
   *
   * **A study state between two events keeps its whole span.** That is what makes the total independent of
   * how often the app happened to write an event: the measure of an interval does not change when the
   * interval is split. The old rule capped every piece at the idle threshold, so ten minutes of reading
   * counted as ten with an event every two minutes and as two with a single start and end — the same
   * behaviour, two different answers.
   *
   * **The unobserved tail is bounded.** After the last event of a still-open session there is nothing to
   * say the learner is still there, so a study state is credited at most `presenceTimeoutMs`. A closed
   * session's end event bounds the interval before it, so it never reaches this branch.
   *
   * **A state that is not study time is bounded everywhere.** An absence, an interruption, a session with
   * no task running: none is study, and an hour away — or twenty-two hours of it — must not read as an hour
   * of study time on the dashboard. The bound is the idle threshold, which is why the donut still shows a
   * small 离开中 slice rather than the shape of the night.
   *
   * What is neither credited nor charged is not counted at all, so `totalMs` is the time the app can stand
   * behind rather than the wall-clock a session window happened to span.
   */
  const credit = (state: LearningState, fromMs: number, toMs: number, observed: boolean): void => {
    const span = toMs - fromMs;
    if (span <= 0) return;
    const studying = STUDY_STATES.has(state);
    const credited =
      studying && observed ? span : Math.min(span, studying ? presenceTimeoutMs : idleThresholdMs);
    if (credited > 0) segments.push({ state, fromMs, toMs: fromMs + credited });
  };

  let engineState = createInitialState(session.startedAt);
  let cursor = startedMs;

  for (const event of events) {
    const atMs = Date.parse(event.at);
    if (!Number.isFinite(atMs) || atMs < cursor || atMs > limitMs) continue;
    // Bounded on the right by this event, so the stretch is observed; see `credit`.
    credit(engineState.state, cursor, atMs, true);
    engineState = reduceState(engineState, event, config).state;
    cursor = atMs;
  }

  /*
   * The tail, which is the one stretch with nothing after it to witness it. Whether the session was
   * closed by an action or left open, `credit` bounds it — at `presenceTimeoutMs` for a study state,
   * because that is how long the replay will guess an unobserved stretch was still study time.
   */
  credit(engineState.state, cursor, limitMs, false);
  return segments;
}

/**
 * How long one session was studied, by the only rule the app can stand behind.
 *
 * The sum of `buildStateTimeline`'s credited segments, which is the same number the dashboard's
 * "recorded time" is built from — so a session's own figure and the range figure cannot disagree.
 *
 * This exists because the session's elapsed time was the window's wall clock (`startedAt` → `now`),
 * and a session is not ended by closing the app. Left open overnight, and again over a weekend, the
 * focus screen reported the whole span: a learner who had studied for twenty minutes was told they
 * had been at it for two weeks, in a `minutes:seconds` field that rendered it as `21219:30`. The
 * learner's own dashboard said something else, because it had the rule and the progress strip did
 * not. Callers with an event log use this; the wall clock is what is left when there is nothing to
 * witness (see `buildDashboardSummary`), never the other way round.
 */
export function recordedSessionMs(
  source: InsightsSessionSource,
  now: string,
  config: Partial<StateEngineConfig> = {},
): number {
  return buildStateTimeline(source.session, source.events, now, config).reduce(
    (total, segment) => total + (segment.toMs - segment.fromMs),
    0,
  );
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

/**
 * The same window `resolveWindow('week')` resolves — exported so the weekly reflection (AG6.5)
 * cannot drift from the dashboard's week view: two "this week" numbers that disagree would be a
 * bug neither view could see.
 */
export function weekWindow(nowMs: number): { readonly fromMs: number; readonly toMs: number } {
  if (!Number.isFinite(nowMs)) throw new RangeError('weekWindow needs a finite instant');
  return { fromMs: startOfLocalDay(nowMs - 6 * MS_PER_DAY), toMs: nowMs };
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
    streakDays: allTimeStreakDays(input, now),
    courseShares,
  };
}

/**
 * Consecutive active days ending today — the habit figure, and deliberately **not** windowed.
 *
 * A seven-day window would cap a three-week streak at seven, which is the one number a streak exists to
 * report. A day is active exactly when the heatmap would colour it, so the two cannot disagree: it is
 * built from the same credited timeline, over every session rather than only the ones inside the window.
 *
 * The streak survives today: if today has nothing yet but yesterday was active, it still counts, because
 * the day is not over. If neither today nor yesterday is active, it is over.
 */
function allTimeStreakDays(input: BuildInsightsInput, nowMs: number): number {
  const active = new Set<string>();
  for (const source of input.sources) {
    const endedMs =
      source.session.endedAt === undefined ? nowMs : Date.parse(source.session.endedAt);
    const untilMs = Number.isFinite(endedMs) ? Math.min(endedMs, nowMs) : nowMs;
    const timeline = buildStateTimeline(
      source.session,
      source.events,
      new Date(untilMs).toISOString(),
      input.config,
    );
    for (const segment of timeline) {
      for (const piece of splitByLocalDay(segment.fromMs, segment.toMs)) {
        if (piece.ms > 0) active.add(piece.date);
      }
    }
  }
  return currentStreak(active, localDateKey(new Date(nowMs)));
}

/** The pure part of the streak, so the boundary can be tested without a session or a clock. */
export function currentStreak(activeDates: ReadonlySet<string>, today: string): number {
  const shift = (date: string, days: number): string => {
    const parsed = new Date(`${date}T12:00:00`);
    if (Number.isNaN(parsed.getTime())) return '';
    parsed.setDate(parsed.getDate() + days);
    return localDateKey(parsed);
  };
  let cursor = activeDates.has(today) ? today : shift(today, -1);
  let streak = 0;
  while (cursor !== '' && activeDates.has(cursor)) {
    streak += 1;
    cursor = shift(cursor, -1);
  }
  return streak;
}
