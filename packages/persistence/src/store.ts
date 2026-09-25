import type {
  Concept,
  Course,
  DomainMessageKey,
  Intervention,
  InterventionOutcome,
  LearningCheckpoint,
  LearningEvent,
  LearningEventSource,
  LearningEventType,
  LearningSession,
  LearningState,
  MaterialDocument,
  MaterialFormat,
  MaterialSection,
  MaterialSource,
  MicroTask,
  MicroTaskKind,
  Quiz,
  ResumeCardTiming,
} from '@focusloop/shared-types';
import type { StateEngineState } from '@focusloop/learning-state';
import { migrate } from './migrations';
import type { SqlDatabase } from './sqlite-database';

export interface SessionRecord {
  readonly session: LearningSession;
  readonly engineState: StateEngineState;
}

interface CourseRow {
  id: string;
  title: string;
  description: string;
  source: string;
  created_at: string;
}

interface ConceptRow {
  id: string;
  course_id: string;
  title: string;
  summary: string;
  key_points: string;
  position: number;
}

interface MicroTaskRow {
  id: string;
  course_id: string;
  concept_id: string;
  title: string;
  instructions: string;
  kind: string;
  estimated_minutes: number;
  position: number;
}

interface QuizRow {
  id: string;
  task_id: string;
  concept_id: string;
  question: string;
  options: string;
  answer_index: number;
  explanation: string;
}

interface MaterialRow {
  id: string;
  title: string;
  format: string;
  source: string;
  content_hash: string;
  sections: string;
  warnings: string;
  imported_at: string;
}

interface SessionRow {
  id: string;
  course_id: string;
  started_at: string;
  ended_at: string | null;
  current_task_id: string | null;
  last_active_task_id: string | null;
  engine_state: string;
}

interface EventRow {
  id: string;
  session_id: string;
  type: string;
  source: string;
  at: string;
  payload: string;
}

interface CheckpointRow {
  id: string;
  session_id: string;
  concept_id: string;
  concept_title: string;
  goal: string;
  mastered: string;
  unresolved: string;
  current_task_id: string;
  current_task_title: string;
  current_step: number;
  friction_state: string;
  next_action_key: string;
  next_action_params: string;
  created_at: string;
}

interface InterventionRow {
  id: string;
  session_id: string;
  at: string;
  state: string;
  action: string;
  reason_key: string;
  reason_params: string;
  shown_at: string;
  answers_request_id: string | null;
}

function mapIntervention(row: InterventionRow): Intervention {
  return {
    id: row.id,
    sessionId: row.session_id,
    at: row.at,
    state: row.state as LearningState,
    action: row.action as Intervention['action'],
    reason: {
      key: row.reason_key as DomainMessageKey,
      params: parseJson<Record<string, string>>(row.reason_params, {}),
    },
    shownAt: row.shown_at,
    // A null column and a row from before the column existed both mean "answers no request", which is
    // what an absent field means to the policy.
    ...(row.answers_request_id === null ? {} : { answersRequestId: row.answers_request_id }),
  };
}

interface OutcomeRow {
  id: string;
  intervention_id: string;
  session_id: string;
  at: string;
  state: string;
  action: string;
  accepted: number;
  dismissed: number;
  task_completed: number;
  resume_latency_ms: number | null;
  quiz_outcome: string | null;
  accepted_at: string | null;
  dismissed_at: string | null;
  continued_at: string | null;
}

interface ResumeCardRow {
  checkpoint_id: string;
  session_id: string;
  shown_at: string;
  accepted_at: string | null;
  dismissed_at: string | null;
  resume_latency_ms: number | null;
}

function parseJsonArray(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : [];
  } catch {
    return [];
  }
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

/**
 * All SQL lives here. The UI never issues SQL: it goes through the IPC bridge to
 * these repositories.
 */
export class FocusLoopStore {
  constructor(private readonly db: SqlDatabase) {}

  /** Idempotent. Safe to call on every boot. */
  initialize(): readonly string[] {
    return migrate(this.db);
  }

  // ---------------------------------------------------------------- courses

