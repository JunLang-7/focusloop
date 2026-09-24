import { describe, expect, it } from 'vitest';
import { buildAgentContext, type AgentContextSource } from '@focusloop/agent-core';
import type {
  Course,
  LearningCheckpoint,
  LearningEvent,
  LearningSession,
  MaterialDocument,
} from '@focusloop/shared-types';
import currentScenario from './scenarios/ag1/current-context-happy.json';
import noSessionScenario from './scenarios/ag1/no-session-edge.json';
import boundsScenario from './scenarios/ag1/material-event-bounds-edge.json';
import crossCourseScenario from './scenarios/ag1/cross-course-isolation-adversarial.json';
import hostileScenario from './scenarios/ag1/hostile-event-payload-adversarial.json';
import sensitiveScenario from './scenarios/ag1/sensitive-content-adversarial.json';
import { allScenariosPassed, parseScenario, runScenarios, type JsonValue } from './index';

const scenarios = [
  currentScenario,
  noSessionScenario,
  boundsScenario,
  crossCourseScenario,
  hostileScenario,
  sensitiveScenario,
].map(parseScenario);

describe('AG1 deterministic privacy scenarios', () => {
  it('keeps every fixed scenario green', () => {
    const first = runScenarios(scenarios, executeAg1Fixture);
    const second = runScenarios(scenarios, executeAg1Fixture);

    expect(first).toEqual(second);
    expect(allScenariosPassed(first)).toBe(true);
  });
});

function executeAg1Fixture(input: JsonValue): JsonValue {
  if (!isRecord(input) || typeof input['case'] !== 'string') throw new Error('Invalid AG1 fixture');
  const fixtureCase = input['case'];
  const source = baseSource();

  switch (fixtureCase) {
    case 'current':
      break;
    case 'no-session':
      source.session = null;
      break;
    case 'bounds':
      source.material = material('x'.repeat(1700));
      source.events = Array.from({ length: 20 }, (_unused, index) =>
        event('TASK_STARTED', { taskId: 't1' }, index),
      );
      break;
    case 'cross-course':
      source.courseCount = 3;
      break;
    case 'hostile-event':
      source.events = [
        event('TASK_STARTED', { taskId: 't1', token: 'HOSTILE_PAYLOAD_SECRET' }, 0),
        event(
          'TAB_LEFT',
          { origin: 'HOSTILE_PAYLOAD_SECRET', nested: { token: 'HOSTILE_PAYLOAD_SECRET' } },
          1,
        ),
      ];
      break;
    case 'sensitive-content':
      source.checkpoint = checkpoint();
      source.events = [
        event(
          'TAB_LEFT',
          {
            origin: 'https://private.example',
            url: 'https://private.example/secret?token=1',
            apiKey: 'API_KEY_SENTINEL',
            cookie: 'COOKIE_SENTINEL',
            formValue: 'FORM_SENTINEL',
            clipboard: 'CLIPBOARD_SENTINEL',
            pageTitle: 'PAGE_TITLE_SENTINEL',
          },
          0,
        ),
      ];
      break;
    default:
      throw new Error(`Unknown AG1 fixture case: ${fixtureCase}`);
  }

  return JSON.parse(JSON.stringify(buildAgentContext(source))) as JsonValue;
}

function baseSource(): MutableSource {
  return {
    session: session(),
    progress: {
      sessionId: 's1',
      totalTasks: 1,
      completedTasks: 0,
      completionRatio: 0,
      elapsedMs: 60_000,
    },
    course: course(),
    courseCount: 1,
    material: material('ROTATION-BODY'),
    events: [],
    checkpoint: null,
    learningState: 'FOCUSED',
  };
}

type MutableSource = { -readonly [K in keyof AgentContextSource]: AgentContextSource[K] };

function session(): LearningSession {
  return {
    id: 's1',
    courseId: 'c1',
    startedAt: '2026-09-20T00:00:00.000Z',
    state: 'FOCUSED',
    currentTaskId: 't1',
    completedTaskIds: [],
    updatedAt: '2026-09-20T00:00:00.000Z',
  };
}

function course(): Course {
  return {
    id: 'c1',
    title: 'Data structures',
    description: '',
    concepts: [
      { id: 'k1', title: 'Rotations', summary: 'Current concept', order: 0, keyPoints: [] },
    ],
    microTasks: [
      {
        id: 't1',
        courseId: 'c1',
        conceptId: 'k1',
        title: 'Read rotations',
        instructions: 'Read the current section',
        kind: 'read',
        estimatedMinutes: 3,
        order: 0,
      },
    ],
    quizzes: [],
  };
}

function material(body: string): MaterialDocument {
  return {
    id: 'm1',
    title: 'Current notes',
    format: 'markdown',
    source: 'imported',
    contentHash: 'hash',
    importedAt: '2026-09-20T00:00:00.000Z',
    warnings: [],
    sections: [
      { id: 's-current', heading: 'Rotations', body, order: 0, depth: 1 },
      {
        id: 's-other',
        heading: 'Other course',
        body: 'OTHER_COURSE_SECRET',
        order: 1,
        depth: 1,
      },
    ],
  };
}

function checkpoint(): LearningCheckpoint {
  return {
    id: 'CHECKPOINT_ID_SENTINEL',
    sessionId: 'CHECKPOINT_SESSION_SENTINEL',
    conceptId: 'CHECKPOINT_CONCEPT_SENTINEL',
    conceptTitle: 'Rotations',
    goal: 'Understand the current rotation',
    mastered: [],
    unresolved: ['Rotations'],
    currentTaskId: 'CHECKPOINT_TASK_SENTINEL',
    currentTaskTitle: 'Read rotations',
    currentStep: 1,
    frictionState: 'CONFUSED',
    nextBestAction: { key: 'action.read.summarise', params: { title: 'Read rotations' } },
    createdAt: '2026-09-20T00:00:00.000Z',
  };
}

function event(type: string, payload: Record<string, unknown>, second: number): LearningEvent {
  return {
    id: `e${String(second)}`,
    sessionId: 's1',
    at: `2026-09-20T00:00:${String(second).padStart(2, '0')}.000Z`,
    type,
    source: 'user',
    payload,
  } as unknown as LearningEvent;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
