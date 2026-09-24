import type {
  Course,
  EvaluateResumeOutcomeInput,
  LearningCheckpoint,
  LearningEvent,
  LearningSession,
  LocalizedMessage,
  MicroTask,
  ResumeCard,
  ResumePolicyConfig,
  ResumePolicyOverrides,
  ResumeVariant,
  ResumeOutcomeResult,
} from '@focusloop/shared-types';
import { DEFAULT_RESUME_POLICY_CONFIG, message } from '@focusloop/shared-types';

export interface BuildResumeCardInput {
  readonly checkpoint: LearningCheckpoint;
  readonly session: LearningSession;
  readonly course: Course;
  readonly recentEvents: readonly LearningEvent[];
  readonly now: string;
  readonly config?: ResumePolicyOverrides;
}

const DEFAULT_ESTIMATED_MINUTES = 5;
const MAX_COMPLETED_ITEMS = 3;
const MAX_UNRESOLVED_ITEMS = 3;
const LONG_REFRESHER_SECONDS = '30';

export function resolveResumePolicyConfig(
  overrides: ResumePolicyOverrides = {},
): ResumePolicyConfig {
  const config: ResumePolicyConfig = { ...DEFAULT_RESUME_POLICY_CONFIG, ...overrides };
  if (
    !Number.isFinite(config.shortThresholdMs) ||
    !Number.isFinite(config.longThresholdMs) ||
    !Number.isFinite(config.outcomeWindowMs) ||
    config.shortThresholdMs < 0 ||
    config.longThresholdMs < 0 ||
    config.outcomeWindowMs < 0
  ) {
    throw new RangeError('ResumePolicyConfig values must be non-negative finite numbers');
  }
  if (config.shortThresholdMs > config.longThresholdMs) {
    throw new RangeError('ResumePolicyConfig.shortThresholdMs must not exceed longThresholdMs');
  }
  return config;
}

/** Invalid or unavailable gaps conservatively use the medium card. */
export function classifyResumeGap(
  gapMs: number | null,
  overrides: ResumePolicyOverrides = {},
): ResumeVariant {
  const config = resolveResumePolicyConfig(overrides);
  if (gapMs === null || !Number.isFinite(gapMs) || gapMs < 0) return 'medium';
  if (gapMs < config.shortThresholdMs) return 'short';
  if (gapMs >= config.longThresholdMs) return 'long';
  return 'medium';
}

/** Selects one timestamp-ordered interruption record for both policy and card prose. */
function selectResumeInterruption(
  events: readonly LearningEvent[],
  now: string,
): { readonly event: LearningEvent; readonly gapMs: number } | null {
  const nowMs = Date.parse(now);
  if (!Number.isFinite(nowMs)) return null;
  const entries = events.map((event, index) => ({ event, index, atMs: Date.parse(event.at) }));
  const completed = entries
    .filter(
      ({ event, atMs }) =>
        Number.isFinite(atMs) &&
        atMs <= nowMs &&
        (event.type === 'TAB_RETURNED' || event.type === 'IDLE_ENDED') &&
        Number.isFinite(interruptionDuration(event)) &&
        interruptionDuration(event) >= 0,
    )
    .sort((a, b) => a.atMs - b.atMs || a.index - b.index)
    .at(-1);
  const started = entries
    .filter(
      ({ event, atMs }) =>
        Number.isFinite(atMs) &&
        atMs <= nowMs &&
        (event.type === 'TAB_LEFT' || event.type === 'IDLE_STARTED'),
    )
    .sort((a, b) => a.atMs - b.atMs || a.index - b.index)
    .at(-1);
  if (
    completed !== undefined &&
    (started === undefined ||
      completed.atMs > started.atMs ||
      (completed.atMs === started.atMs && completed.index > started.index))
  ) {
    return { event: completed.event, gapMs: interruptionDuration(completed.event) };
  }
  return started === undefined ? null : { event: started.event, gapMs: nowMs - started.atMs };
}

/** Uses the most recent completed interruption, or measures a newer open one to now. */
export function deriveResumeGapMs(events: readonly LearningEvent[], now: string): number | null {
  return selectResumeInterruption(events, now)?.gapMs ?? null;
}

function interruptionDuration(event: LearningEvent): number {
  if (event.type === 'TAB_RETURNED') return event.payload.awayMs;
  if (event.type === 'IDLE_ENDED') return event.payload.idleMs;
  return Number.NaN;
}

