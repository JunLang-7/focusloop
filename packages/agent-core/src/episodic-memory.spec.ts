import { describe, expect, it } from 'vitest';
import { createTestEngine, type TestEngine } from './test-helpers';
import { DEMO_COURSE_ID } from './demo-course';
import { AGENT_MEMORY_RETENTION_MS, MEMORY_QUERY_MAX } from '@focusloop/shared-types';

const T0 = '2026-01-01T00:00:00.000Z';

/** Two sessions: an old one whose memory is past the cutoff, and the current one. */
function seeded(): { ctx: TestEngine; oldSessionId: string; currentSessionId: string } {
  const ctx = createTestEngine();

  // The old session: started and run at T0, with a completed task insights can count.
  const old = ctx.engine.startSession(DEMO_COURSE_ID);
  ctx.engine.dispatch({
    sessionId: old.session.id,
    type: 'TASK_STARTED',
    source: 'user',
    payload: { taskId: 'rbt-t1' },
    at: T0,
  });
  ctx.engine.dispatch({
    sessionId: old.session.id,
    type: 'TASK_COMPLETED',
    source: 'user',
    payload: { taskId: 'rbt-t1' },
    at: T0,
  });
  /*
   * Span ten minutes before ending: insights skips a session whose start and end are the same
   * instant (`overlapTo <= overlapFrom` counts nothing), and a zero-length session would make
   * "before" read zero for a reason that has nothing to do with the cleanup.
   */
  ctx.clock.advance(10 * 60 * 1000);
  ctx.engine.endSession({ sessionId: old.session.id, reason: 'user' });

  // Long past the retention window, then a fresh session that is the current one.
  ctx.clock.set(new Date(Date.parse(T0) + AGENT_MEMORY_RETENTION_MS + 86_400_000).toISOString());
  const current = ctx.engine.startSession(DEMO_COURSE_ID);

  return { ctx, oldSessionId: old.session.id, currentSessionId: current.session.id };
}

