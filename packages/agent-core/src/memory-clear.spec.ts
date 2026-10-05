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

  it('Working: clear forgets the outbound request, so the recorded prompt is not readable', async () => {
    const prompts: string[] = [];
    const scripted = createTestEngine({
      providers: createProviderSelection(capturingProvider(prompts)),
    });
    try {
      const { session } = scripted.engine.startSession(DEMO_COURSE_ID);
      await scripted.engine.askTutor({
        sessionId: session.id,
        mode: 'HINT',
        question: 'SECRET_OUTBOUND_QUESTION',
      });
      expect(scripted.engine.getOutboundRequest(session.id)?.prompt).toContain(
        'SECRET_OUTBOUND_QUESTION',
      );

      scripted.engine.clearAgentMemory(session.id);

      /*
       * The map was only cleared by `endSession`, so a cleared session's prompt — the learner's question
       * verbatim — stayed readable through the Outbound Inspector. The ADR already named this class as
       * deleted on clear; the code did not do it.
       */
      expect(scripted.engine.getOutboundRequest(session.id)).toBeNull();
    } finally {
      scripted.close();
    }
  });

  /*
   * The delete-everything path (#10) rather than the per-session clear: the database is about to be
   * removed, so there is no session left to clear one at a time. What the transcript and the outbound map
   * hold is the learner's own words, which is why a deletion that stopped at the file would be a
   * deletion that says less than it does.
   */
  it('Working: discarding transient data forgets the session, with no session named', async () => {
    const prompts: string[] = [];
    const scripted = createTestEngine({
      providers: createProviderSelection(capturingProvider(prompts)),
    });
    try {
      /*
       * One session, because the engine allows one: starting a second ends the first, and ending it clears the
       * outbound entry anyway, so "every session" is not a state this engine can be put in to be asserted. What
       * the difference from `clearAgentMemory` rests on is that nothing is named here — the call takes no id.
       */
      const { session } = scripted.engine.startSession(DEMO_COURSE_ID);
      await scripted.engine.askTutor({
        sessionId: session.id,
        mode: 'HINT',
        question: 'QUESTION_BEFORE_DELETE',
      });
      expect(scripted.engine.getOutboundRequest(session.id)).not.toBeNull();

      scripted.engine.discardTransientData();

      expect(scripted.engine.getOutboundRequest(session.id)).toBeNull();

      // The transcript is observable only through the next prompt, which is where it would come back.
      await scripted.engine.askTutor({
        sessionId: session.id,
        mode: 'HINT',
        question: 'QUESTION_AFTER_DELETE',
      });
      const after = prompts.at(-1) ?? '';
      expect(after).toContain('QUESTION_AFTER_DELETE');
      expect(after).not.toContain('QUESTION_BEFORE_DELETE');
    } finally {
      scripted.close();
    }
  });

  it('Episodic: clear deletes the session proposal rows as well', () => {
    const { engine, store } = ctx;
    const { session } = engine.startSession(DEMO_COURSE_ID);
    store.insertAgentProposal({
      id: 'p1',
      sessionId: session.id,
      kind: 'structural-write',
      payload: { excerpt: 'SECRET_PROPOSAL_EXCERPT' },
      proposedAt: '2026-01-01T00:00:00.000Z',
      expiresAt: '2026-01-01T00:05:00.000Z',
      proposalHash: 'hash-1',
      stateFingerprint: 'fp-1',
      idempotencyKey: 'k1',
      createdBy: 'test-tool',
    });
    expect(store.getAgentProposal('p1')).not.toBeNull();

    engine.clearAgentMemory(session.id);

    /*
     * A pending proposal computed against the context we just deleted must not survive the clear: the
     * row is the learner's own excerpt, and confirming it afterwards would apply a write against a
     * world that no longer exists.
     */
    expect(store.getAgentProposal('p1')).toBeNull();
  });

  it('Audit: the engine reports the stored clear, or null before one', () => {
    const { engine } = ctx;
    const { session } = engine.startSession(DEMO_COURSE_ID);
    /*
     * The reader the audit exists for — "was this session cleared, and when?" — was the one part of
     * this feature with no caller in a test, which put agent-core two statements under the coverage
     * threshold. Reading it before a clear must say null, not a zero timestamp.
     */
    expect(engine.getAgentMemoryClear(session.id)).toBeNull();

    const audit = engine.clearAgentMemory(session.id, { actor: 'system' });

    expect(engine.getAgentMemoryClear(session.id)).toEqual(audit);
  });

  it('Returns null for an unknown session', () => {
    expect(ctx.engine.clearAgentMemory('no-such-session')).toBeNull();
  });
});
