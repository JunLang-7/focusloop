import {
  AGENT_CONTEXT_LIMITS,
  findSectionForConcept,
  type AgentContext,
  type AgentContextOmission,
  type AgentContextReport,
  type Concept,
  type Course,
  type LearningCheckpoint,
  type LearningEvent,
  type LearningSession,
  type LearningState,
  type MaterialDocument,
  type MaterialExcerpt,
  type MicroTask,
  type SessionProgress,
} from '@focusloop/shared-types';

/**
 * Everything the builder may read, gathered by its caller.
 *
 * It is a parameter rather than a lookup so the builder can be tested without a session, a database
 * or Electron — and so that the list of things the agent may see is a list somebody wrote down,
 * rather than whatever the nearest object happened to expose.
 */
export interface AgentContextSource {
  readonly session: LearningSession | null;
  readonly progress: SessionProgress | null;
  readonly course: Course | null;
  /** How many courses exist, so the exclusion of the others can be stated rather than implied. */
  readonly courseCount: number;
  readonly material: MaterialDocument | null;
  /** The full event log, oldest first. The builder decides how much of it is used. */
  readonly events: readonly LearningEvent[];
  readonly checkpoint: LearningCheckpoint | null;
  readonly learningState: LearningState;
}

/**
 * Builds what the agent sees, and the account of what it does not.
 *
 * Returns `null` for the context when no session is running: with nothing in progress there is no
 * current moment for the agent to be about, and inventing one would be the beginning of a model
 * making things up. The omission says so, so a caller can tell "nothing to say" from "not built".
 */
export function buildAgentContext(source: AgentContextSource): AgentContextReport {
  const { session } = source;
  if (session === null) {
    return {
      context: null,
      omissions: [
        { field: 'session', detail: 'no session is running, so there is no current moment' },
      ],
    };
  }

  const omissions: AgentContextOmission[] = [];
  const tasks = source.course?.microTasks ?? [];
  const task = findCurrentTask(session, tasks);
  const concept = task === null ? null : findConcept(task, source.course);
  const material = excerptMaterial(source.material, concept, omissions);

  const recentEvents = takeRecentEvents(source.events, omissions);
  if (source.courseCount > 1) {
    omissions.push({
      field: 'courses',
      detail: notIncluded(source.courseCount - 1, 'other', 'course'),
    });
  }

  const context: AgentContext = {
    session: {
      sessionId: session.id,
      startedAt: session.startedAt,
      elapsedMs: source.progress?.elapsedMs ?? 0,
      completedTasks: source.progress?.completedTasks ?? session.completedTaskIds.length,
      totalTasks: source.progress?.totalTasks ?? tasks.length,
    },
    concept: {
      conceptId: concept?.id ?? null,
      title: concept?.title ?? null,
      summary: concept?.summary ?? null,
      keyPoints: concept?.keyPoints ?? [],
    },
    task: {
      taskId: task?.id ?? null,
      title: task?.title ?? null,
      instructions: task?.instructions ?? null,
      kind: task?.kind ?? null,
      estimatedMinutes: task?.estimatedMinutes ?? null,
      step: task === null ? 0 : tasks.findIndex((candidate) => candidate.id === task.id) + 1,
      totalSteps: tasks.length,
    },
    material,
    learningState: source.learningState,
    recentEvents,
    checkpoint: source.checkpoint,
  };

  return { context, omissions };
}

/**
 * The task the learner is on.
 *
 * The session's current task first; failing that the one it was on when the friction started, which
 * is what makes the context still usable after an interruption. Never "the next uncompleted task":
 * guessing where somebody is, in the file that decides what a model is told about them, is how an
 * agent ends up confidently helping with the wrong thing.
 */
function findCurrentTask(session: LearningSession, tasks: readonly MicroTask[]): MicroTask | null {
  const id = session.currentTaskId ?? session.lastActiveTaskId;
  if (id === undefined) return null;
  return tasks.find((task) => task.id === id) ?? null;
}

function findConcept(task: MicroTask, course: Course | null): Concept | null {
  if (course === null) return null;
  return course.concepts.find((concept) => concept.id === task.conceptId) ?? null;
}

/**
 * The one section of the material the agent gets, bounded.
 *
 * One section, not the document: the material is whatever the learner happened to import, so its
 * length is theirs and not ours. The text is a prefix of the section rather than a summary, because
 * a summary would be something the agent invented before it had a chance to be useful.
 */
function excerptMaterial(
  material: MaterialDocument | null,
  concept: Concept | null,
  omissions: AgentContextOmission[],
): MaterialExcerpt {
  if (material === null) {
    omissions.push({
      field: 'material',
      detail: 'no material is attached to this course, so there is nothing to ground an answer in',
    });
    return { materialId: null, title: null, heading: null, text: '', truncated: false };
  }

  const sections = material.sections;
  const section = findSectionForConcept(material, concept?.title ?? null);

  if (section === null) {
    omissions.push({
      field: 'material',
      detail:
        concept === null
          ? 'no concept is current, so no section was chosen'
          : `no section matches "${concept.title}", so no text is included`,
    });
    return {
      materialId: material.id,
      title: material.title,
      heading: null,
      text: '',
      truncated: false,
    };
  }

  const text = section.body.slice(0, AGENT_CONTEXT_LIMITS.materialCharacters);
  const truncated = text.length < section.body.length;

  if (truncated) {
    omissions.push({
      field: 'material',
      detail: `${String(section.body.length - text.length)} of ${String(section.body.length)} characters of this section are not included`,
    });
  }

  const otherSections = sections.length - 1;
  if (otherSections > 0) {
    omissions.push({
      field: 'material',
      detail: notIncluded(otherSections, 'other', 'section', ' of the material'),
    });
  }

  return {
    materialId: material.id,
    title: material.title,
    heading: section.heading,
    text,
    truncated,
  };
}

function takeRecentEvents(
  events: readonly LearningEvent[],
  omissions: AgentContextOmission[],
): readonly LearningEvent[] {
  if (events.length <= AGENT_CONTEXT_LIMITS.events) return [...events];

  const kept = events.slice(-AGENT_CONTEXT_LIMITS.events);
  omissions.push({
    field: 'events',
    detail: notIncluded(events.length - kept.length, 'earlier', 'event'),
  });
  return kept;
}

/**
 * "1 other courses are not included" is not English, and these strings are read by people in the
 * developer inspector. A count of one is not hypothetical either: it is what the panel shows the
 * moment a second course exists, which is the ordinary case, not the edge one.
 */
function notIncluded(count: number, adjective: string, noun: string, of = ''): string {
  const plural = count === 1 ? '' : 's';
  const verb = count === 1 ? 'is' : 'are';
  return `${String(count)} ${adjective} ${noun}${plural}${of} ${verb} not included`;
}
