import type {
  Course,
  LearningCheckpoint,
  LearningEvent,
  LearningSession,
  LocalizedMessage,
  MicroTask,
  ResumeCard,
} from '@focusloop/shared-types';
import { message } from '@focusloop/shared-types';

export interface BuildResumeCardInput {
  readonly checkpoint: LearningCheckpoint;
  readonly session: LearningSession;
  readonly course: Course;
  readonly recentEvents: readonly LearningEvent[];
  readonly now: string;
}

const DEFAULT_ESTIMATED_MINUTES = 5;
const MAX_COMPLETED_ITEMS = 3;

/**
 * Turns a checkpoint plus the events around the interruption into the small
 * card that gets the learner back to their cognitive position.
 *
 * Rule-based and deterministic on purpose — no LLM is involved in resume.
 */
export function buildResumeCard(input: BuildResumeCardInput): ResumeCard {
  const { checkpoint, course, recentEvents, session } = input;
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

  return {
    title:
      currentTask === null
        ? message('resume.title.course', { course: course.title })
        : message('resume.title.task', { task: currentTask.title }),
    lastContext: describeLastContext(checkpoint, recentEvents),
    completed,
    unresolved: [...checkpoint.unresolved],
    nextAction: checkpoint.nextBestAction,
    estimatedMinutes: clampMinutes(currentTask?.estimatedMinutes),
  };
}

function describeLastContext(
  checkpoint: LearningCheckpoint,
  recentEvents: readonly LearningEvent[],
): LocalizedMessage {
  const base = { concept: checkpoint.conceptTitle, goal: checkpoint.goal };
  const interruption = findLastInterruption(recentEvents);
  if (interruption === null) return message('resume.context.plain', base);

  const awayMs = interruption.awayMs;
  if (awayMs === null || awayMs <= 0) return message('resume.context.moment', base);

  return message('resume.context.away', { ...base, duration: formatDuration(awayMs) });
}

function findLastInterruption(
  recentEvents: readonly LearningEvent[],
): { awayMs: number | null } | null {
  for (let index = recentEvents.length - 1; index >= 0; index -= 1) {
    const event = recentEvents[index];
    if (event === undefined) continue;
    if (event.type === 'TAB_RETURNED') return { awayMs: event.payload.awayMs };
    if (event.type === 'IDLE_ENDED') return { awayMs: event.payload.idleMs };
  }
  return null;
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
