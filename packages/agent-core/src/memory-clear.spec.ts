import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createProviderSelection } from '@focusloop/llm-provider';
import type { AIProvider, CompletionResult } from '@focusloop/shared-types';
import { DEMO_COURSE_ID } from './demo-course';
import { createTestEngine, type TestEngine } from './test-helpers';

/**
 * ADR 0001 regression suite: write → clear → query is empty on the direct
 * path **and** on derived paths (dashboard aggregate, context builder,
 * tutor transcript).
 */
describe('agent memory clear (ADR 0001)', () => {
  let ctx: TestEngine;

  beforeEach(() => {
    ctx = createTestEngine();
  });

  afterEach(() => {
    ctx.close();
  });

  function capturingProvider(prompts: string[]): AIProvider {
    return {
      id: 'scripted',
      model: 'scripted-1',
      offline: false,
      complete: async (request): Promise<CompletionResult> => {
        prompts.push(request.prompt);
        return {
          text: '[hint]\nA real hint.',
          providerId: 'scripted',
          model: 'scripted-1',
          latencyMs: 1,
        };
      },
    };
  }

  it('Working: after clear the next tutor prompt cannot quote the old question', async () => {
    const prompts: string[] = [];
    const scripted = createTestEngine({
      providers: createProviderSelection(capturingProvider(prompts)),
    });
    try {
      const { session } = scripted.engine.startSession(DEMO_COURSE_ID);
      await scripted.engine.askTutor({
        sessionId: session.id,
        mode: 'HINT',
        question: 'FIRST_QUESTION_TOKEN',
      });
      expect(prompts[0]).toContain('FIRST_QUESTION_TOKEN');

      scripted.engine.clearAgentMemory(session.id);

      await scripted.engine.askTutor({
        sessionId: session.id,
        mode: 'HINT',
        question: 'SECOND_QUESTION_TOKEN',
      });
      const after = prompts[prompts.length - 1] ?? '';
      expect(after).toContain('SECOND_QUESTION_TOKEN');
      expect(after).not.toContain('FIRST_QUESTION_TOKEN');
    } finally {
      scripted.close();
    }
  });

  it('Episodic: write → clear → direct queries are empty', () => {
    const { engine, store } = ctx;
    const { session } = engine.startSession(DEMO_COURSE_ID);
    engine.dispatch({
      sessionId: session.id,
      type: 'TASK_STARTED',
      source: 'user',
      payload: { taskId: 'rbt-t1' },
    });
    engine.createCheckpoint(session.id);
    expect(store.listEvents(session.id).length).toBeGreaterThan(0);
    expect(store.listCheckpoints(session.id).length).toBeGreaterThan(0);

    expect(engine.clearAgentMemory(session.id)).not.toBeNull();

    expect(store.listEvents(session.id)).toEqual([]);
    expect(store.listCheckpoints(session.id)).toEqual([]);
    expect(store.listInterventions(session.id)).toEqual([]);
    expect(store.listOutcomes(session.id)).toEqual([]);
  });

  it('Derived: dashboard aggregates drop to empty after clear', () => {
    const { engine, store } = ctx;
    const { session } = engine.startSession(DEMO_COURSE_ID);
    engine.dispatch({
      sessionId: session.id,
      type: 'TASK_STARTED',
      source: 'user',
      payload: { taskId: 'rbt-t1' },
    });
    engine.createCheckpoint(session.id);
    engine.createCheckpoint(session.id);
    expect(engine.getDashboard().interruptCount).toBeGreaterThan(0);

    engine.clearAgentMemory(session.id);

    const dashboard = engine.getDashboard();
    expect(dashboard.interruptCount).toBe(0);
    expect(engine.listEvents(session.id)).toEqual([]);
    expect(store.listCheckpoints(session.id)).toEqual([]);
  });

  it('Derived: context builder has no events and no checkpoint after clear', () => {
    const { engine } = ctx;
    const { session } = engine.startSession(DEMO_COURSE_ID);
    engine.dispatch({
      sessionId: session.id,
      type: 'TASK_STARTED',
      source: 'user',
      payload: { taskId: 'rbt-t1' },
    });
    engine.createCheckpoint(session.id);

    engine.clearAgentMemory(session.id);

    const report = engine.getAgentContext();
    expect(report.context?.recentEvents).toEqual([]);
    expect(report.context?.checkpoint).toBeNull();
  });

  it('Derived: the event log insights read is empty after clear', () => {
    const { engine, store } = ctx;
    const { session } = engine.startSession(DEMO_COURSE_ID);
    engine.dispatch({
      sessionId: session.id,
      type: 'TASK_STARTED',
      source: 'user',
      payload: { taskId: 'rbt-t1' },
    });

    engine.clearAgentMemory(session.id);

    /*
     * Insights are derived from the event log, so the log being empty *is* the assertion.
     * `expect(engine.getInsights('all')).toBeDefined()` was here before and asserted nothing — any
     * object satisfies it, so the test would have passed with the events still present.
     */
    expect(store.listEvents(session.id)).toEqual([]);
  });

  it('Keeps session catalog and course structure', () => {
    const { engine, store } = ctx;
    const { session } = engine.startSession(DEMO_COURSE_ID);
    engine.dispatch({
      sessionId: session.id,
      type: 'TASK_STARTED',
      source: 'user',
      payload: { taskId: 'rbt-t1' },
    });

    engine.clearAgentMemory(session.id);

    expect(store.getSession(session.id)).not.toBeNull();
    expect(store.getCourse(DEMO_COURSE_ID)).not.toBeNull();
  });

  it('Audit row holds only opaque id, timestamp and actor', () => {
    const { engine, store } = ctx;
    const { session } = engine.startSession(DEMO_COURSE_ID);
    engine.dispatch({
      sessionId: session.id,
      type: 'HELP_REQUESTED',
      source: 'user',
      payload: { taskId: 'rbt-t1', reason: 'tired' },
    });

    const audit = engine.clearAgentMemory(session.id, { actor: 'user' });
    expect(audit).toMatchObject({ actor: 'user' });
    expect(typeof audit?.clearedAt).toBe('string');

    const row = store.getAgentMemoryClear(session.id);
    expect(row).toMatchObject({ sessionId: session.id, actor: 'user' });
    const raw = JSON.stringify(row);
    expect(raw).not.toContain('tired');
    expect(raw).not.toContain('HELP_REQUESTED');
  });

  it('Returns null for an unknown session', () => {
    expect(ctx.engine.clearAgentMemory('no-such-session')).toBeNull();
  });
});
