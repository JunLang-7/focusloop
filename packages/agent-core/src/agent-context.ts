import {
  AGENT_CONTEXT_LIMITS,
  DOMAIN_MESSAGE_KEYS,
  findSectionForConcept,
  isLearningState,
  type AgentContext,
  type AgentContextCheckpoint,
  type AgentContextEvent,
  type AgentContextOmission,
  type AgentContextReport,
  type Concept,
  type Course,
  type LearningCheckpoint,
  type LearningEvent,
  type LearningEventSource,
  type LearningSession,
  type LearningState,
  type MaterialDocument,
  type MaterialExcerpt,
  type MicroTask,
  type SessionProgress,
  type SessionEndReason,
  type StuckReason,
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
    checkpoint: projectCheckpoint(source.checkpoint, omissions),
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

function projectCheckpoint(
  checkpoint: LearningCheckpoint | null,
  omissions: AgentContextOmission[],
): AgentContextCheckpoint | null {
  if (checkpoint === null) return null;
  if (!isRecord(checkpoint)) return rejectCheckpoint(omissions);

  let reduced = false;
  const boundedText = (value: unknown): string | null => {
    if (typeof value !== 'string') return null;
    if (value.length <= AGENT_CONTEXT_LIMITS.checkpointTextCharacters) return value;
    reduced = true;
    return value.slice(0, AGENT_CONTEXT_LIMITS.checkpointTextCharacters);
  };
  const boundedList = (value: unknown): readonly string[] | null => {
    if (!Array.isArray(value)) return null;
    const strings = value.filter((item): item is string => typeof item === 'string');
    if (strings.length !== value.length || strings.length > AGENT_CONTEXT_LIMITS.checkpointItems) {
      reduced = true;
    }
    return strings
      .slice(0, AGENT_CONTEXT_LIMITS.checkpointItems)
      .map((item) => boundedText(item) ?? '');
  };

  const conceptTitle = boundedText(checkpoint['conceptTitle']);
  const goal = boundedText(checkpoint['goal']);
  const mastered = boundedList(checkpoint['mastered']);
  const unresolved = boundedList(checkpoint['unresolved']);
  const currentTaskTitle = boundedText(checkpoint['currentTaskTitle']);
  const currentStep = checkpoint['currentStep'];
  const frictionState = checkpoint['frictionState'];
  const createdAt = checkpoint['createdAt'];
  const action = checkpoint['nextBestAction'];

  if (
    conceptTitle === null ||
    goal === null ||
    mastered === null ||
    unresolved === null ||
    currentTaskTitle === null ||
    typeof currentStep !== 'number' ||
    !Number.isInteger(currentStep) ||
    currentStep < 0 ||
    !isLearningState(frictionState) ||
    !isIsoTimestamp(createdAt) ||
    !isRecord(action) ||
    !isDomainMessageKey(action['key']) ||
    !isRecord(action['params'])
  ) {
    return rejectCheckpoint(omissions);
  }

  const params: Record<string, string> = {};
  const entries = Object.entries(action['params']);
  if (entries.length > AGENT_CONTEXT_LIMITS.checkpointParams) reduced = true;
  for (const [key, value] of entries.slice(0, AGENT_CONTEXT_LIMITS.checkpointParams)) {
    if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(key) || typeof value !== 'string') {
      reduced = true;
      continue;
    }
    params[key] = boundedText(value) ?? '';
  }

  if (reduced) {
    omissions.push({
      field: 'checkpoint',
      detail: 'checkpoint text, list items or message parameters were reduced to context limits',
    });
  }

  return {
    conceptTitle,
    goal,
    mastered,
    unresolved,
    currentTaskTitle,
    currentStep,
    frictionState,
    nextBestAction: { key: action['key'], params },
    createdAt,
  };
}

function rejectCheckpoint(omissions: AgentContextOmission[]): null {
  omissions.push({ field: 'checkpoint', detail: 'the checkpoint was invalid and is not included' });
  return null;
}

function isDomainMessageKey(
  value: unknown,
): value is AgentContextCheckpoint['nextBestAction']['key'] {
  return typeof value === 'string' && (DOMAIN_MESSAGE_KEYS as readonly string[]).includes(value);
}

function takeRecentEvents(
  events: readonly LearningEvent[],
  omissions: AgentContextOmission[],
): readonly AgentContextEvent[] {
  const projected: AgentContextEvent[] = [];
  let rejected = 0;
  for (const event of events) {
    const safe = projectEvent(event);
    if (safe === null) rejected += 1;
    else projected.push(safe);
  }

  if (rejected > 0) {
    omissions.push({
      field: 'events',
      detail: `${String(rejected)} invalid ${rejected === 1 ? 'event is' : 'events are'} not included`,
    });
  }

  if (projected.length <= AGENT_CONTEXT_LIMITS.events) return projected;

  const kept = projected.slice(-AGENT_CONTEXT_LIMITS.events);
  omissions.push({
    field: 'events',
    detail: notIncluded(projected.length - kept.length, 'earlier', 'event'),
  });
  return kept;
}

