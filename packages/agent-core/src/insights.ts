/**
 * Insights — what the learner has actually been doing, aggregated over time.
 *
 * Two rules shape everything here:
 *
 * 1. **Nothing is stored twice.** The summary is rebuilt from the event log by
 *    replaying it through the real state machine, so the dashboard cannot
 *    disagree with the engine about what happened.
 * 2. **Recorded time stops at the idle threshold, witnessed or not.** Nothing the
 *    app can observe says whether a long gap was studying, so a naive reconstruction
 *    would fill it with whatever state happened to be running; the opposite guess is
 *    worse, because charging it as `DISTRACTED` invents an absence nobody observed,
 *    which is how a quiet hour of reading came out as "99.6% 离开中". A witnessed
 *    absence is not the answer either: `TAB_LEFT` then `TAB_RETURNED` the next morning
 *    is a real absence, but it is still not study time, and crediting its whole span
 *    put twenty-two hours of 离开中 into the recorded total. So every stretch is
 *    credited to its state for at most `idleThresholdMs` and nothing is counted past
 *    that. `totalMs` is therefore the time the app can stand behind as study time, not
 *    the session's wall-clock; the labels that read it, the wiki page for this feature,
 *    and `docs/architecture.md` say so.
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
   * Charges a stretch of time to the state the engine was in, up to the idle threshold.
   *
   * Every span is capped, and that is the change worth naming. The cap began as a rule about *silence*: a
   * gap between two events is not evidence of anything, and the uncapped version charged quiet stretches as
   * `DISTRACTED`, which is where the dashboard's "99.6% 离开中" came from. A witnessed absence then kept its
   * whole stretch, because `TAB_LEFT` really did observe the learner leaving.
   *
   * But observing the absence does not make it study time. `TAB_LEFT` at night and `TAB_RETURNED` the next
   * morning is a real absence, and crediting its whole span put twenty-two hours of 离开中 into the
   * recorded total, so the page read as a day of study rather than a night away. The threshold is what the
   * app is willing to stand behind as *recorded* time, not as *observed* time: past it, the timeline stops
   * rather than guessing whether the learner stayed at the desk.
   *
   * The threshold is the engine's constant rather than the engine's own rule: `evaluateTimeBasedState`
   * measures away and idle from an *explicit* report (`awaySince`, `idleSince`), and without one it leaves a
   * silent learner `FOCUSED` indefinitely. This replay has no such report between two events, so it takes
   * the threshold as "how long a stretch may be credited" and stops past it.
   *
   * What is neither credited nor charged is not counted at all, so `totalMs` is the time the app can stand
   * behind rather than the wall-clock a session window happened to span.
   */
  const credit = (state: LearningState, fromMs: number, toMs: number): void => {
    const span = toMs - fromMs;
    if (span <= 0) return;
    const credited = Math.min(span, idleThresholdMs);
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
   * The tail. `credit` bounds this to one idle threshold like every other stretch, whether the session
   * was closed by an action or left open.
   *
   * An open session has no end action, so running its tail to `now` is how a single `TAB_LEFT` filed
   * sixteen hours of 离开中 against a day and four days against the all-time window. A closed session
   * has an end action, but that witness only says the learner was there at the end; it does not say the
   * last three hours were studying, so the same threshold bounds it.
   */
  credit(engineState.state, cursor, limitMs);
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
    courseShares,
  };
}
