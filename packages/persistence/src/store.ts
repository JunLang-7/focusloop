import type {
  Concept,
  Course,
  DomainMessageKey,
  Intervention,
  InterventionOutcome,
  AgentProposal,
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
import { readFlag, readInt, readNullableInt, readNullableText, readText } from './row';
import type { SqlDatabase, SqlRow } from './sqlite-database';

export interface SessionRecord {
  readonly session: LearningSession;
  readonly engineState: StateEngineState;
}

function mapIntervention(row: SqlRow): Intervention {
  const answersRequestId = readNullableText(row, 'interventions', 'answers_request_id');
  return {
    id: readText(row, 'interventions', 'id'),
    sessionId: readText(row, 'interventions', 'session_id'),
    at: readText(row, 'interventions', 'at'),
    state: readText(row, 'interventions', 'state') as LearningState,
    action: readText(row, 'interventions', 'action') as Intervention['action'],
    reason: {
      key: readText(row, 'interventions', 'reason_key') as DomainMessageKey,
      params: parseJson<Record<string, string>>(
        readText(row, 'interventions', 'reason_params'),
        {},
      ),
    },
    shownAt: readText(row, 'interventions', 'shown_at'),
    // A null column and a row from before the column existed both mean "answers no request", which is
    // what an absent field means to the policy.
    ...(answersRequestId === null ? {} : { answersRequestId }),
  };
}

/** Proposal plus its audit outcome — what AG8's audit log needs. */
export interface StoredAgentProposal {
  readonly proposal: AgentProposal;
  readonly status: string;
  readonly confirmedAt: string | null;
  readonly executedAt: string | null;
  readonly eventId: string | null;
  readonly refusalReason: string | null;
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
      .all();
    return rows.map((row) => this.hydrateCourse(row));
  }

  getCourse(courseId: string): Course | null {
    const row = this.db
      .prepare('SELECT id, title, description, source, created_at FROM courses WHERE id = ?;')
      .get(courseId);
    return row === undefined ? null : this.hydrateCourse(row);
  }

  countCourses(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS total FROM courses;').get();
    if (row === undefined) throw new Error('courses COUNT returned no row');
    return readInt(row, 'courses', 'total');
  }

  private hydrateCourse(row: SqlRow): Course {
    const courseId = readText(row, 'courses', 'id');
    const conceptRows = this.db
      .prepare('SELECT * FROM concepts WHERE course_id = ? ORDER BY position ASC;')
      .all(courseId);
    const taskRows = this.db
      .prepare('SELECT * FROM micro_tasks WHERE course_id = ? ORDER BY position ASC;')
      .all(courseId);
    const quizRows = this.db.prepare('SELECT * FROM quizzes WHERE course_id = ?;').all(courseId);

    const concepts: Concept[] = conceptRows.map((concept) => ({
      id: readText(concept, 'concepts', 'id'),
      title: readText(concept, 'concepts', 'title'),
      summary: readText(concept, 'concepts', 'summary'),
      order: readInt(concept, 'concepts', 'position'),
      keyPoints: parseJsonArray(readText(concept, 'concepts', 'key_points')),
    }));

    const microTasks: MicroTask[] = taskRows.map((task) => ({
      id: readText(task, 'micro_tasks', 'id'),
      courseId: readText(task, 'micro_tasks', 'course_id'),
      conceptId: readText(task, 'micro_tasks', 'concept_id'),
      title: readText(task, 'micro_tasks', 'title'),
      instructions: readText(task, 'micro_tasks', 'instructions'),
      kind: readText(task, 'micro_tasks', 'kind') as MicroTaskKind,
      estimatedMinutes: readInt(task, 'micro_tasks', 'estimated_minutes'),
      order: readInt(task, 'micro_tasks', 'position'),
    }));

    const quizzes: Quiz[] = quizRows.map((quiz) => ({
      id: readText(quiz, 'quizzes', 'id'),
      taskId: readText(quiz, 'quizzes', 'task_id'),
      conceptId: readText(quiz, 'quizzes', 'concept_id'),
      question: readText(quiz, 'quizzes', 'question'),
      options: parseJsonArray(readText(quiz, 'quizzes', 'options')),
      answerIndex: readInt(quiz, 'quizzes', 'answer_index'),
      explanation: readText(quiz, 'quizzes', 'explanation'),
    }));

    return {
      id: courseId,
      title: readText(row, 'courses', 'title'),
      description: readText(row, 'courses', 'description'),
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
    const row = this.db.prepare('SELECT * FROM materials WHERE content_hash = ?;').get(contentHash);
    return row === undefined ? null : mapMaterial(row);
  }

  listMaterials(): MaterialDocument[] {
    const rows = this.db.prepare('SELECT * FROM materials ORDER BY imported_at DESC;').all();
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
    const row = this.db.prepare('SELECT * FROM learning_sessions WHERE id = ?;').get(sessionId);
    return row === undefined ? null : mapSession(row);
  }

  getLatestSession(): SessionRecord | null {
    const row = this.db
      .prepare('SELECT * FROM learning_sessions ORDER BY started_at DESC, id DESC LIMIT 1;')
      .get();
    return row === undefined ? null : mapSession(row);
  }

  getActiveSession(): SessionRecord | null {
    const row = this.db
      .prepare(
        'SELECT * FROM learning_sessions WHERE ended_at IS NULL ORDER BY started_at DESC, id DESC LIMIT 1;',
      )
      .get();
    return row === undefined ? null : mapSession(row);
  }

  listSessions(): SessionRecord[] {
    const rows = this.db.prepare('SELECT * FROM learning_sessions ORDER BY started_at DESC;').all();
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
      .all(sessionId, limit);
    return rows.map(mapEvent);
  }

  countEvents(sessionId: string, type?: LearningEventType): number {
    const row =
      type === undefined
        ? this.db
            .prepare('SELECT COUNT(*) AS total FROM learning_events WHERE session_id = ?;')
            .get(sessionId)
        : this.db
            .prepare(
              'SELECT COUNT(*) AS total FROM learning_events WHERE session_id = ? AND type = ?;',
            )
            .get(sessionId, type);
    if (row === undefined) throw new Error('learning_events COUNT returned no row');
    return readInt(row, 'learning_events', 'total');
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
      .get(sessionId);
    return row === undefined ? null : mapCheckpoint(row);
  }

  getCheckpoint(checkpointId: string): LearningCheckpoint | null {
    const row = this.db.prepare('SELECT * FROM checkpoints WHERE id = ?;').get(checkpointId);
    return row === undefined ? null : mapCheckpoint(row);
  }

  listCheckpoints(sessionId: string): LearningCheckpoint[] {
    const rows = this.db
      .prepare('SELECT * FROM checkpoints WHERE session_id = ? ORDER BY created_at ASC;')
      .all(sessionId);
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
    const row = this.db.prepare('SELECT * FROM interventions WHERE id = ?;').get(interventionId);
    return row === undefined ? null : mapIntervention(row);
  }

  listInterventions(sessionId: string): Intervention[] {
    const rows = this.db
      .prepare('SELECT * FROM interventions WHERE session_id = ? ORDER BY at ASC;')
      .all(sessionId);
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
      .get(interventionId);
    return row === undefined ? null : mapOutcome(row);
  }

  listOutcomes(sessionId: string): InterventionOutcome[] {
    const rows = this.db
      .prepare('SELECT * FROM outcomes WHERE session_id = ? ORDER BY at ASC;')
      .all(sessionId);
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
      .get(checkpointId);
    if (row === undefined) return null;
    return mapResumeTiming(row);
  }

  listResumeTimings(sessionId: string): ResumeCardTiming[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM resume_cards
         WHERE session_id = ?
         ORDER BY shown_at ASC, checkpoint_id ASC;`,
      )
      .all(sessionId);
    return rows.map(mapResumeTiming);
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
   * then events and proposals. The session row and course catalog are left alone.
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
      /*
       * By `session_id`, not through the checkpoint join. `resume_cards` carries the session id itself,
       * and a card whose checkpoint row is already gone would survive a join-based delete — leaving
       * "cleared" data behind for exactly the rows nobody would think to look at.
       */
      this.db.prepare('DELETE FROM resume_cards WHERE session_id = ?;').run(sessionId);
      this.db.prepare('DELETE FROM checkpoints WHERE session_id = ?;').run(sessionId);
      this.db.prepare('DELETE FROM learning_events WHERE session_id = ?;').run(sessionId);
      /*
       * `agent_proposals` too. Its payload is built from the learner's own context, so a surviving row
       * is cleared content that `getAgentProposal` still hands back. The table landed after this ADR was
       * written and the delete did not cover it. A pending proposal dies with the context it was computed
       * against, which is the point: confirming it afterwards would apply a write to a world that is gone.
       */
      this.db.prepare('DELETE FROM agent_proposals WHERE session_id = ?;').run(sessionId);
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

  // --------------------------------------------------------- agent proposals

  /**
   * Inserts a proposal. Returns false when the id or idempotency key already
   * exists (hostile replay of the same insert).
   */
  insertAgentProposal(proposal: AgentProposal): boolean {
    const exists = this.db
      .prepare('SELECT 1 FROM agent_proposals WHERE id = ? OR idempotency_key = ?;')
      .get(proposal.id, proposal.idempotencyKey);
    if (exists !== undefined) return false;
    const result = this.db
      .prepare(
        `INSERT INTO agent_proposals
           (id, session_id, kind, payload, proposed_at, expires_at, proposal_hash,
            state_fingerprint, idempotency_key, created_by, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'proposed');`,
      )
      .run(
        proposal.id,
        proposal.sessionId,
        proposal.kind,
        JSON.stringify(proposal.payload),
        proposal.proposedAt,
        proposal.expiresAt,
        proposal.proposalHash,
        proposal.stateFingerprint,
        proposal.idempotencyKey,
        proposal.createdBy,
      );
    return result.changes > 0;
  }

  getAgentProposal(proposalId: string): StoredAgentProposal | null {
    const row = this.db.prepare('SELECT * FROM agent_proposals WHERE id = ?;').get(proposalId);
    return row === undefined ? null : mapAgentProposal(row);
  }

  getAgentProposalByIdempotencyKey(key: string): StoredAgentProposal | null {
    const row = this.db
      .prepare('SELECT * FROM agent_proposals WHERE idempotency_key = ?;')
      .get(key);
    return row === undefined ? null : mapAgentProposal(row);
  }

  /** Conditional update: only advances proposed → confirmed. Returns false if the row was not in that state. */
  markAgentProposalConfirmed(proposalId: string, at: string): boolean {
    const result = this.db
      .prepare(
        `UPDATE agent_proposals
           SET status = 'confirmed', confirmed_at = ?
         WHERE id = ? AND status = 'proposed';`,
      )
      .run(at, proposalId);
    return result.changes > 0;
  }

  markAgentProposalRefused(proposalId: string, reason: string, at: string): boolean {
    const result = this.db
      .prepare(
        `UPDATE agent_proposals
           SET status = 'refused', refusal_reason = ?, confirmed_at = ?
         WHERE id = ? AND status IN ('proposed', 'confirmed');`,
      )
      .run(reason, at, proposalId);
    return result.changes > 0;
  }

  /**
   * Conditional update: only advances confirmed → executed.
   * Returns false when already executed — the idempotent second execute.
   */
  markAgentProposalExecuted(proposalId: string, eventId: string, at: string): boolean {
    const result = this.db
      .prepare(
        `UPDATE agent_proposals
           SET status = 'executed', executed_at = ?, event_id = ?
         WHERE id = ? AND status = 'confirmed' AND executed_at IS NULL;`,
      )
      .run(at, eventId, proposalId);
    return result.changes > 0;
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

/*
 * A `learning_events` row as a `LearningEvent`.
 *
 * Every column is read by name and type. The one thing TypeScript cannot check is that `payload`
 * matches the member `type` selects, so the union is named here once — with the reason — rather than
 * asserted at the call site.
 */
function mapEvent(row: SqlRow): LearningEvent {
  return {
    id: readText(row, 'learning_events', 'id'),
    sessionId: readText(row, 'learning_events', 'session_id'),
    type: readText(row, 'learning_events', 'type') as LearningEventType,
    source: readText(row, 'learning_events', 'source') as LearningEventSource,
    at: readText(row, 'learning_events', 'at'),
    payload: parseJson<Record<string, unknown>>(readText(row, 'learning_events', 'payload'), {}),
  } as LearningEvent;
}

function mapResumeTiming(row: SqlRow): ResumeCardTiming {
  return {
    checkpointId: readText(row, 'resume_cards', 'checkpoint_id'),
    shownAt: readText(row, 'resume_cards', 'shown_at'),
    acceptedAt: readNullableText(row, 'resume_cards', 'accepted_at') ?? undefined,
    dismissedAt: readNullableText(row, 'resume_cards', 'dismissed_at') ?? undefined,
    resumeLatencyMs: readNullableInt(row, 'resume_cards', 'resume_latency_ms') ?? undefined,
  };
}

function mapOutcome(row: SqlRow): InterventionOutcome {
  const acceptedAt = readNullableText(row, 'outcomes', 'accepted_at');
  const dismissedAt = readNullableText(row, 'outcomes', 'dismissed_at');
  const continuedAt = readNullableText(row, 'outcomes', 'continued_at');
  const quizOutcome = readNullableText(row, 'outcomes', 'quiz_outcome');
  return {
    id: readText(row, 'outcomes', 'id'),
    interventionId: readText(row, 'outcomes', 'intervention_id'),
    sessionId: readText(row, 'outcomes', 'session_id'),
    at: readText(row, 'outcomes', 'at'),
    state: readText(row, 'outcomes', 'state') as LearningState,
    action: readText(row, 'outcomes', 'action') as InterventionOutcome['action'],
    accepted: readFlag(row, 'outcomes', 'accepted'),
    dismissed: readFlag(row, 'outcomes', 'dismissed'),
    taskCompleted: readFlag(row, 'outcomes', 'task_completed'),
    resumeLatencyMs: readNullableInt(row, 'outcomes', 'resume_latency_ms'),
    quizOutcome: quizOutcome === 'correct' || quizOutcome === 'incorrect' ? quizOutcome : null,
    ...(acceptedAt === null ? {} : { acceptedAt }),
    ...(dismissedAt === null ? {} : { dismissedAt }),
    ...(continuedAt === null ? {} : { continuedAt }),
  };
}

function mapMaterial(row: SqlRow): MaterialDocument {
  return {
    id: readText(row, 'materials', 'id'),
    title: readText(row, 'materials', 'title'),
    format: readText(row, 'materials', 'format') as MaterialFormat,
    source: readText(row, 'materials', 'source') as MaterialSource,
    contentHash: readText(row, 'materials', 'content_hash'),
    sections: parseJson<MaterialSection[]>(readText(row, 'materials', 'sections'), []),
    warnings: parseJson<string[]>(readText(row, 'materials', 'warnings'), []),
    importedAt: readText(row, 'materials', 'imported_at'),
  };
}

function mapSession(row: SqlRow): SessionRecord {
  const engineState = parseJson<StateEngineState | null>(
    readText(row, 'learning_sessions', 'engine_state'),
    null,
  );
  return {
    session: {
      id: readText(row, 'learning_sessions', 'id'),
      courseId: readText(row, 'learning_sessions', 'course_id'),
      startedAt: readText(row, 'learning_sessions', 'started_at'),
      endedAt: readNullableText(row, 'learning_sessions', 'ended_at') ?? undefined,
      state: (engineState?.state ?? 'READY') as LearningState,
      currentTaskId: readNullableText(row, 'learning_sessions', 'current_task_id') ?? undefined,
      lastActiveTaskId:
        readNullableText(row, 'learning_sessions', 'last_active_task_id') ?? undefined,
      completedTaskIds: engineState?.completedTaskIds ?? [],
      /*
       * Read out of the blob, like `completedTaskIds` above, and defaulted the same way. A session
       * written before the learner could reorder anything has no `taskOrder` in its JSON, and
       * `undefined` would travel as far as the renderer, which would then have to know that "no order"
       * and "an empty order" are the same thing. They are, and saying so once here is cheaper than
       * every reader having to work it out.
       */
      taskOrder: engineState?.taskOrder ?? [],
      updatedAt: readText(row, 'learning_sessions', 'started_at'),
    },
    engineState: engineState as StateEngineState,
  };
}

function mapCheckpoint(row: SqlRow): LearningCheckpoint {
  return {
    id: readText(row, 'checkpoints', 'id'),
    sessionId: readText(row, 'checkpoints', 'session_id'),
    conceptId: readText(row, 'checkpoints', 'concept_id'),
    conceptTitle: readText(row, 'checkpoints', 'concept_title'),
    goal: readText(row, 'checkpoints', 'goal'),
    mastered: parseJsonArray(readText(row, 'checkpoints', 'mastered')),
    unresolved: parseJsonArray(readText(row, 'checkpoints', 'unresolved')),
    currentTaskId: readText(row, 'checkpoints', 'current_task_id'),
    currentTaskTitle: readText(row, 'checkpoints', 'current_task_title'),
    currentStep: readInt(row, 'checkpoints', 'current_step'),
    frictionState: readText(row, 'checkpoints', 'friction_state') as LearningState,
    nextBestAction: {
      key: readText(row, 'checkpoints', 'next_action_key') as DomainMessageKey,
      params: parseJson<Record<string, string>>(
        readText(row, 'checkpoints', 'next_action_params'),
        {},
      ),
    },
    createdAt: readText(row, 'checkpoints', 'created_at'),
  };
}

function mapAgentProposal(row: SqlRow): StoredAgentProposal {
  return {
    proposal: {
      id: readText(row, 'agent_proposals', 'id'),
      sessionId: readText(row, 'agent_proposals', 'session_id'),
      kind: readText(row, 'agent_proposals', 'kind') as AgentProposal['kind'],
      payload: parseJson<Record<string, unknown>>(readText(row, 'agent_proposals', 'payload'), {}),
      proposedAt: readText(row, 'agent_proposals', 'proposed_at'),
      expiresAt: readText(row, 'agent_proposals', 'expires_at'),
      proposalHash: readText(row, 'agent_proposals', 'proposal_hash'),
      stateFingerprint: readText(row, 'agent_proposals', 'state_fingerprint'),
      idempotencyKey: readText(row, 'agent_proposals', 'idempotency_key'),
      createdBy: readText(row, 'agent_proposals', 'created_by'),
    },
    status: readText(row, 'agent_proposals', 'status'),
    confirmedAt: readNullableText(row, 'agent_proposals', 'confirmed_at'),
    executedAt: readNullableText(row, 'agent_proposals', 'executed_at'),
    eventId: readNullableText(row, 'agent_proposals', 'event_id'),
    refusalReason: readNullableText(row, 'agent_proposals', 'refusal_reason'),
  };
}
