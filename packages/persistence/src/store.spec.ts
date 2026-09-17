import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  Course,
  InterventionOutcome,
  LearningCheckpoint,
  LearningEvent,
  MaterialDocument,
} from '@focusloop/shared-types';
import { createInitialState } from '@focusloop/learning-state';
import { openDatabase, type SqlDatabase } from './sqlite-database';
import { FocusLoopStore } from './store';

const T0 = '2026-01-01T00:00:00.000Z';

function courseFixture(): Course {
  return {
    id: 'course-1',
    title: 'Red-black trees',
    description: 'Balanced trees from first principles',
    concepts: [
      {
        id: 'c1',
        title: 'BST recap',
        summary: 'Ordering invariant',
        order: 0,
        keyPoints: ['left < node', 'right > node'],
      },
      {
        id: 'c2',
        title: 'Colour invariant',
        summary: 'Red nodes have black children',
        order: 1,
        keyPoints: ['no red-red'],
      },
    ],
    microTasks: [
      {
        id: 't1',
        courseId: 'course-1',
        conceptId: 'c1',
        title: 'Recall the invariant',
        instructions: 'Write it from memory.',
        kind: 'read',
        estimatedMinutes: 3,
        order: 0,
      },
      {
        id: 't2',
        courseId: 'course-1',
        conceptId: 'c2',
        title: 'Check a tree',
        instructions: 'Is this tree valid?',
        kind: 'quiz',
        estimatedMinutes: 5,
        order: 1,
      },
    ],
    quizzes: [
      {
        id: 'q1',
        taskId: 't2',
        conceptId: 'c2',
        question: 'Can a red node have a red child?',
        options: ['Yes', 'No'],
        answerIndex: 1,
        explanation: 'That would break the red-black invariant.',
      },
    ],
  };
}

function materialFixture(hash = 'hash-1'): MaterialDocument {
  return {
    id: `material-${hash}`,
    title: 'Imported notes',
    format: 'markdown',
    source: 'imported',
    contentHash: hash,
    sections: [{ id: 's1', heading: 'Intro', body: 'Body', order: 0, depth: 1 }],
    warnings: [],
    importedAt: T0,
  };
}

function eventFixture(id: string, at: string): LearningEvent {
  return {
    id,
    sessionId: 'session-1',
    at,
    type: 'TASK_STARTED',
    source: 'user',
    payload: { taskId: 't1' },
  };
}

