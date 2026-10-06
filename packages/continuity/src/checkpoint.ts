import type {
  Course,
  LearningCheckpoint,
  LearningSession,
  LocalizedMessage,
  MicroTask,
} from '@focusloop/shared-types';
import { applyTaskOrder, message } from '@focusloop/shared-types';
import type { StateEngineState } from '@focusloop/learning-state';

export interface BuildCheckpointInput {
  readonly session: LearningSession;
  readonly course: Course;
  readonly engineState: StateEngineState;
  /** Optional override; by default derived from the current task. */
  readonly goal?: string;
  readonly now: string;
  /** Deterministic id source. Defaults to `${sessionId}:${createdAt}`. */
  readonly checkpointId?: string;
}

export interface CheckpointProgressView {
  readonly mastered: readonly string[];
  readonly unresolved: readonly string[];
  readonly currentTask: MicroTask | null;
  readonly currentIndex: number;
}

export function orderedTasks(course: Course): MicroTask[] {
  return [...course.microTasks].sort((a, b) => a.order - b.order);
}

/**
 * Splits the course into what the learner has actually finished and what is
 * still open. This is the substance of a checkpoint: not "which screen", but
 * "which ideas are secure and which are not".
 */
export function describeProgress(
  course: Course,
  completedTaskIds: readonly string[],
  currentTaskId: string | null,
): CheckpointProgressView {
  const completed = new Set(completedTaskIds);
  const tasks = orderedTasks(course);
  const mastered: string[] = [];
  const unresolved: string[] = [];

  for (const concept of [...course.concepts].sort((a, b) => a.order - b.order)) {
    const conceptTasks = tasks.filter((task) => task.conceptId === concept.id);
    if (conceptTasks.length === 0) continue;
    const done = conceptTasks.filter((task) => completed.has(task.id)).length;
    if (done === conceptTasks.length) {
      mastered.push(concept.title);
    } else if (done > 0) {
      unresolved.push(concept.title);
    }
  }

  const currentIndex =
    currentTaskId === null ? -1 : tasks.findIndex((task) => task.id === currentTaskId);
  const currentTask = currentIndex >= 0 ? (tasks[currentIndex] ?? null) : null;

  if (currentTask !== null && !mastered.includes(conceptTitle(course, currentTask.conceptId))) {
    const title = conceptTitle(course, currentTask.conceptId);
    if (!unresolved.includes(title)) unresolved.push(title);
  }

  return { mastered, unresolved, currentTask, currentIndex };
}

function conceptTitle(course: Course, conceptId: string): string {
  return course.concepts.find((concept) => concept.id === conceptId)?.title ?? conceptId;
}

/**
 * The first task that is neither completed nor the current one, in the order the learner means to
 * reach them.
 *
 * The learner's own order when they have one (#23), because this is what answers "which task comes
 * next" and the focus screen's *Next small step* card is built from that same list — a checkpoint that
 * answered differently would offer a task the screen is not showing. Before the first drag there is no
 * order, and the course's is the answer.
 *
 * It is deliberately not used for the step number: that plan excludes the running task, so it has
 * nowhere to put the task this function is usually asked about. See `courseStep` on
 * `LearningCheckpoint`, which says the same thing the other way round.
 */
export function firstIncompleteTask(
  course: Course,
  completedTaskIds: readonly string[],
  taskOrder: readonly string[] = [],
): MicroTask | null {
  const completed = new Set(completedTaskIds);
  const open = orderedTasks(course).filter((task) => !completed.has(task.id));
  return applyTaskOrder(open, taskOrder)[0] ?? null;
}

/**
 * Builds the persisted "cognitive position" of the learner.
 *
 * Pure and deterministic: given the same inputs it always produces the same
 * checkpoint, which is what makes resume reproducible and testable.
 */
export function buildCheckpoint(input: BuildCheckpointInput): LearningCheckpoint {
  const { course, engineState, now, session } = input;
  const tasks = orderedTasks(course);
  const progress = describeProgress(
    course,
    engineState.completedTaskIds,
    engineState.currentTaskId,
  );

  const focusTask =
    progress.currentTask ??
    (engineState.lastActiveTaskId === null
      ? null
      : (tasks.find((task) => task.id === engineState.lastActiveTaskId) ?? null)) ??
    firstIncompleteTask(course, engineState.completedTaskIds, session.taskOrder ?? []);

  const currentTaskId = focusTask?.id ?? '';
  const currentTaskTitle = focusTask?.title ?? '';
  const conceptId = focusTask?.conceptId ?? course.concepts[0]?.id ?? '';
  // The course's position, not the plan's: `tasks` comes from `orderedTasks` and never from the
  // learner's reorder, for the reason written on the field (#194).
  const courseStep =
    focusTask === null ? 0 : tasks.findIndex((task) => task.id === focusTask.id) + 1;

  return {
    id: input.checkpointId ?? `${session.id}:${now}`,
    sessionId: session.id,
    conceptId,
    conceptTitle: conceptTitle(course, conceptId),
    goal: input.goal ?? focusTask?.title ?? course.title,
    mastered: progress.mastered,
    unresolved: progress.unresolved,
    currentTaskId,
    currentTaskTitle,
    courseStep,
    frictionState: engineState.state,
    nextBestAction: deriveNextBestAction(
      focusTask,
      engineState.state,
      tasks.length > 0 && tasks.every((task) => engineState.completedTaskIds.includes(task.id)),
    ),
    createdAt: now,
  };
}

export function deriveNextBestAction(
  task: MicroTask | null,
  state: StateEngineState['state'],
  allTasksCompleted = false,
): LocalizedMessage {
  if (allTasksCompleted) {
    return message('action.session.finish');
  }
  if (task === null) {
    return message(state === 'READY' ? 'action.start.first' : 'action.start.next');
  }
  const params = { title: task.title };
  switch (task.kind) {
    case 'quiz':
      return message('action.quiz.answer', params);
    case 'practice':
      return message('action.practice.example', params);
    case 'read':
    default:
      return message('action.read.summarise', params);
  }
}
