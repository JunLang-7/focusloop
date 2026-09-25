import { describe, expect, it } from 'vitest';
import {
  AGENT_CONTEXT_LIMITS,
  type Course,
  type LearningCheckpoint,
  type LearningEvent,
  type LearningSession,
  type MaterialDocument,
} from '@focusloop/shared-types';
import { buildAgentContext, type AgentContextSource } from './agent-context';

function course(): Course {
  return {
    id: 'c1',
    title: 'Data structures',
    description: '',
    concepts: [
      {
        id: 'k1',
        title: 'Rotations',
        summary: 'A rotation restructures three nodes.',
        order: 0,
        keyPoints: ['the in-order sequence is preserved'],
      },
      { id: 'k2', title: 'Insertion', summary: 'Insertion walks down.', order: 1, keyPoints: [] },
    ],
    microTasks: [
      {
        id: 't1',
        courseId: 'c1',
        conceptId: 'k1',
        title: 'Read rotations',
        instructions: 'Read the section',
        kind: 'read',
        estimatedMinutes: 3,
        order: 0,
      },
      {
        id: 't2',
        courseId: 'c1',
        conceptId: 'k2',
        title: 'Try an insert',
        instructions: 'Do one by hand',
        kind: 'practice',
        estimatedMinutes: 5,
        order: 1,
      },
    ],
    quizzes: [],
  };
}

function session(overrides: Partial<LearningSession> = {}): LearningSession {
  return {
    id: 's1',
    courseId: 'c1',
    startedAt: '2026-09-20T00:00:00.000Z',
    state: 'FOCUSED',
    completedTaskIds: [],
    updatedAt: '2026-09-20T00:00:00.000Z',
    ...overrides,
  };
}

function material(): MaterialDocument {
  return {
    id: 'm1',
    title: 'Notes',
    format: 'markdown',
    source: 'imported',
    contentHash: 'abc',
    importedAt: '2026-09-20T00:00:00.000Z',
    warnings: [],
    sections: [
      { id: 'sec1', heading: 'Introduction', body: 'INTRODUCTION-BODY', order: 0, depth: 1 },
      { id: 'sec2', heading: 'Rotations', body: 'ROTATION-BODY', order: 1, depth: 2 },
      { id: 'sec3', heading: 'Deletion', body: 'DELETION-BODY', order: 2, depth: 2 },
    ],
  };
}

function events(count: number): LearningEvent[] {
  return Array.from({ length: count }, (_unused, index) => ({
    id: `e${String(index)}`,
    sessionId: 's1',
    at: `2026-09-20T00:00:${String(index).padStart(2, '0')}.000Z`,
    type: 'TASK_STARTED',
    source: 'user',
    payload: { taskId: 't1' },
  }));
}

function source(overrides: Partial<AgentContextSource> = {}): AgentContextSource {
  return {
    session: session({ currentTaskId: 't1' }),
    progress: {
      sessionId: 's1',
      totalTasks: 2,
      completedTasks: 0,
      completionRatio: 0,
      elapsedMs: 60_000,
    },
    course: course(),
    courseCount: 1,
    material: material(),
    events: [],
    checkpoint: null,
    learningState: 'FOCUSED',
    ...overrides,
  };
}