/**
 * Project a persisted event into the agent's closed event contract.
 *
 * Event rows are read from SQLite as untrusted JSON and are typed at the persistence boundary for
 * convenience. This function is therefore intentionally defensive: it checks the discriminant,
 * common metadata and every value that is allowed through, then creates a fresh object containing
 * no caller-controlled keys beyond the allowlist.
 */
const invalidOptional = Symbol('invalid optional event field');

function projectEvent(event: unknown): AgentContextEvent | null {
  if (!isRecord(event)) return null;

  const type = event['type'];
  const at = event['at'];
  const source = event['source'];
  const payload = event['payload'];
  if (
    !isLearningEventType(type) ||
    !isIsoTimestamp(at) ||
    !isLearningEventSource(source) ||
    !isRecord(payload)
  ) {
    return null;
  }

  const common = { at, source } as const;
  switch (type) {
    case 'SESSION_STARTED':
      // SESSION_STARTED may contain course/session ids and TAB_LEFT may contain an origin. Neither
      // is part of the agent contract, so both are deliberately represented by an empty payload.
      return { ...common, type, payload: {} };
    case 'TAB_LEFT':
      return { ...common, type, payload: {} };
    case 'TASK_STARTED':
    case 'TASK_COMPLETED': {
      const taskId = stringField(payload, 'taskId');
      return taskId === null ? null : { ...common, type, payload: { taskId } };
    }
    case 'HELP_REQUESTED': {
      const taskId = optionalStringField(payload, 'taskId');
      const reason = optionalStuckReason(payload, 'reason');
      if (taskId === invalidOptional || reason === invalidOptional) return null;

      const safePayload: { taskId?: string; reason?: StuckReason } = {};
      if (taskId !== undefined) safePayload.taskId = taskId;
      if (reason !== undefined) safePayload.reason = reason;
      return { ...common, type, payload: safePayload } as AgentContextEvent;
    }
    case 'QUIZ_CORRECT':
    case 'QUIZ_INCORRECT': {
      const taskId = stringField(payload, 'taskId');
      const quizId = stringField(payload, 'quizId');
      return taskId === null || quizId === null
        ? null
        : { ...common, type, payload: { taskId, quizId } };
    }
    case 'TAB_RETURNED': {
      const awayMs = nonNegativeFiniteNumber(payload['awayMs']);
      return awayMs === null ? null : { ...common, type, payload: { awayMs } };
    }
    case 'IDLE_STARTED': {
      const taskId = optionalStringField(payload, 'taskId');
      return taskId === invalidOptional
        ? null
        : taskId === undefined
          ? { ...common, type, payload: {} }
          : { ...common, type, payload: { taskId } };
    }
    case 'IDLE_ENDED': {
      const idleMs = nonNegativeFiniteNumber(payload['idleMs']);
      return idleMs === null ? null : { ...common, type, payload: { idleMs } };
    }
    case 'RESUME_REQUESTED':
    case 'RESUME_DISMISSED':
      return { ...common, type, payload: {} };
    case 'SESSION_ENDED': {
      const reason = sessionEndReason(payload['reason']);
      return reason === null ? null : { ...common, type, payload: { reason } };
    }
    default:
      return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isLearningEventType(value: unknown): value is LearningEvent['type'] {
  return (
    value === 'SESSION_STARTED' ||
    value === 'TASK_STARTED' ||
    value === 'TASK_COMPLETED' ||
    value === 'HELP_REQUESTED' ||
    value === 'QUIZ_CORRECT' ||
    value === 'QUIZ_INCORRECT' ||
    value === 'TAB_LEFT' ||
    value === 'TAB_RETURNED' ||
    value === 'IDLE_STARTED' ||
    value === 'IDLE_ENDED' ||
    value === 'RESUME_REQUESTED' ||
    value === 'RESUME_DISMISSED' ||
    value === 'SESSION_ENDED'
  );
}

function isLearningEventSource(value: unknown): value is LearningEventSource {
  return (
    value === 'user' ||
    value === 'extension' ||
    value === 'simulator' ||
    value === 'system' ||
    value === 'agent'
  );
}

function stringField(payload: Record<string, unknown>, field: string): string | null {
  const value = payload[field];
  return isBoundedEventString(value) ? value : null;
}

function optionalStringField(
  payload: Record<string, unknown>,
  field: string,
): string | undefined | typeof invalidOptional {
  const value = payload[field];
  if (value === undefined) return undefined;
  return isBoundedEventString(value) ? value : invalidOptional;
}

function isBoundedEventString(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= AGENT_CONTEXT_LIMITS.eventStringCharacters
  );
}

function isIsoTimestamp(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= 32 &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

function optionalStuckReason(
  payload: Record<string, unknown>,
  field: string,
): StuckReason | undefined | typeof invalidOptional {
  const value = payload[field];
  if (value === undefined) return undefined;
  return isStuckReason(value) ? value : invalidOptional;
}

function isStuckReason(value: unknown): value is StuckReason {
  return (
    value === 'cannot-start' ||
    value === 'do-not-understand' ||
    value === 'too-big' ||
    value === 'went-wrong' ||
    value === 'cannot-recall' ||
    value === 'tired'
  );
}

function nonNegativeFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function sessionEndReason(value: unknown): SessionEndReason | null {
  return value === 'user' || value === 'completed' || value === 'timeout' || value === 'crashed'
    ? value
    : null;
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