  saveCourse(
    course: Course,
    options: { source?: MaterialSource; materialId?: string; createdAt?: string } = {},
  ): void {
    const now = options.createdAt ?? new Date().toISOString();
    const run = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO courses (id, title, description, source, material_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             title = excluded.title,
             description = excluded.description,
             source = excluded.source,
             material_id = excluded.material_id;`,
        )
        .run(
          course.id,
          course.title,
          course.description,
          options.source ?? 'builtin',
          options.materialId ?? null,
          now,
        );

      this.db.prepare('DELETE FROM concepts WHERE course_id = ?;').run(course.id);
      this.db.prepare('DELETE FROM micro_tasks WHERE course_id = ?;').run(course.id);
      this.db.prepare('DELETE FROM quizzes WHERE course_id = ?;').run(course.id);

      const insertConcept = this.db.prepare(
        `INSERT INTO concepts (id, course_id, title, summary, key_points, position)
         VALUES (?, ?, ?, ?, ?, ?);`,
      );
      for (const concept of course.concepts) {
        insertConcept.run(
          concept.id,
          course.id,
          concept.title,
          concept.summary,
          JSON.stringify(concept.keyPoints),
          concept.order,
        );
      }

      const insertTask = this.db.prepare(
        `INSERT INTO micro_tasks (id, course_id, concept_id, title, instructions, kind, estimated_minutes, position)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?);`,
      );
      for (const task of course.microTasks) {
        insertTask.run(
          task.id,
          course.id,
          task.conceptId,
          task.title,
          task.instructions,
          task.kind,
          task.estimatedMinutes,
          task.order,
        );
      }

      const insertQuiz = this.db.prepare(
        `INSERT INTO quizzes (id, course_id, task_id, concept_id, question, options, answer_index, explanation)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?);`,
      );
      for (const quiz of course.quizzes) {
        insertQuiz.run(
          quiz.id,
          course.id,
          quiz.taskId,
          quiz.conceptId,
          quiz.question,
          JSON.stringify(quiz.options),
          quiz.answerIndex,
          quiz.explanation,
        );
      }
    });
    run();
  }

  listCourses(): Course[] {
    const rows = this.db
      .prepare(
        'SELECT id, title, description, source, created_at FROM courses ORDER BY created_at ASC, id ASC;',
      )
      .all() as CourseRow[];
    return rows.map((row) => this.hydrateCourse(row));
  }

  getCourse(courseId: string): Course | null {
    const row = this.db
      .prepare('SELECT id, title, description, source, created_at FROM courses WHERE id = ?;')
      .get(courseId) as CourseRow | undefined;
    return row === undefined ? null : this.hydrateCourse(row);
  }

  countCourses(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS total FROM courses;').get() as {
      total: number;
    };
    return row.total;
  }

  private hydrateCourse(row: CourseRow): Course {
    const conceptRows = this.db
      .prepare('SELECT * FROM concepts WHERE course_id = ? ORDER BY position ASC;')
      .all(row.id) as ConceptRow[];
    const taskRows = this.db
      .prepare('SELECT * FROM micro_tasks WHERE course_id = ? ORDER BY position ASC;')
      .all(row.id) as MicroTaskRow[];
    const quizRows = this.db
      .prepare('SELECT * FROM quizzes WHERE course_id = ?;')
      .all(row.id) as QuizRow[];

    const concepts: Concept[] = conceptRows.map((concept) => ({
      id: concept.id,
      title: concept.title,
      summary: concept.summary,
      order: concept.position,
      keyPoints: parseJsonArray(concept.key_points),
    }));

    const microTasks: MicroTask[] = taskRows.map((task) => ({
      id: task.id,
      courseId: task.course_id,
      conceptId: task.concept_id,
      title: task.title,
      instructions: task.instructions,
      kind: task.kind as MicroTaskKind,
      estimatedMinutes: task.estimated_minutes,
      order: task.position,
    }));

    const quizzes: Quiz[] = quizRows.map((quiz) => ({
      id: quiz.id,
      taskId: quiz.task_id,
      conceptId: quiz.concept_id,
      question: quiz.question,
      options: parseJsonArray(quiz.options),
      answerIndex: quiz.answer_index,
      explanation: quiz.explanation,
    }));

    return {
      id: row.id,
      title: row.title,
      description: row.description,
      concepts,
      microTasks,
      quizzes,
    };
  }

  // -------------------------------------------------------------- materials

  saveMaterial(document: MaterialDocument): boolean {
    const result = this.db
      .prepare(
        `INSERT INTO materials (id, title, format, source, content_hash, sections, warnings, imported_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(content_hash) DO NOTHING;`,
      )
      .run(
        document.id,
        document.title,
        document.format,
        document.source,
        document.contentHash,
        JSON.stringify(document.sections),
        JSON.stringify(document.warnings),
        document.importedAt,
      );
    return result.changes > 0;
  }

  getMaterialByHash(contentHash: string): MaterialDocument | null {
    const row = this.db
      .prepare('SELECT * FROM materials WHERE content_hash = ?;')
      .get(contentHash) as MaterialRow | undefined;
    return row === undefined ? null : mapMaterial(row);
  }

  listMaterials(): MaterialDocument[] {
    const rows = this.db
      .prepare('SELECT * FROM materials ORDER BY imported_at DESC;')
      .all() as MaterialRow[];
    return rows.map(mapMaterial);
  }

  // --------------------------------------------------------------- sessions

  saveSession(record: SessionRecord): void {
    this.db
      .prepare(
        `INSERT INTO learning_sessions
           (id, course_id, started_at, ended_at, state, current_task_id, last_active_task_id, engine_state, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           ended_at = excluded.ended_at,
           state = excluded.state,
           current_task_id = excluded.current_task_id,
           last_active_task_id = excluded.last_active_task_id,
           engine_state = excluded.engine_state,
           updated_at = excluded.updated_at;`,
      )
      .run(
        record.session.id,
        record.session.courseId,
        record.session.startedAt,
        record.session.endedAt ?? null,
        record.session.state,
        record.session.currentTaskId ?? null,
        record.session.lastActiveTaskId ?? null,
        JSON.stringify(record.engineState),
        record.session.updatedAt,
      );
  }

  getSession(sessionId: string): SessionRecord | null {
    const row = this.db.prepare('SELECT * FROM learning_sessions WHERE id = ?;').get(sessionId) as
      SessionRow | undefined;
    return row === undefined ? null : mapSession(row);
  }

  getLatestSession(): SessionRecord | null {
    const row = this.db
      .prepare('SELECT * FROM learning_sessions ORDER BY started_at DESC, id DESC LIMIT 1;')
      .get() as SessionRow | undefined;
    return row === undefined ? null : mapSession(row);
  }

  getActiveSession(): SessionRecord | null {
    const row = this.db
      .prepare(
        'SELECT * FROM learning_sessions WHERE ended_at IS NULL ORDER BY started_at DESC, id DESC LIMIT 1;',
      )
      .get() as SessionRow | undefined;
    return row === undefined ? null : mapSession(row);
  }

  listSessions(): SessionRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM learning_sessions ORDER BY started_at DESC;')
      .all() as SessionRow[];
    return rows.map(mapSession);
  }

  // ----------------------------------------------------------------- events

  /** Returns false when the event id already exists (duplicate protection). */
  appendEvent(event: LearningEvent): boolean {
    const result = this.db
      .prepare(
        `INSERT INTO learning_events (id, session_id, type, source, at, payload)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO NOTHING;`,
      )
      .run(
        event.id,
        event.sessionId,
        event.type,
        event.source,
        event.at,
        JSON.stringify(event.payload ?? {}),
      );
    return result.changes > 0;
  }

  listEvents(sessionId: string, limit = 500): LearningEvent[] {
    const rows = this.db
      .prepare(
        'SELECT * FROM learning_events WHERE session_id = ? ORDER BY at ASC, rowid ASC LIMIT ?;',
      )
      .all(sessionId, limit) as EventRow[];
    return rows.map(
      (row) =>
        ({
          id: row.id,
          sessionId: row.session_id,
          type: row.type as LearningEventType,
          source: row.source as LearningEventSource,
          at: row.at,
          payload: parseJson<Record<string, unknown>>(row.payload, {}),
        }) as LearningEvent,
    );
  }

  countEvents(sessionId: string, type?: LearningEventType): number {
    const row =
      type === undefined
        ? (this.db
            .prepare('SELECT COUNT(*) AS total FROM learning_events WHERE session_id = ?;')
            .get(sessionId) as { total: number })
        : (this.db
            .prepare(
              'SELECT COUNT(*) AS total FROM learning_events WHERE session_id = ? AND type = ?;',
            )
            .get(sessionId, type) as { total: number });
    return row.total;
  }

  // ------------------------------------------------------------ checkpoints

  saveCheckpoint(checkpoint: LearningCheckpoint): void {
    this.db
      .prepare(
        `INSERT INTO checkpoints
           (id, session_id, concept_id, concept_title, goal, mastered, unresolved,
            current_task_id, current_task_title, current_step, friction_state,
            next_action_key, next_action_params, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO NOTHING;`,
      )
      .run(
        checkpoint.id,
        checkpoint.sessionId,
        checkpoint.conceptId,
        checkpoint.conceptTitle,
        checkpoint.goal,
        JSON.stringify(checkpoint.mastered),
        JSON.stringify(checkpoint.unresolved),
        checkpoint.currentTaskId,
        checkpoint.currentTaskTitle,
        checkpoint.currentStep,
        checkpoint.frictionState,
        checkpoint.nextBestAction.key,
        JSON.stringify(checkpoint.nextBestAction.params),
        checkpoint.createdAt,
      );
  }

  getLatestCheckpoint(sessionId: string): LearningCheckpoint | null {
    const row = this.db
      .prepare(
        'SELECT * FROM checkpoints WHERE session_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1;',
      )
      .get(sessionId) as CheckpointRow | undefined;
    return row === undefined ? null : mapCheckpoint(row);
  }

  getCheckpoint(checkpointId: string): LearningCheckpoint | null {
    const row = this.db.prepare('SELECT * FROM checkpoints WHERE id = ?;').get(checkpointId) as
      CheckpointRow | undefined;
    return row === undefined ? null : mapCheckpoint(row);
  }

  listCheckpoints(sessionId: string): LearningCheckpoint[] {
    const rows = this.db
      .prepare('SELECT * FROM checkpoints WHERE session_id = ? ORDER BY created_at ASC;')
      .all(sessionId) as CheckpointRow[];
    return rows.map(mapCheckpoint);
  }

  // ------------------------------------------------------- interventions/outcomes

  saveIntervention(intervention: Intervention): void {
    this.db
      .prepare(
        `INSERT INTO interventions
           (id, session_id, at, state, action, reason_key, reason_params, shown_at,
            answers_request_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO NOTHING;`,
      )
      .run(
        intervention.id,
        intervention.sessionId,
        intervention.at,
        intervention.state,
        intervention.action,
        intervention.reason.key,
        JSON.stringify(intervention.reason.params),
        intervention.shownAt,
        intervention.answersRequestId ?? null,
      );
  }

  getIntervention(interventionId: string): Intervention | null {
    const row = this.db.prepare('SELECT * FROM interventions WHERE id = ?;').get(interventionId) as
      InterventionRow | undefined;
    return row === undefined ? null : mapIntervention(row);
  }

  listInterventions(sessionId: string): Intervention[] {
    const rows = this.db
      .prepare('SELECT * FROM interventions WHERE session_id = ? ORDER BY at ASC;')
      .all(sessionId) as InterventionRow[];
    return rows.map(mapIntervention);
  }

  saveOutcome(outcome: InterventionOutcome): void {
    const existing = this.getOutcomeByIntervention(outcome.interventionId);
    if (existing === null) {
      this.db
        .prepare(
          `INSERT INTO outcomes
           (id, intervention_id, session_id, at, state, action, accepted, dismissed,
            task_completed, resume_latency_ms, quiz_outcome, accepted_at, dismissed_at, continued_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO NOTHING;`,
        )
        .run(
          outcome.id,
          outcome.interventionId,
          outcome.sessionId,
          outcome.at,
          outcome.state,
          outcome.action,
          outcome.accepted ? 1 : 0,
          outcome.dismissed ? 1 : 0,
          outcome.taskCompleted ? 1 : 0,
          outcome.resumeLatencyMs,
          outcome.quizOutcome,
          outcome.acceptedAt ?? null,
          outcome.dismissedAt ?? null,
          outcome.continuedAt ?? null,
        );
      return;
    }
    if ((existing.accepted && outcome.dismissed) || (existing.dismissed && outcome.accepted))
      return;
    this.db
      .prepare(
        `UPDATE outcomes SET accepted = ?, dismissed = ?, task_completed = ?,
         resume_latency_ms = COALESCE(resume_latency_ms, ?), quiz_outcome = COALESCE(quiz_outcome, ?),
         accepted_at = COALESCE(accepted_at, ?), dismissed_at = COALESCE(dismissed_at, ?),
         continued_at = COALESCE(continued_at, ?)
       WHERE id = (SELECT id FROM outcomes WHERE intervention_id = ? ORDER BY at, rowid LIMIT 1);`,
      )
      .run(
        existing.accepted || outcome.accepted ? 1 : 0,
        existing.dismissed || outcome.dismissed ? 1 : 0,
        existing.taskCompleted || outcome.taskCompleted ? 1 : 0,
        outcome.resumeLatencyMs,
        outcome.quizOutcome,
        outcome.acceptedAt ?? null,
        outcome.dismissedAt ?? null,
        outcome.continuedAt ?? null,
        outcome.interventionId,
      );
  }

  getOutcomeByIntervention(interventionId: string): InterventionOutcome | null {
    const row = this.db
      .prepare('SELECT * FROM outcomes WHERE intervention_id = ? ORDER BY at, rowid LIMIT 1;')
      .get(interventionId) as OutcomeRow | undefined;
    return row === undefined ? null : mapOutcome(row);
  }

  listOutcomes(sessionId: string): InterventionOutcome[] {
    const rows = this.db
      .prepare('SELECT * FROM outcomes WHERE session_id = ? ORDER BY at ASC;')
      .all(sessionId) as OutcomeRow[];
    return rows.map(mapOutcome);
  }

  // ------------------------------------------------------------ resume cards

  saveResumeShown(checkpointId: string, sessionId: string, shownAt: string): void {
    this.db
      .prepare(
        `INSERT INTO resume_cards (checkpoint_id, session_id, shown_at, accepted_at, dismissed_at, resume_latency_ms)
         VALUES (?, ?, ?, NULL, NULL, NULL)
         ON CONFLICT(checkpoint_id) DO UPDATE SET shown_at = excluded.shown_at;`,
      )
      .run(checkpointId, sessionId, shownAt);
  }

  getResumeTiming(checkpointId: string): ResumeCardTiming | null {
    const row = this.db
      .prepare('SELECT * FROM resume_cards WHERE checkpoint_id = ?;')
      .get(checkpointId) as ResumeCardRow | undefined;
    if (row === undefined) return null;
    return {
      checkpointId: row.checkpoint_id,
      shownAt: row.shown_at,
      acceptedAt: row.accepted_at ?? undefined,
      dismissedAt: row.dismissed_at ?? undefined,
      resumeLatencyMs: row.resume_latency_ms ?? undefined,
    };
  }

  listResumeTimings(sessionId: string): ResumeCardTiming[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM resume_cards
         WHERE session_id = ?
         ORDER BY shown_at ASC, checkpoint_id ASC;`,
      )
      .all(sessionId) as ResumeCardRow[];
    return rows.map((row) => ({
      checkpointId: row.checkpoint_id,
      shownAt: row.shown_at,
      acceptedAt: row.accepted_at ?? undefined,
      dismissedAt: row.dismissed_at ?? undefined,
      resumeLatencyMs: row.resume_latency_ms ?? undefined,
    }));
  }

  markResumeDecided(
    checkpointId: string,
    decision: 'accepted' | 'dismissed',
    at: string,
  ): ResumeCardTiming | null {
    const current = this.getResumeTiming(checkpointId);
    if (current === null) return null;
    const latencyMs = Date.parse(at) - Date.parse(current.shownAt);
    const resumeLatencyMs = Number.isFinite(latencyMs) && latencyMs >= 0 ? latencyMs : null;

    this.db
      .prepare(
        decision === 'accepted'
          ? `UPDATE resume_cards
               SET accepted_at = ?, dismissed_at = NULL, resume_latency_ms = ?
             WHERE checkpoint_id = ?;`
          : `UPDATE resume_cards
               SET dismissed_at = ?, accepted_at = NULL, resume_latency_ms = NULL
             WHERE checkpoint_id = ?;`,
      )
      .run(...(decision === 'accepted' ? [at, resumeLatencyMs, checkpointId] : [at, checkpointId]));

    return this.getResumeTiming(checkpointId);
  }

  // ------------------------------------------------------- agent memory clear

  /**
   * Physically deletes episodic rows for one session (ADR 0001).
   *
   * Interventions/outcomes first (FK-shaped joins), then checkpoints → resume_cards,
   * then events. The session row and course catalog are left alone.
   */
  clearSessionEpisodic(sessionId: string): void {
    const run = this.db.transaction(() => {
      this.db
        .prepare(
          `DELETE FROM outcomes WHERE session_id = ? OR intervention_id IN
             (SELECT id FROM interventions WHERE session_id = ?);`,
        )
        .run(sessionId, sessionId);
      this.db.prepare('DELETE FROM interventions WHERE session_id = ?;').run(sessionId);
      this.db
        .prepare(
          `DELETE FROM resume_cards WHERE checkpoint_id IN
             (SELECT id FROM checkpoints WHERE session_id = ?);`,
        )
        .run(sessionId);
      this.db.prepare('DELETE FROM checkpoints WHERE session_id = ?;').run(sessionId);
      this.db.prepare('DELETE FROM learning_events WHERE session_id = ?;').run(sessionId);
    });
    run();
  }

  /** Records an opaque clear (no content). Returns false if already recorded. */
  recordAgentMemoryClear(sessionId: string, clearedAt: string, actor: string): boolean {
    const result = this.db
      .prepare(
        `INSERT INTO agent_memory_clears (session_id, cleared_at, actor)
         VALUES (?, ?, ?)
         ON CONFLICT(session_id) DO NOTHING;`,
      )
      .run(sessionId, clearedAt, actor);
    return result.changes > 0;
  }

  getAgentMemoryClear(sessionId: string): {
    sessionId: string;
    clearedAt: string;
    actor: string;
  } | null {
    const row = this.db
      .prepare(
        'SELECT session_id, cleared_at, actor FROM agent_memory_clears WHERE session_id = ?;',
      )
      .get(sessionId) as { session_id: string; cleared_at: string; actor: string } | undefined;
    if (row === undefined) return null;
    return { sessionId: row.session_id, clearedAt: row.cleared_at, actor: row.actor };
  }

  // ----------------------------------------------------------------- misc

  setMeta(key: string, value: string): void {
    this.db
      .prepare(
        `INSERT INTO app_meta (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value;`,
      )
      .run(key, value);
  }

  getMeta(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM app_meta WHERE key = ?;').get(key) as
      { value: string } | undefined;
    return row?.value ?? null;
  }

  /** Runs `fn` inside a single SQLite transaction. */
  transaction<T>(fn: () => T): () => T {
    return this.db.transaction(fn);
  }

  close(): void {
    this.db.close();
  }
}

function mapOutcome(row: OutcomeRow): InterventionOutcome {
  return {
    id: row.id,
    interventionId: row.intervention_id,
    sessionId: row.session_id,
    at: row.at,
    state: row.state as LearningState,
    action: row.action as InterventionOutcome['action'],
    accepted: row.accepted === 1,
    dismissed: row.dismissed === 1,
    taskCompleted: row.task_completed === 1,
    resumeLatencyMs: row.resume_latency_ms,
    quizOutcome:
      row.quiz_outcome === 'correct' || row.quiz_outcome === 'incorrect' ? row.quiz_outcome : null,
    ...(row.accepted_at === null ? {} : { acceptedAt: row.accepted_at }),
    ...(row.dismissed_at === null ? {} : { dismissedAt: row.dismissed_at }),
    ...(row.continued_at === null ? {} : { continuedAt: row.continued_at }),
  };
}

function mapMaterial(row: MaterialRow): MaterialDocument {
  return {
    id: row.id,
    title: row.title,
    format: row.format as MaterialFormat,
    source: row.source as MaterialSource,
    contentHash: row.content_hash,
    sections: parseJson<MaterialSection[]>(row.sections, []),
    warnings: parseJson<string[]>(row.warnings, []),
    importedAt: row.imported_at,
  };
}

function mapSession(row: SessionRow): SessionRecord {
  const engineState = parseJson<StateEngineState | null>(row.engine_state, null);
  return {
    session: {
      id: row.id,
      courseId: row.course_id,
      startedAt: row.started_at,
      endedAt: row.ended_at ?? undefined,
      state: (engineState?.state ?? 'READY') as LearningState,
      currentTaskId: row.current_task_id ?? undefined,
      lastActiveTaskId: row.last_active_task_id ?? undefined,
      completedTaskIds: engineState?.completedTaskIds ?? [],
      updatedAt: row.started_at,
    },
    engineState: engineState as StateEngineState,
  };
}

function mapCheckpoint(row: CheckpointRow): LearningCheckpoint {
  return {
    id: row.id,
    sessionId: row.session_id,
    conceptId: row.concept_id,
    conceptTitle: row.concept_title,
    goal: row.goal,
    mastered: parseJsonArray(row.mastered),
    unresolved: parseJsonArray(row.unresolved),
    currentTaskId: row.current_task_id,
    currentTaskTitle: row.current_task_title,
    currentStep: row.current_step,
    frictionState: row.friction_state as LearningState,
    nextBestAction: {
      key: row.next_action_key as DomainMessageKey,
      params: parseJson<Record<string, string>>(row.next_action_params, {}),
    },
    createdAt: row.created_at,
  };
}
