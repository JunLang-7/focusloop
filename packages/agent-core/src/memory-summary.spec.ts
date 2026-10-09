import { describe, expect, it } from 'vitest';
import { createTestEngine, type TestEngine } from './test-helpers';
import { createProviderSelection } from '@focusloop/llm-provider';
import { DEMO_COURSE_ID } from './demo-course';

function withSession(): { ctx: TestEngine; sessionId: string } {
  const ctx = createTestEngine();
  const { session } = ctx.engine.startSession(DEMO_COURSE_ID);
  return { ctx, sessionId: session.id };
}

function dispatchSome(ctx: TestEngine, sessionId: string): void {
  ctx.engine.dispatch({
    sessionId,
    type: 'TASK_STARTED',
    source: 'user',
    payload: { taskId: 'rbt-t1' },
  });
  ctx.engine.dispatch({
    sessionId,
    type: 'TASK_COMPLETED',
    source: 'user',
    payload: { taskId: 'rbt-t1' },
  });
}

describe('the agent-memory summary (AG7.5)', () => {
  it('counts every source and puts no content anywhere in what the panel is given', () => {
    const { ctx, sessionId } = withSession();
    try {
      dispatchSome(ctx, sessionId);
      const result = ctx.engine.getMemorySummary(sessionId);
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const { summary } = result;
      expect(summary.sessionId).toBe(sessionId);
      expect(summary.sources).toHaveLength(8);
      const events = summary.sources.find((row) => row.source === 'learning_events');
      // Two dispatches plus the SESSION_STARTED that starting the session wrote.
      expect(events?.count).toBe(3);
      expect(events?.latestAt).not.toBeNull();
      // Zero rows exist too: a learner reading "0" learns something a missing row would not say.
      expect(summary.sources.find((row) => row.source === 'checkpoints')?.count).toBe(0);
      expect(summary.cleared).toBeNull();

      /*
       * ADR 0001's inspection promise, made executable: the scan walks everything the panel would
       * receive and fails on any key outside the metadata vocabulary — a `text`, `payload` or
       * `title` appearing here would mean content is being shown as though it were a count.
       */
      const allowed = new Set([
        'sessionId',
        'sources',
        'source',
        'count',
        'latestAt',
        'cleared',
        'clearedAt',
        'actor',
        'ok',
        'summary',
      ]);
      const seen = new Set<string>();
      const walk = (value: unknown): void => {
        if (Array.isArray(value)) {
          value.forEach(walk);
          return;
        }
        if (typeof value !== 'object' || value === null) return;
        for (const [key, item] of Object.entries(value)) {
          seen.add(key);
          walk(item);
        }
      };
      walk(summary);
      expect([...seen].filter((key) => !allowed.has(key))).toEqual([]);
    } finally {
      ctx.close();
    }
  });

  it('refuses to read another session’s memory', () => {
    const { ctx, sessionId } = withSession();
    try {
      const result = ctx.engine.getMemorySummary('some-other-session');
      expect(result).toEqual({
        ok: false,
        reason: 'wrong-session',
        messageKey: 'memory.refusal.wrong-session',
      });
      expect(sessionId).not.toBe('some-other-session');
    } finally {
      ctx.close();
    }
  });

  it('refuses when nothing is running, and says so with a readable key', () => {
    const ctx = createTestEngine();
    try {
      const { session } = ctx.engine.startSession(DEMO_COURSE_ID);
      ctx.engine.endSession({ sessionId: session.id, reason: 'user' });
      const result = ctx.engine.getMemorySummary(session.id);
      expect(result).toEqual({
        ok: false,
        reason: 'no-session',
        messageKey: 'memory.refusal.no-session',
      });
    } finally {
      ctx.close();
    }
  });

  it('shows the opaque clear record and zeroes the episodic counts after a clear', () => {
    const { ctx, sessionId } = withSession();
    try {
      dispatchSome(ctx, sessionId);
      ctx.engine.clearAgentMemory(sessionId, { actor: 'user' });

      const result = ctx.engine.getMemorySummary(sessionId);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.summary.sources.find((row) => row.source === 'learning_events')?.count).toBe(0);
      expect(result.summary.cleared).not.toBeNull();
      expect(result.summary.cleared?.actor).toBe('user');
      // The audit is opaque: two fields, both of them ADR 0001's own.
      expect(Object.keys(result.summary.cleared ?? {}).sort()).toEqual(['actor', 'clearedAt']);
    } finally {
      ctx.close();
    }
  });
});