describe('FocusLoopStore', () => {
  let db: SqlDatabase;
  let store: FocusLoopStore;

  beforeEach(() => {
    db = openDatabase(':memory:');
    store = new FocusLoopStore(db);
    store.initialize();
  });

  afterEach(() => {
    store.close();
  });

  it('applies migrations once and is idempotent', () => {
    const first = store.initialize();
    const second = store.initialize();
    expect(first).toEqual([]);
    expect(second).toEqual([]);
  });

  describe('courses', () => {
    it('round-trips a course with its concepts, tasks and quizzes', () => {
      store.saveCourse(courseFixture());
      const loaded = store.getCourse('course-1');
      expect(loaded).toEqual(courseFixture());
    });

    it('returns null for an unknown course', () => {
      expect(store.getCourse('nope')).toBeNull();
    });

    it('replaces child rows instead of duplicating them on re-save', () => {
      store.saveCourse(courseFixture());
      store.saveCourse(courseFixture());
      const loaded = store.getCourse('course-1');
      expect(loaded?.concepts).toHaveLength(2);
      expect(loaded?.microTasks).toHaveLength(2);
      expect(loaded?.quizzes).toHaveLength(1);
      expect(store.countCourses()).toBe(1);
    });

    it('persists an update to course metadata', () => {
      store.saveCourse(courseFixture());
      store.saveCourse({ ...courseFixture(), title: 'Renamed' });
      expect(store.getCourse('course-1')?.title).toBe('Renamed');
    });

    it('lists courses in insertion order', () => {
      store.saveCourse(courseFixture(), { createdAt: T0 });
      store.saveCourse(
        { ...courseFixture(), id: 'course-2' },
        { createdAt: '2026-02-01T00:00:00.000Z' },
      );
      expect(store.listCourses().map((course) => course.id)).toEqual(['course-1', 'course-2']);
    });
  });

  describe('materials', () => {
    it('stores and retrieves a material by content hash', () => {
      expect(store.saveMaterial(materialFixture())).toBe(true);
      expect(store.getMaterialByHash('hash-1')).toEqual(materialFixture());
    });

    it('refuses to store the same content twice', () => {
      store.saveMaterial(materialFixture());
      expect(store.saveMaterial(materialFixture('hash-1'))).toBe(false);
      expect(store.listMaterials()).toHaveLength(1);
    });
  });

  describe('sessions', () => {
    it('round-trips the engine state', () => {
      const engineState = createInitialState(T0);
      store.saveSession({
        session: {
          id: 'session-1',
          courseId: 'course-1',
          startedAt: T0,
          state: 'READY',
          completedTaskIds: [],
          updatedAt: T0,
        },
        engineState,
      });
      const loaded = store.getSession('session-1');
      expect(loaded?.engineState).toEqual(engineState);
      expect(loaded?.session.courseId).toBe('course-1');
    });

    it('finds the active session and ignores ended ones', () => {
      const engineState = createInitialState(T0);
      store.saveSession({
        session: {
          id: 'session-1',
          courseId: 'course-1',
          startedAt: T0,
          endedAt: '2026-01-01T01:00:00.000Z',
          state: 'READY',
          completedTaskIds: [],
          updatedAt: T0,
        },
        engineState,
      });
      expect(store.getActiveSession()).toBeNull();
      expect(store.getLatestSession()?.session.id).toBe('session-1');
    });

    it('updates an existing session on re-save', () => {
      const engineState = createInitialState(T0);
      const base = {
        session: {
          id: 'session-1',
          courseId: 'course-1',
          startedAt: T0,
          state: 'READY' as const,
          completedTaskIds: [],
          updatedAt: T0,
        },
        engineState,
      };
      store.saveSession(base);
      store.saveSession({
        ...base,
        engineState: { ...engineState, state: 'FOCUSED', completedTaskIds: ['t1'] },
      });
      const loaded = store.getSession('session-1');
      expect(loaded?.engineState.state).toBe('FOCUSED');
      expect(loaded?.session.state).toBe('FOCUSED');
      expect(loaded?.session.completedTaskIds).toEqual(['t1']);
    });
  });

  describe('events', () => {
    it('appends events and rejects duplicates', () => {
      expect(store.appendEvent(eventFixture('e1', T0))).toBe(true);
      expect(store.appendEvent(eventFixture('e1', T0))).toBe(false);
      expect(store.listEvents('session-1')).toHaveLength(1);
    });

    it('returns events in chronological order', () => {
      store.appendEvent(eventFixture('e2', '2026-01-01T00:00:02.000Z'));
      store.appendEvent(eventFixture('e1', '2026-01-01T00:00:01.000Z'));
      expect(store.listEvents('session-1').map((event) => event.id)).toEqual(['e1', 'e2']);
    });

    it('counts events, optionally filtered by type', () => {
      store.appendEvent(eventFixture('e1', T0));
      store.appendEvent({
        id: 'e2',
        sessionId: 'session-1',
        at: T0,
        type: 'TAB_LEFT',
        source: 'extension',
        payload: {},
      });
      expect(store.countEvents('session-1')).toBe(2);
      expect(store.countEvents('session-1', 'TAB_LEFT')).toBe(1);
    });
  });

  describe('checkpoints', () => {
    const checkpoint = (id: string, createdAt: string): LearningCheckpoint => ({
      id,
      sessionId: 'session-1',
      conceptId: 'c1',
      conceptTitle: 'BST recap',
      goal: 'Recall the invariant',
      mastered: ['ordering'],
      unresolved: ['rotations'],
      currentTaskId: 't1',
      currentTaskTitle: 'Recall the invariant',
      currentStep: 2,
      frictionState: 'INTERRUPTED',
      nextBestAction: 'Re-read the invariant',
      createdAt,
    });

    it('returns the most recent checkpoint', () => {
      store.saveCheckpoint(checkpoint('cp1', '2026-01-01T00:00:01.000Z'));
      store.saveCheckpoint(checkpoint('cp2', '2026-01-01T00:00:02.000Z'));
      expect(store.getLatestCheckpoint('session-1')?.id).toBe('cp2');
    });

    it('preserves array fields', () => {
      store.saveCheckpoint(checkpoint('cp1', T0));
      expect(store.getCheckpoint('cp1')).toMatchObject({
        mastered: ['ordering'],
        unresolved: ['rotations'],
        frictionState: 'INTERRUPTED',
      });
    });

    it('returns null when there is no checkpoint', () => {
      expect(store.getLatestCheckpoint('session-1')).toBeNull();
    });
  });

  describe('outcomes', () => {
    it('round-trips an outcome including null latency', () => {
      const outcome: InterventionOutcome = {
        id: 'o1',
        interventionId: 'i1',
        sessionId: 'session-1',
        at: T0,
        state: 'CONFUSED',
        action: 'HINT',
        accepted: true,
        dismissed: false,
        taskCompleted: true,
        resumeLatencyMs: null,
        quizOutcome: 'correct',
      };
      store.saveOutcome(outcome);
      expect(store.listOutcomes('session-1')).toEqual([outcome]);
    });

    it('is idempotent by outcome id', () => {
      const outcome: InterventionOutcome = {
        id: 'o1',
        interventionId: 'i1',
        sessionId: 'session-1',
        at: T0,
        state: 'CONFUSED',
        action: 'HINT',
        accepted: true,
        dismissed: false,
        taskCompleted: false,
        resumeLatencyMs: 1234,
        quizOutcome: null,
      };
      store.saveOutcome(outcome);
      store.saveOutcome(outcome);
      expect(store.listOutcomes('session-1')).toHaveLength(1);
    });
  });

  describe('resume timing', () => {
    it('records when the card was shown', () => {
      store.saveResumeShown('cp1', 'session-1', T0);
      expect(store.getResumeTiming('cp1')).toEqual({
        checkpointId: 'cp1',
        shownAt: T0,
        acceptedAt: undefined,
        dismissedAt: undefined,
        resumeLatencyMs: undefined,
      });
    });

    it('computes resume latency when the learner accepts', () => {
      store.saveResumeShown('cp1', 'session-1', T0);
      const timing = store.markResumeDecided('cp1', 'accepted', '2026-01-01T00:00:07.500Z');
      expect(timing?.resumeLatencyMs).toBe(7_500);
      expect(timing?.acceptedAt).toBe('2026-01-01T00:00:07.500Z');
    });

    it('clears latency when the learner dismisses', () => {
      store.saveResumeShown('cp1', 'session-1', T0);
      const timing = store.markResumeDecided('cp1', 'dismissed', '2026-01-01T00:00:03.000Z');
      expect(timing?.resumeLatencyMs).toBeUndefined();
      expect(timing?.dismissedAt).toBe('2026-01-01T00:00:03.000Z');
    });

    it('returns null when deciding on an unknown card', () => {
      expect(store.markResumeDecided('missing', 'accepted', T0)).toBeNull();
    });
  });

  describe('meta', () => {
    it('stores and updates key/value metadata', () => {
      store.setMeta('seeded', 'true');
      store.setMeta('seeded', 'false');
      expect(store.getMeta('seeded')).toBe('false');
      expect(store.getMeta('absent')).toBeNull();
    });
  });

  describe('data integrity', () => {
    it('persists across close and reopen for a file-backed database', () => {
      const file = join(tmpdir(), `focusloop-test-${randomUUID()}.sqlite`);
      try {
        const first = openDatabase(file);
        const firstStore = new FocusLoopStore(first);
        firstStore.initialize();
        firstStore.saveCourse(courseFixture());
        firstStore.close();

        const second = openDatabase(file);
        const secondStore = new FocusLoopStore(second);
        secondStore.initialize();
        expect(secondStore.getCourse('course-1')).toEqual(courseFixture());
        secondStore.close();
      } finally {
        rmSync(file, { force: true });
        rmSync(`${file}-wal`, { force: true });
        rmSync(`${file}-shm`, { force: true });
      }
    });

    it('keeps sessions isolated from one another', () => {
      const engineState = createInitialState(T0);
      for (const id of ['session-1', 'session-2']) {
        store.saveSession({
          session: {
            id,
            courseId: 'course-1',
            startedAt: T0,
            state: 'READY',
            completedTaskIds: [],
            updatedAt: T0,
          },
          engineState,
        });
      }
      store.appendEvent(eventFixture('e1', T0));
      expect(store.listEvents('session-1')).toHaveLength(1);
      expect(store.listEvents('session-2')).toHaveLength(0);
    });
  });
});
