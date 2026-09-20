import { describe, expect, it } from 'vitest';
import {
  AGENT_CONTEXT_LIMITS,
  type Course,
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
    expect(kept.at(-1)?.id).toBe('e19');
    expect(kept[0]?.id).toBe('e8');
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
});
