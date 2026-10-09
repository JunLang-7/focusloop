import { describe, expect, it } from 'vitest';
import type { LearnerPreference } from '@focusloop/shared-types';
import { createTestEngine, type TestEngine } from './test-helpers';
import { DEMO_COURSE_ID } from './demo-course';

function preference(overrides: Partial<LearnerPreference> = {}): LearnerPreference {
  return {
    id: 'pref-1',
    sessionId: 's1',
    scope: 'task-size',
    value: { stepMinutes: 2 },
    evidence: {
      windowStart: '2026-01-01T00:00:00.000Z',
      windowEnd: '2026-01-08T00:00:00.000Z',
      sampleSize: 6,
    },
    source: 'ag6.task-size',
    confirmedAt: null,
    expiresAt: null,
    createdAt: '2026-01-08T00:05:00.000Z',
    ...overrides,
  };
}

function withSession(): { ctx: TestEngine; sessionId: string } {
  const ctx = createTestEngine();
  const { session } = ctx.engine.startSession(DEMO_COURSE_ID);
  return { ctx, sessionId: session.id };
}

describe('listing and deleting a preference (AG7.4/7.6)', () => {
  it('write → list → count → delete → gone: the regression AG6’s view depends on', () => {
    const { ctx, sessionId } = withSession();
    try {
      // Written through the store the way AG6 will write it; read through the engine the way the panel does.
      expect(ctx.store.insertLearnerPreference(preference({ sessionId }))).toBe(true);

      const listed = ctx.engine.listPreferences(sessionId);
      expect(listed.ok).toBe(true);
      if (listed.ok) expect(listed.preferences.map((row) => row.id)).toEqual(['pref-1']);

      const before = ctx.engine.getMemorySummary(sessionId);
      expect(
        before.ok &&
          before.summary.sources.find((row) => row.source === 'learner_preferences')?.count,
      ).toBe(1);

      const deleted = ctx.engine.deletePreference({ id: 'pref-1', sessionId });
      expect(deleted).toEqual({ ok: true, deleted: true });

      const after = ctx.engine.listPreferences(sessionId);
      expect(after.ok && after.preferences).toEqual([]);
      const summary = ctx.engine.getMemorySummary(sessionId);
      expect(
        summary.ok &&
          summary.summary.sources.find((row) => row.source === 'learner_preferences')?.count,
      ).toBe(0);
      // The opaque audit survived the delete — that is the point of it existing.
      expect(ctx.store.listPreferenceDeletions(sessionId)).toHaveLength(1);
    } finally {
      ctx.close();
    }
  });

  it('the second delete is a no-op, not an error', () => {
    const { ctx, sessionId } = withSession();
    try {
      ctx.store.insertLearnerPreference(preference({ sessionId }));
      expect(ctx.engine.deletePreference({ id: 'pref-1', sessionId })).toEqual({
        ok: true,
        deleted: true,
      });
      expect(ctx.engine.deletePreference({ id: 'pref-1', sessionId })).toEqual({
        ok: true,
        deleted: false,
      });
      // One audit row: the no-op did not double-record a deletion that did not happen.
      expect(ctx.store.listPreferenceDeletions(sessionId)).toHaveLength(1);
    } finally {
      ctx.close();
    }
  });

  it('another session’s preference cannot be deleted — or even named', () => {
    const { ctx, sessionId } = withSession();
    try {
      // A row belonging to some other session, visible to nobody's read and deletable by nobody else.
      ctx.store.insertLearnerPreference(
        preference({ id: 'pref-other', sessionId: 'other-session' }),
      );

      expect(ctx.engine.deletePreference({ id: 'pref-other', sessionId })).toEqual({
        ok: false,
        reason: 'wrong-session',
        messageKey: 'memory.refusal.wrong-session',
      });
      expect(ctx.store.listLearnerPreferences('other-session')).toHaveLength(1);

      // And a request naming a session that is not the running one is refused at the gate.
      expect(ctx.engine.deletePreference({ id: 'pref-other', sessionId: 'other-session' })).toEqual(
        {
          ok: false,
          reason: 'wrong-session',
          messageKey: 'memory.refusal.wrong-session',
        },
      );
      expect(ctx.store.listPreferenceDeletions('other-session')).toHaveLength(0);
    } finally {
      ctx.close();
    }
  });

  it('the read is refused the same way the memory reads are', () => {
    const ctx = createTestEngine();
    try {
      expect(ctx.engine.listPreferences('whatever')).toEqual({
        ok: false,
        reason: 'no-session',
        messageKey: 'memory.refusal.no-session',
      });
      const { session } = ctx.engine.startSession(DEMO_COURSE_ID);
      expect(ctx.engine.listPreferences('another')).toEqual({
        ok: false,
        reason: 'wrong-session',
        messageKey: 'memory.refusal.wrong-session',
      });
      expect(ctx.engine.listPreferences(session.id)).toEqual({ ok: true, preferences: [] });
    } finally {
      ctx.close();
    }
  });

  it('a preference that does not exist is a completed no-op too', () => {
    const { ctx, sessionId } = withSession();
    try {
      expect(ctx.engine.deletePreference({ id: 'never-existed', sessionId })).toEqual({
        ok: true,
        deleted: false,
      });
    } finally {
      ctx.close();
    }
  });
});