/**
 * Turns a checkpoint plus the events around the interruption into the small
 * card that gets the learner back to their cognitive position.
 *
 * Rule-based and deterministic on purpose — no LLM is involved in resume.
 */
export function buildResumeCard(input: BuildResumeCardInput): ResumeCard {
  const { checkpoint, course, recentEvents, session, now } = input;
  const interruption = selectResumeInterruption(recentEvents, now);
  const gapMs = interruption?.gapMs ?? null;
  const variant = classifyResumeGap(gapMs, input.config);
  const tasks = [...course.microTasks].sort((a, b) => a.order - b.order);
  const currentTask: MicroTask | null =
    tasks.find((task) => task.id === checkpoint.currentTaskId) ?? null;

  const completedSet = new Set(session.completedTaskIds);
  const completedTaskTitles = tasks
    .filter((task) => completedSet.has(task.id))
    .map((task) => task.title)
    .slice(-MAX_COMPLETED_ITEMS);

  const completed =
    completedTaskTitles.length > 0
      ? completedTaskTitles
      : [...checkpoint.mastered].slice(-MAX_COMPLETED_ITEMS);

  const itemLimit = variant === 'short' ? 1 : MAX_COMPLETED_ITEMS;
  return {
    variant,
    gapMs,
    refresher:
      variant === 'long'
        ? message('resume.refresher.long', { seconds: LONG_REFRESHER_SECONDS })
        : null,
    title:
      currentTask === null
        ? message('resume.title.course', { course: course.title })
        : message('resume.title.task', { task: currentTask.title }),
    lastContext: describeLastContext(checkpoint, interruption),
    completed: completed.slice(-itemLimit),
    unresolved: [...checkpoint.unresolved].slice(-Math.min(itemLimit, MAX_UNRESOLVED_ITEMS)),
    nextAction: checkpoint.nextBestAction,
    estimatedMinutes: clampMinutes(currentTask?.estimatedMinutes),
  };
}

function describeLastContext(
  checkpoint: LearningCheckpoint,
  interruption: { readonly event: LearningEvent; readonly gapMs: number } | null,
): LocalizedMessage {
  const base = { concept: checkpoint.conceptTitle, goal: checkpoint.goal };
  if (interruption === null) return message('resume.context.plain', base);

  if (interruption.gapMs <= 0) return message('resume.context.moment', base);

  return message('resume.context.away', {
    ...base,
    duration: formatDuration(interruption.gapMs),
  });
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.round(totalSeconds / 60);
  return `${minutes} min`;
}

function clampMinutes(minutes: number | undefined): number {
  if (minutes === undefined || !Number.isFinite(minutes) || minutes <= 0) {
    return DEFAULT_ESTIMATED_MINUTES;
  }
  return Math.min(60, Math.round(minutes));
}

/** Milliseconds between the card being shown and accepted, or null. */
export function computeResumeLatencyMs(
  shownAt: string,
  acceptedAt: string | undefined,
): number | null {
  if (acceptedAt === undefined) return null;
  const delta = Date.parse(acceptedAt) - Date.parse(shownAt);
  return Number.isFinite(delta) && delta >= 0 ? delta : null;
}

export function sessionTitle(session: LearningSession, course: Course): string {
  return `${course.title} · ${new Date(session.startedAt).toISOString().slice(0, 10)}`;
}

const REENGAGE_EVENT_TYPES = new Set<LearningEvent['type']>([
  'TASK_STARTED',
  'TASK_COMPLETED',
  'QUIZ_CORRECT',
  'QUIZ_INCORRECT',
  'HELP_REQUESTED',
]);

// A course step is a MicroTask, so completing the checkpoint task is its step-advance evidence.
// TASK_STARTED on a different task is not proof that this task progressed.
const PROGRESS_EVENT_TYPES = new Set<LearningEvent['type']>(['TASK_COMPLETED', 'QUIZ_CORRECT']);

/**
 * Observes what happened in the window after a resume was accepted.
 *
 * Three independent counts, not one "success" flag: re-engagement (any current-task
 * behaviour), progress (actually moved forward), and a stall (help again, another
 * interruption, or the session ended). Accepting and immediately asking for help is
 * reengaged without progressed — the case the old single rate called success.
 *
 * Dismissed cards are outside every denominator. Pending cards stay out of the rates
 * until the window closes. A session that ends inside the window is stalledAgain, not
 * a silent expiry.
 */