describe('buildAgentContext', () => {
  it('has nothing to be about when no session is running', () => {
    const report = buildAgentContext(source({ session: null }));

    expect(report.context).toBeNull();
    // The omission is what lets a caller tell "nothing to say" from "the builder broke".
    expect(report.omissions).toEqual([
      { field: 'session', detail: 'no session is running, so there is no current moment' },
    ]);
  });

  it('carries the current task, its concept and its position', () => {
    const report = buildAgentContext(source());

    expect(report.context?.task).toEqual({
      taskId: 't1',
      title: 'Read rotations',
      instructions: 'Read the section',
      kind: 'read',
      estimatedMinutes: 3,
      step: 1,
      totalSteps: 2,
    });
    expect(report.context?.concept.title).toBe('Rotations');
    expect(report.context?.concept.keyPoints).toEqual(['the in-order sequence is preserved']);
  });

  it('keeps the position after an interruption, instead of guessing the next one', () => {
    const interrupted = session({ lastActiveTaskId: 't2', state: 'INTERRUPTED' });
    const report = buildAgentContext(
      source({ session: interrupted, learningState: 'INTERRUPTED' }),
    );

    expect(report.context?.task.taskId).toBe('t2');
    expect(report.context?.task.step).toBe(2);
    expect(report.context?.learningState).toBe('INTERRUPTED');
  });

  it('reports no task rather than picking an uncompleted one', () => {
    const report = buildAgentContext(source({ session: session() }));

    expect(report.context?.task.taskId).toBeNull();
    expect(report.context?.task.title).toBeNull();
    // The count is still known, so a caller can say "step 0 of 2" without inventing a task.
    expect(report.context?.task.step).toBe(0);
    expect(report.context?.task.totalSteps).toBe(2);
  });

  it('excerpts the section the current concept is about', () => {
    const report = buildAgentContext(source());

    expect(report.context?.material.heading).toBe('Rotations');
    expect(report.context?.material.text).toBe('ROTATION-BODY');
    expect(report.context?.material.truncated).toBe(false);
  });

  it('accounts for the sections it left behind', () => {
    /*
     * This replaces an assertion that could not fail.
     *
     * The old one was `expect(text).not.toContain('INTRODUCTION-BODY')` — but `text` is
     * `section.body.slice(...)` of one chosen section, so it was structurally impossible for it to
     * contain another section's body. It read as a boundary guard and proved nothing.
     *
     * The account is the part that can actually be wrong, and it had no test at this granularity.
     * "Which section was chosen" is covered by the excerpt test above, which fails if the rule falls
     * back to the first section: Rotations is not the first section in the fixture.
     */
    const report = buildAgentContext(source());

    expect(report.omissions).toContainEqual({
      field: 'material',
      detail: '2 other sections of the material are not included',
    });
  });

  it('hands over no text at all rather than a section about something else', () => {
    const document: MaterialDocument = {
      ...material(),
      sections: [
        { id: 'sec1', heading: 'Binary search', body: 'BINARY-SEARCH-BODY', order: 0, depth: 1 },
      ],
    };

    const report = buildAgentContext(source({ material: document }));

    // A near miss is not a link. Grounding an answer in the wrong section is worse than grounding it
    // in nothing, because the answer comes back confident.
    expect(report.context?.material.text).toBe('');
    expect(report.context?.material.heading).toBeNull();
    expect(report.omissions).toContainEqual({
      field: 'material',
      detail: 'no section matches "Rotations", so no text is included',
    });
  });

  it('bounds the material and says how much was left out', () => {
    const long = 'x'.repeat(AGENT_CONTEXT_LIMITS.materialCharacters + 500);
    const document: MaterialDocument = {
      ...material(),
      sections: [{ id: 'sec1', heading: 'Rotations', body: long, order: 0, depth: 1 }],
    };

    const report = buildAgentContext(source({ material: document }));

    // The literal, not the constant. Using the constant on both sides made this green for any value
    // of it — including one large enough to stop being a bound at all.
    expect(report.context?.material.text).toHaveLength(1200);
    expect(report.context?.material.truncated).toBe(true);
    expect(report.omissions).toContainEqual({
      field: 'material',
      detail: '500 of 1700 characters of this section are not included',
    });
  });

  it('keeps the most recent events and says how many it dropped', () => {
    const report = buildAgentContext(source({ events: events(20) }));
    const kept = report.context?.recentEvents ?? [];

    // The literal, for the same reason as the material bound above.
    expect(kept).toHaveLength(12);
    // Newest last, so "what just happened" is at the end where it is read.
    expect(kept.at(-1)?.at).toBe('2026-09-20T00:00:19.000Z');
    expect(kept[0]?.at).toBe('2026-09-20T00:00:08.000Z');
    expect(report.omissions).toContainEqual({
      field: 'events',
      detail: '8 earlier events are not included',
    });
  });

  it('says nothing about a window it did not cut', () => {
    const report = buildAgentContext(source({ events: events(3) }));

    expect(report.context?.recentEvents).toHaveLength(3);
    expect(report.omissions.map((omission) => omission.field)).not.toContain('events');
  });

  it('states that the other courses are not included', () => {
    const report = buildAgentContext(source({ courseCount: 4 }));

    expect(report.omissions).toContainEqual({
      field: 'courses',
      detail: '3 other courses are not included',
    });
  });

  it('says it in English when there is exactly one of them', () => {
    // Not the edge case: a second course existing is the ordinary state, and "1 other courses" was
    // what the panel printed for it.
    const report = buildAgentContext(source({ courseCount: 2 }));

    expect(report.omissions).toContainEqual({
      field: 'courses',
      detail: '1 other course is not included',
    });
  });

  it('says the material is absent rather than pretending there is none', () => {
    const report = buildAgentContext(source({ material: null }));

    expect(report.context?.material).toEqual({
      materialId: null,
      title: null,
      heading: null,
      text: '',
      truncated: false,
    });
    expect(report.omissions).toContainEqual({
      field: 'material',
      detail: 'no material is attached to this course, so there is nothing to ground an answer in',
    });
  });

  it('projects and bounds the checkpoint instead of exposing its persistence record', () => {
    const long = 'x'.repeat(AGENT_CONTEXT_LIMITS.checkpointTextCharacters + 80);
    const checkpoint: LearningCheckpoint = {
      id: 'CHECKPOINT_ID_SECRET',
      sessionId: 'CHECKPOINT_SESSION_SECRET',
      conceptId: 'CHECKPOINT_CONCEPT_ID_SECRET',
      conceptTitle: long,
      goal: long,
      mastered: Array.from({ length: 8 }, (_unused, index) => `mastered-${String(index)}-${long}`),
      unresolved: Array.from(
        { length: 8 },
        (_unused, index) => `unresolved-${String(index)}-${long}`,
      ),
      currentTaskId: 'CHECKPOINT_TASK_ID_SECRET',
      currentTaskTitle: long,
      currentStep: 2,
      frictionState: 'CONFUSED',
      nextBestAction: {
        key: 'action.read.summarise',
        params: {
          title: long,
          second: long,
          third: long,
          fourth: long,
          fifth: long,
        },
      },
      createdAt: '2026-09-20T00:00:00.000Z',
    };

    const report = buildAgentContext(source({ checkpoint }));
    const projected = report.context?.checkpoint;
    const serialized = JSON.stringify(projected);

    expect(projected?.conceptTitle).toHaveLength(AGENT_CONTEXT_LIMITS.checkpointTextCharacters);
    expect(projected?.mastered).toHaveLength(AGENT_CONTEXT_LIMITS.checkpointItems);
    expect(projected?.mastered.every((item) => item.length <= 320)).toBe(true);
    expect(projected?.unresolved).toHaveLength(AGENT_CONTEXT_LIMITS.checkpointItems);
    expect(Object.keys(projected?.nextBestAction.params ?? {})).toHaveLength(
      AGENT_CONTEXT_LIMITS.checkpointParams,
    );
    expect(serialized).not.toContain('CHECKPOINT_ID_SECRET');
    expect(serialized).not.toContain('CHECKPOINT_SESSION_SECRET');
    expect(serialized).not.toContain('CHECKPOINT_CONCEPT_ID_SECRET');
    expect(serialized).not.toContain('CHECKPOINT_TASK_ID_SECRET');
    expect(report.omissions).toContainEqual({
      field: 'checkpoint',
      detail: 'checkpoint text, list items or message parameters were reduced to context limits',
    });
  });

  it('rejects an invalid checkpoint instead of projecting half of it', () => {
    const checkpoint = {
      id: 'cp-invalid',
      sessionId: 's1',
      conceptId: 'k1',
      conceptTitle: 'Rotations',
      goal: 'Understand rotations',
      mastered: [],
      unresolved: ['Rotations'],
      currentTaskId: 't1',
      currentTaskTitle: 'Read rotations',
      currentStep: 1,
      frictionState: 'NOT_A_STATE',
      nextBestAction: { key: 'action.read.summarise', params: {} },
      createdAt: '2026-09-20T00:00:00.000Z',
    } as unknown as LearningCheckpoint;

    const report = buildAgentContext(source({ checkpoint }));

    expect(report.context?.checkpoint).toBeNull();
    expect(report.omissions).toContainEqual({
      field: 'checkpoint',
      detail: 'the checkpoint was invalid and is not included',
    });
  });

  it('drops malformed nextBestAction params rather than forwarding them', () => {
    const checkpoint: LearningCheckpoint = {
      id: 'cp-params',
      sessionId: 's1',
      conceptId: 'k1',
      conceptTitle: 'Rotations',
      goal: 'Understand rotations',
      mastered: [],
      unresolved: [],
      currentTaskId: 't1',
      currentTaskTitle: 'Read rotations',
      currentStep: 1,
      frictionState: 'FOCUSED',
      nextBestAction: {
        key: 'action.read.summarise',
        params: { 'bad key!': 'nope', good: 42 as unknown as string },
      },
      createdAt: '2026-09-20T00:00:00.000Z',
    };

    const report = buildAgentContext(source({ checkpoint }));

    expect(report.context?.checkpoint?.nextBestAction.params).toEqual({});
    expect(report.omissions).toContainEqual({
      field: 'checkpoint',
      detail: 'checkpoint text, list items or message parameters were reduced to context limits',
    });
  });

  it('projects the event allowlist and strips persistence and sensitive payload fields', () => {
    const rawEvents = [
      rawEvent('SESSION_STARTED', { courseId: 'course-secret', sessionId: 'session-secret' }),
      rawEvent('TASK_STARTED', { taskId: 't1', url: 'https://secret.test', token: 'secret' }),
      rawEvent('TASK_COMPLETED', { taskId: 't1', pageTitle: 'Private page' }),
      rawEvent('HELP_REQUESTED', {
        taskId: 't1',
        reason: 'too-big',
        path: '/private',
        query: '?secret=1',
      }),
      rawEvent('QUIZ_CORRECT', { taskId: 't1', quizId: 'q1', apiKey: 'secret' }),
      rawEvent('QUIZ_INCORRECT', { taskId: 't1', quizId: 'q1', cookie: 'secret' }),
      rawEvent('TAB_LEFT', {
        origin: 'https://secret.test',
        url: 'https://secret.test/private',
        path: '/private',
        query: '?secret=1',
        token: 'secret',
        apiKey: 'secret',
        cookie: 'secret',
        formValue: 'secret',
        clipboard: 'secret',
        pageTitle: 'Private page',
      }),
      rawEvent('TAB_RETURNED', { awayMs: 30_000, clipboard: 'secret' }),
      rawEvent('IDLE_STARTED', { taskId: 't1', formValue: 'secret' }),
      rawEvent('IDLE_ENDED', { idleMs: 45_000, pageTitle: 'Private page' }),
      rawEvent('RESUME_REQUESTED', { checkpointId: 'cp1', url: 'https://secret.test' }),
      rawEvent('RESUME_DISMISSED', { checkpointId: 'cp1', query: '?secret=1' }),
      rawEvent('SESSION_ENDED', { reason: 'user', apiKey: 'secret' }),
    ];
    const report = buildAgentContext(source({ events: rawEvents }));

    expect(report.context?.recentEvents).toEqual([
      { type: 'TASK_STARTED', at: rawEvents[1]?.at, source: 'user', payload: { taskId: 't1' } },
      { type: 'TASK_COMPLETED', at: rawEvents[2]?.at, source: 'user', payload: { taskId: 't1' } },
      {
        type: 'HELP_REQUESTED',
        at: rawEvents[3]?.at,
        source: 'user',
        payload: { taskId: 't1', reason: 'too-big' },
      },
      {
        type: 'QUIZ_CORRECT',
        at: rawEvents[4]?.at,
        source: 'user',
        payload: { taskId: 't1', quizId: 'q1' },
      },
      {
        type: 'QUIZ_INCORRECT',
        at: rawEvents[5]?.at,
        source: 'user',
        payload: { taskId: 't1', quizId: 'q1' },
      },
      { type: 'TAB_LEFT', at: rawEvents[6]?.at, source: 'user', payload: {} },
      { type: 'TAB_RETURNED', at: rawEvents[7]?.at, source: 'user', payload: { awayMs: 30_000 } },
      { type: 'IDLE_STARTED', at: rawEvents[8]?.at, source: 'user', payload: { taskId: 't1' } },
      { type: 'IDLE_ENDED', at: rawEvents[9]?.at, source: 'user', payload: { idleMs: 45_000 } },
      {
        type: 'RESUME_REQUESTED',
        at: rawEvents[10]?.at,
        source: 'user',
        payload: {},
      },
      {
        type: 'RESUME_DISMISSED',
        at: rawEvents[11]?.at,
        source: 'user',
        payload: {},
      },
      { type: 'SESSION_ENDED', at: rawEvents[12]?.at, source: 'user', payload: { reason: 'user' } },
    ]);
    expect(report.context?.recentEvents).not.toContainEqual(
      expect.objectContaining({ type: 'SESSION_STARTED' }),
    );
    expect(report.omissions).toContainEqual({
      field: 'events',
      detail: '1 earlier event is not included',
    });
  });

  it('has an explicit projection for every learning event type', () => {
    const cases: readonly {
      type: string;
      input: Record<string, unknown>;
      output: Record<string, unknown>;
    }[] = [
      { type: 'SESSION_STARTED', input: { courseId: 'c1', sessionId: 's1' }, output: {} },
      { type: 'TASK_STARTED', input: { taskId: 't1' }, output: { taskId: 't1' } },
      { type: 'TASK_COMPLETED', input: { taskId: 't1' }, output: { taskId: 't1' } },
      {
        type: 'HELP_REQUESTED',
        input: { taskId: 't1', reason: 'too-big' },
        output: { taskId: 't1', reason: 'too-big' },
      },
      {
        type: 'QUIZ_CORRECT',
        input: { taskId: 't1', quizId: 'q1' },
        output: { taskId: 't1', quizId: 'q1' },
      },
      {
        type: 'QUIZ_INCORRECT',
        input: { taskId: 't1', quizId: 'q1' },
        output: { taskId: 't1', quizId: 'q1' },
      },
      { type: 'TAB_LEFT', input: { origin: 'https://private.test' }, output: {} },
      { type: 'TAB_RETURNED', input: { awayMs: 30_000 }, output: { awayMs: 30_000 } },
      { type: 'IDLE_STARTED', input: {}, output: {} },
      { type: 'IDLE_ENDED', input: { idleMs: 45_000 }, output: { idleMs: 45_000 } },
      {
        type: 'RESUME_REQUESTED',
        input: { checkpointId: 'cp1' },
        output: {},
      },
      {
        type: 'RESUME_DISMISSED',
        input: { checkpointId: 'cp1' },
        output: {},
      },
      { type: 'SESSION_ENDED', input: { reason: 'user' }, output: { reason: 'user' } },
    ];

    for (const eventCase of cases) {
      const report = buildAgentContext(
        source({ events: [rawEvent(eventCase.type, eventCase.input)] }),
      );
      expect(report.context?.recentEvents, eventCase.type).toEqual([
        {
          type: eventCase.type,
          at: '2026-09-20T00:00:00.000Z',
          source: 'user',
          payload: eventCase.output,
        },
      ]);
    }
  });

  it('drops malformed and unknown events without mutating the event log', () => {
    const rawEvents = [
      rawEvent('TASK_STARTED', { taskId: 't1', clipboard: 'secret' }),
      rawEvent('UNKNOWN_EVENT', { taskId: 't1' }),
      rawEvent('TAB_RETURNED', { awayMs: Number.NaN }),
      rawEvent('TAB_RETURNED', { awayMs: -1 }),
      rawEvent('IDLE_ENDED', { idleMs: Number.POSITIVE_INFINITY }),
      rawEvent('IDLE_ENDED', { idleMs: -1 }),
      rawEvent('TASK_COMPLETED', { taskId: 42 }),
      rawEvent('TASK_COMPLETED', {
        taskId: 'x'.repeat(AGENT_CONTEXT_LIMITS.eventStringCharacters + 1),
      }),
      rawEvent('SESSION_ENDED', { reason: 'not-a-reason' }),
      {
        ...rawEvent('TASK_STARTED', { taskId: 't-invalid-time' }),
        at: 'not-a-timestamp',
      } as unknown as LearningEvent,
      rawEvent('TASK_STARTED', { taskId: 't2' }),
    ];
    const before = structuredClone(rawEvents);
    const report = buildAgentContext(source({ events: rawEvents }));

    expect(report.context?.recentEvents).toEqual([
      {
        type: 'TASK_STARTED',
        at: rawEvents[0]?.at,
        source: 'user',
        payload: { taskId: 't1' },
      },
      {
        type: 'TASK_STARTED',
        at: rawEvents[10]?.at,
        source: 'user',
        payload: { taskId: 't2' },
      },
    ]);
    expect(report.omissions).toContainEqual({
      field: 'events',
      detail: '9 invalid events are not included',
    });
    expect(rawEvents).toEqual(before);
  });
});

function rawEvent(type: string, payload: Record<string, unknown>): LearningEvent {
  return {
    id: `event-${type}-${String(Object.keys(payload).length)}`,
    sessionId: 's1',
    at: '2026-09-20T00:00:00.000Z',
    type,
    source: 'user',
    payload,
  } as unknown as LearningEvent;
}

describe('AGENT_PROPOSAL_EXECUTED projection', () => {
  it('passes the audit event through with an empty payload', () => {
    const report = buildAgentContext(
      source({
        events: [
          {
            id: 'e-proposal',
            sessionId: 's1',
            at: '2026-01-01T00:00:01.000Z',
            type: 'AGENT_PROPOSAL_EXECUTED',
            source: 'agent',
            payload: { proposalId: 'p1', kind: 'structural-write', idempotencyKey: 'k' },
          } as never,
        ],
      }),
    );
    expect(report.context?.recentEvents).toEqual([
      {
        type: 'AGENT_PROPOSAL_EXECUTED',
        at: '2026-01-01T00:00:01.000Z',
        source: 'agent',
        payload: {},
      },
    ]);
  });
});