describe('the windowed episodic read (AG7.3)', () => {
  it('bounds a caller that asks for everything: capped, with the truncation marker', () => {
    const ctx = createTestEngine();
    try {
      const { session } = ctx.engine.startSession(DEMO_COURSE_ID);
      for (let index = 0; index < MEMORY_QUERY_MAX + 5; index += 1) {
        ctx.store.appendEvent({
          id: `e${index}`,
          sessionId: session.id,
          at: new Date(Date.parse(T0) + index * 1000).toISOString(),
          type: 'TAB_LEFT',
          source: 'extension',
          payload: {},
        });
      }

      const result = ctx.engine.listMemory(session.id, 'episodic', { limit: 10_000 });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      // The cap is the named constant, and the marker says there is more rather than hiding it.
      expect(result.list.items).toHaveLength(MEMORY_QUERY_MAX);
      expect(result.list.truncated).toBe(true);
    } finally {
      ctx.close();
    }
  });

  it('refuses a window that is not a pair of timestamps', () => {
    const ctx = createTestEngine();
    try {
      const { session } = ctx.engine.startSession(DEMO_COURSE_ID);
      expect(() => ctx.engine.listMemory(session.id, 'episodic', { since: 'not-a-date' })).toThrow(
        RangeError,
      );
      expect(() => ctx.engine.listMemory(session.id, 'episodic', { until: 'not-a-date' })).toThrow(
        RangeError,
      );
    } finally {
      ctx.close();
    }
  });

  it('filters a window through the engine, where the store only applies it', () => {
    const ctx = createTestEngine();
    try {
      const { session } = ctx.engine.startSession(DEMO_COURSE_ID);
      for (let index = 1; index <= 4; index += 1) {
        ctx.store.appendEvent({
          id: `e${index}`,
          sessionId: session.id,
          at: `2026-01-0${index}T00:00:00.000Z`,
          type: 'TAB_LEFT',
          source: 'extension',
          payload: {},
        });
      }
      const result = ctx.engine.listMemory(session.id, 'episodic', {
        since: '2026-01-02T00:00:00.000Z',
        until: '2026-01-03T00:00:00.000Z',
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.list.items.map((item) => item.at)).toEqual([
        '2026-01-03T00:00:00.000Z',
        '2026-01-02T00:00:00.000Z',
      ]);
      expect(result.list.truncated).toBe(false);
    } finally {
      ctx.close();
    }
  });
});

describe('windowed cleanup (AG7.3)', () => {
  it('removes the old session’s rows, spares the current one entirely, and reports the cutoff', () => {
    const { ctx, oldSessionId, currentSessionId } = seeded();
    try {
      // The current session gets an old-dated row too: "spared" means excluded, not only young.
      ctx.engine.dispatch({
        sessionId: currentSessionId,
        type: 'TAB_LEFT',
        source: 'extension',
        payload: {},
        at: T0,
      });

      const result = ctx.engine.cleanupOldEpisodicMemory({ actor: 'user' });
      expect(result.clearedCount).toBeGreaterThan(0);
      expect(result.sessionIds).toEqual([oldSessionId]);
      // Retention before the engine's clock: T0 + retention + a day, minus retention.
      expect(Date.parse(result.cutoffAt)).toBe(Date.parse(T0) + 86_400_000);
      // Which is comfortably after the rows it removed — that is what made them removable.
      expect(Date.parse(T0)).toBeLessThan(Date.parse(result.cutoffAt));

      expect(ctx.engine.listEvents(oldSessionId)).toEqual([]);
      // The current session's rows survive even though one of them is older than the cutoff.
      expect(ctx.engine.listEvents(currentSessionId).length).toBeGreaterThan(0);

      // Catalog and course are not memory: they survive their memory being cleaned.
      expect(ctx.store.getSession(oldSessionId)).not.toBeNull();
      expect(ctx.store.getCourse(DEMO_COURSE_ID)).not.toBeNull();
    } finally {
      ctx.close();
    }
  });

  it('is idempotent: a second run changes nothing and writes no second audit row', () => {
    const { ctx } = seeded();
    try {
      const first = ctx.engine.cleanupOldEpisodicMemory({ actor: 'user' });
      expect(first.clearedCount).toBeGreaterThan(0);
      const second = ctx.engine.cleanupOldEpisodicMemory({ actor: 'user' });
      expect(second.clearedCount).toBe(0);
      expect(second.sessionIds).toEqual([]);
      expect(ctx.store.listEpisodicCleanups()).toHaveLength(1);
    } finally {
      ctx.close();
    }
  });

  it('Derived: insights can no longer read what the cleanup removed', () => {
    const { ctx, oldSessionId } = seeded();
    try {
      const before = ctx.engine.getInsights('all');
      expect(before.tasksCompleted).toBeGreaterThan(0);

      ctx.engine.cleanupOldEpisodicMemory({ actor: 'user' });

      const after = ctx.engine.getInsights('all');
      // The old session's completion is gone from the only view that reads every session; the
      // current session completed nothing, so what is left is exactly what is retained.
      expect(after.tasksCompleted).toBe(0);
      expect(after.tasksCompleted).toBeLessThan(before.tasksCompleted);
      // And the log itself — the raw read insights is built from — is empty for the cleaned session.
      expect(ctx.engine.listEvents(oldSessionId)).toEqual([]);
    } finally {
      ctx.close();
    }
  });

  it('Derived: the current session’s dashboard and context are untouched by the cleanup', () => {
    const { ctx, currentSessionId } = seeded();
    try {
      ctx.engine.dispatch({
        sessionId: currentSessionId,
        type: 'TAB_LEFT',
        source: 'extension',
        payload: {},
      });
      const dashboardBefore = ctx.engine.getDashboard();
      const eventsBefore = ctx.engine.getAgentContext().context?.recentEvents ?? [];

      ctx.engine.cleanupOldEpisodicMemory({ actor: 'user' });

      // The cleanup's own design: it spares the running session, so the views over that session
      // cannot move. The view that *could* have read removed rows is insights, asserted above.
      expect(ctx.engine.getDashboard()).toEqual(dashboardBefore);
      expect(ctx.engine.getAgentContext().context?.recentEvents).toEqual(eventsBefore);
      expect(ctx.engine.listEvents(currentSessionId).length).toBeGreaterThan(0);
    } finally {
      ctx.close();
    }
  });

  it('the cutoff is the retention window measured from the engine’s own clock', () => {
    const ctx = createTestEngine();
    try {
      const { session } = ctx.engine.startSession(DEMO_COURSE_ID);
      const before = Date.parse(ctx.clock.now());
      const result = ctx.engine.cleanupOldEpisodicMemory();
      const drift = Date.parse(ctx.clock.now()) - before;
      const expected = Date.parse(T0) + drift - AGENT_MEMORY_RETENTION_MS;
      expect(Math.abs(Date.parse(result.cutoffAt) - expected)).toBeLessThan(1000);
      expect(result.sessionIds).toEqual([]);
      expect(ctx.engine.listEvents(session.id).length).toBeGreaterThanOrEqual(0);
    } finally {
      ctx.close();
    }
  });
});