export function evaluateResumeOutcome(input: EvaluateResumeOutcomeInput): ResumeOutcomeResult {
  const config = resolveResumePolicyConfig(input.config);
  const windowMs =
    input.windowMs !== undefined && Number.isFinite(input.windowMs) && input.windowMs >= 0
      ? input.windowMs
      : config.outcomeWindowMs;
  const acceptedAtMs = Date.parse(input.timing.acceptedAt ?? '');
  const nowMs = Date.parse(input.now);

  if (input.timing.dismissedAt !== undefined) {
    return {
      status: 'dismissed',
      reengaged: false,
      progressed: false,
      stalledAgain: false,
      reengageEventIds: [],
      progressEventIds: [],
      stallEventIds: [],
      acceptedAt: input.timing.acceptedAt ?? null,
      windowEndsAt: Number.isFinite(acceptedAtMs)
        ? new Date(acceptedAtMs + windowMs).toISOString()
        : null,
    };
  }
  if (!Number.isFinite(acceptedAtMs)) {
    return {
      status: 'pending',
      reengaged: false,
      progressed: false,
      stalledAgain: false,
      reengageEventIds: [],
      progressEventIds: [],
      stallEventIds: [],
      acceptedAt: null,
      windowEndsAt: null,
    };
  }

  const windowEndMs = acceptedAtMs + windowMs;
  const reengageEventIds: string[] = [];
  const progressEventIds: string[] = [];
  const stallEventIds: string[] = [];
  const seen = new Set<string>();

  const withinWindow = (eventMs: number): boolean =>
    Number.isFinite(eventMs) &&
    Number.isFinite(nowMs) &&
    eventMs > acceptedAtMs &&
    eventMs <= windowEndMs &&
    eventMs <= nowMs;

  for (const event of input.events) {
    if (seen.has(event.id)) continue;
    const eventMs = Date.parse(event.at);
    if (!withinWindow(eventMs)) continue;
    if (event.sessionId !== input.checkpoint.sessionId) continue;

    let countsHere = false;
    if (event.type === 'HELP_REQUESTED') {
      // A help request is a stall signal even when older events omit taskId (or
      // the learner asks from a different task). Only current-task requests are
      // also re-engagement evidence.
      stallEventIds.push(event.id);
      countsHere = true;
      if (isCurrentTaskEvent(event, input.checkpoint.currentTaskId)) {
        reengageEventIds.push(event.id);
      }
    } else if (
      REENGAGE_EVENT_TYPES.has(event.type) &&
      isCurrentTaskEvent(event, input.checkpoint.currentTaskId)
    ) {
      reengageEventIds.push(event.id);
      countsHere = true;
      if (PROGRESS_EVENT_TYPES.has(event.type)) {
        progressEventIds.push(event.id);
      }
    } else if (event.type === 'TAB_LEFT' || event.type === 'IDLE_STARTED') {
      stallEventIds.push(event.id);
      countsHere = true;
    }
    if (countsHere) seen.add(event.id);
  }

  const endedMs = Date.parse(input.sessionEndedAt ?? '');
  const sessionEndedInWindow =
    Number.isFinite(endedMs) &&
    endedMs > acceptedAtMs &&
    endedMs <= windowEndMs &&
    endedMs <= nowMs;
  if (sessionEndedInWindow) {
    stallEventIds.push(`session-ended:${input.checkpoint.sessionId}`);
  }

  const reengaged = reengageEventIds.length > 0;
  const progressed = progressEventIds.length > 0;
  const stalledAgain = stallEventIds.length > 0;

  let status: ResumeOutcomeResult['status'];
  if (reengaged || stalledAgain) {
    status = 'observed';
  } else if (Number.isFinite(nowMs) && nowMs >= windowEndMs) {
    status = 'expired';
  } else {
    status = 'pending';
  }

  return {
    status,
    reengaged,
    progressed,
    stalledAgain,
    reengageEventIds,
    progressEventIds,
    stallEventIds,
    acceptedAt: input.timing.acceptedAt ?? null,
    windowEndsAt: new Date(windowEndMs).toISOString(),
  };
}

function isCurrentTaskEvent(event: LearningEvent, taskId: string): boolean {
  if (
    event.type !== 'TASK_STARTED' &&
    event.type !== 'TASK_COMPLETED' &&
    event.type !== 'QUIZ_CORRECT' &&
    event.type !== 'QUIZ_INCORRECT' &&
    event.type !== 'HELP_REQUESTED'
  ) {
    return false;
  }
  return event.payload.taskId === taskId;
}
