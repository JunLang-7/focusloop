import { buildAgentContext, type AgentContextSource } from '@focusloop/agent-core';
import type {
  Concept,
  Course,
  LearningSession,
  MaterialDocument,
  MicroTask,
  MicroTaskKind,
} from '@focusloop/shared-types';
import type { JsonObject, JsonValue } from './scenario';

/**
 * The JSON a fixture describes as the *context* the agent would be given, built through the real
 * `buildAgentContext` (AG1) rather than assembled by hand.
 *
 * Doing it this way is the point: a fixture that hand-wrote an `AgentContext` could pin the rescue's
 * behaviour against a context the production builder never produces. Here the `Course`, the material
 * and the session go in, and whatever the projection keeps is what the rescue sees — including the
 * fields it drops.
 */
const FIXTURE_COURSE_ID = 'course-ag2';
const FIXTURE_SESSION_ID = 'session-ag2';
const FIXTURE_TASK_ID = 'task-ag2';
const FIXTURE_CONCEPT_ID = 'concept-ag2';
const T0 = '2026-01-01T00:00:00.000Z';
const DEFAULT_SUMMARY = 'A rotation restructures three nodes.';

function isRecord(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: JsonValue | undefined, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function kind(value: JsonValue | undefined): MicroTaskKind {
  if (value === undefined) return 'read';
  if (value === 'read' || value === 'practice' || value === 'quiz') return value;
  throw new Error('AG2 fixture task.kind must be read, practice or quiz');
}

function minutes(value: JsonValue | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value))
    throw new Error('AG2 fixture task.estimatedMinutes must be a finite number');
  return value;
}

export function fixtureCourse(input: JsonObject): Course {
  const conceptInput = isRecord(input['concept']) ? input['concept'] : {};
  const taskInput = isRecord(input['task']) ? input['task'] : {};
  const keyPointsInput = conceptInput['keyPoints'];
  const keyPoints =
    keyPointsInput === undefined
      ? ['in-order traversal is sorted', 'a rotation keeps the order']
      : Array.isArray(keyPointsInput)
        ? keyPointsInput.map((point) => text(point, ''))
        : (() => {
            throw new Error('AG2 fixture concept.keyPoints must be a list');
          })();
  const concept: Concept = {
    id: text(conceptInput['id'], FIXTURE_CONCEPT_ID),
    title: text(conceptInput['title'], 'Rotations'),
    // Present-but-empty is a case of its own (the hint falls back), so absence and emptiness have to
    // stay distinguishable here rather than both defaulting.
    summary: Object.hasOwn(conceptInput, 'summary')
      ? text(conceptInput['summary'], '')
      : DEFAULT_SUMMARY,
    order: 0,
    keyPoints,
  };
  const task: MicroTask = {
    id: FIXTURE_TASK_ID,
    courseId: FIXTURE_COURSE_ID,
    conceptId: concept.id,
    title: text(taskInput['title'], 'Read rotations'),
    instructions: text(taskInput['instructions'], 'Read the whole section and take notes.'),
    kind: kind(taskInput['kind']),
    estimatedMinutes: minutes(taskInput['estimatedMinutes'], 7),
    order: 0,
  };
  return {
    id: FIXTURE_COURSE_ID,
    title: 'AG2 fixtures',
    description: '',
    concepts: [concept],
    microTasks: [task],
    quizzes: [],
  };
}

/** The material, or nothing when the fixture gives no `materialText`. */
export function fixtureMaterial(input: JsonObject, course: Course): MaterialDocument | null {
  const body = input['materialText'];
  if (typeof body !== 'string') return null;
  const conceptTitle = course.concepts[0]?.title ?? 'Rotations';
  return {
    id: 'material-ag2',
    title: 'Notes',
    format: 'text',
    source: 'imported',
    // The excerpt picks the section whose heading matches the concept, so the fixture has to give it
    // that heading or the text never reaches the agent.
    sections: [{ id: 'section-ag2', heading: conceptTitle, body, order: 0, depth: 1 }],
    contentHash: 'fixture',
    importedAt: T0,
    warnings: [],
  };
}

export function fixtureSession(input: JsonObject, course: Course): LearningSession {
  return {
    id: FIXTURE_SESSION_ID,
    courseId: course.id,
    startedAt: T0,
    state: 'FOCUSED',
    currentTaskId: FIXTURE_TASK_ID,
    completedTaskIds: [],
    updatedAt: T0,
  };
}

/**
 * The agent's context for a fixture, or `null` when the fixture says there is no session — which is
 * the no-session case the rescue and the rewrite both have to survive.
 */
export function fixtureContext(input: JsonObject): ReturnType<typeof buildAgentContext>['context'] {
  if (input['hasSession'] === false) return null;
  const course = fixtureCourse(input);
  const source: AgentContextSource = {
    session: fixtureSession(input, course),
    progress: null,
    course,
    courseCount: 1,
    material: fixtureMaterial(input, course),
    events: [],
    checkpoint: null,
    learningState: 'CONFUSED',
  };
  return buildAgentContext(source).context;
}