describe('the working scope (AG7.5)', () => {
  /*
   * The transcript's turns are the whole of what working memory holds now that the developer panel
   * and its outbound buffer are gone — and unlike the episodic tables they only exist after a
   * *successful* ask, so this is the one test that needs a provider that answers. The list
   * distinguishes them the way the type does: a transcript item carries no time, because turns are
   * kept rather than timestamped.
   */
  it('names what working memory holds: the transcript’s turns', async () => {
    const ctx = createTestEngine({
      providers: createProviderSelection({
        id: 'scripted',
        model: 'scripted-1',
        offline: false,
        complete: async () => ({
          text: '[hint]\nA rotation restructures three nodes.',
          providerId: 'scripted',
          model: 'scripted-1',
          latencyMs: 1,
        }),
      }),
    });
    try {
      const { session } = ctx.engine.startSession(DEMO_COURSE_ID);
      const answer = await ctx.engine.askTutor({
        sessionId: session.id,
        mode: 'HINT',
        question: 'why does the colour change?',
      });
      expect(answer.outcome.status).toBe('answered');

      const summary = ctx.engine.getMemorySummary(session.id);
      expect(summary.ok).toBe(true);
      if (!summary.ok) return;
      const transcript = summary.summary.sources.find((row) => row.source === 'transcript');
      expect(transcript?.count).toBeGreaterThan(0);

      const list = ctx.engine.listMemory(session.id, 'working');
      expect(list.ok).toBe(true);
      if (!list.ok) return;
      expect(list.list.items.map((item) => item.source)).toEqual(['transcript']);
      expect(list.list.items.find((item) => item.source === 'transcript')?.at).toBeNull();
    } finally {
      ctx.close();
    }
  });
});

describe('listing one scope (AG7.5)', () => {
  it('lists episodic items newest first, bounded, metadata only', () => {
    const { ctx, sessionId } = withSession();
    try {
      for (let index = 0; index < 55; index += 1) {
        ctx.engine.dispatch({
          sessionId,
          type: 'TAB_LEFT',
          source: 'extension',
          payload: { origin: 'https://example.test' },
          at: new Date(Date.parse('2026-01-01T00:00:00.000Z') + index * 1000).toISOString(),
        });
      }
      const result = ctx.engine.listMemory(sessionId, 'episodic');
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.list.items).toHaveLength(50);
      expect(result.list.truncated).toBe(true);
      const times = result.list.items.map((item) => item.at);
      expect(times[0]).not.toBeNull();
      expect([...times].sort().reverse()).toEqual(times);
      // Metadata only: an origin URL from the event payload must not be listed.
      for (const item of result.list.items) {
        expect(Object.keys(item).sort()).toEqual(['at', 'source']);
      }
    } finally {
      ctx.close();
    }
  });

  it('refuses another session and an unrunnable read the same way the summary does', () => {
    const ctx = createTestEngine();
    try {
      // With nothing running, no-session is the refusal — wrong-session needs a session to be wrong.
      expect(ctx.engine.listMemory('other', 'episodic')).toEqual({
        ok: false,
        reason: 'no-session',
        messageKey: 'memory.refusal.no-session',
      });
      const { session } = ctx.engine.startSession(DEMO_COURSE_ID);
      expect(ctx.engine.listMemory('other', 'episodic')).toEqual({
        ok: false,
        reason: 'wrong-session',
        messageKey: 'memory.refusal.wrong-session',
      });
      ctx.engine.endSession({ sessionId: session.id, reason: 'user' });
      expect(ctx.engine.listMemory(session.id, 'working')).toEqual({
        ok: false,
        reason: 'no-session',
        messageKey: 'memory.refusal.no-session',
      });
    } finally {
      ctx.close();
    }
  });

  it('an empty scope lists nothing rather than failing', () => {
    const { ctx, sessionId } = withSession();
    try {
      const result = ctx.engine.listMemory(sessionId, 'preference');
      expect(result).toEqual({
        ok: true,
        list: { scope: 'preference', items: [], truncated: false },
      });
    } finally {
      ctx.close();
    }
  });
});
