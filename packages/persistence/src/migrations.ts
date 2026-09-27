import type { SqlDatabase } from './sqlite-database';

export interface Migration {
  readonly id: string;
  readonly sql: string;
}

/**
 * Append-only migrations. Never edit an applied migration — add a new one.
 */
export const MIGRATIONS: readonly Migration[] = [
  {
    id: '0001-initial-schema',
    sql: `
      CREATE TABLE IF NOT EXISTS courses (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        source TEXT NOT NULL,
        material_id TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS concepts (
        id TEXT NOT NULL,
        course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        key_points TEXT NOT NULL,
        position INTEGER NOT NULL,
        PRIMARY KEY (course_id, id)
      );
      CREATE INDEX IF NOT EXISTS idx_concepts_course ON concepts(course_id, position);

      CREATE TABLE IF NOT EXISTS micro_tasks (
        id TEXT NOT NULL,
        course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
        concept_id TEXT NOT NULL,
        title TEXT NOT NULL,
        instructions TEXT NOT NULL,
        kind TEXT NOT NULL,
        estimated_minutes INTEGER NOT NULL,
        position INTEGER NOT NULL,
        PRIMARY KEY (course_id, id)
      );
      CREATE INDEX IF NOT EXISTS idx_tasks_course ON micro_tasks(course_id, position);

      CREATE TABLE IF NOT EXISTS quizzes (
        id TEXT NOT NULL,
        course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
        task_id TEXT NOT NULL,
        concept_id TEXT NOT NULL,
        question TEXT NOT NULL,
        options TEXT NOT NULL,
        answer_index INTEGER NOT NULL,
        explanation TEXT NOT NULL,
        PRIMARY KEY (course_id, id)
      );
      CREATE INDEX IF NOT EXISTS idx_quizzes_course ON quizzes(course_id, task_id);

      CREATE TABLE IF NOT EXISTS materials (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        format TEXT NOT NULL,
        source TEXT NOT NULL,
        content_hash TEXT NOT NULL UNIQUE,
        sections TEXT NOT NULL,
        warnings TEXT NOT NULL,
        imported_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS learning_sessions (
        id TEXT PRIMARY KEY,
        course_id TEXT NOT NULL,
        started_at TEXT NOT NULL,
        ended_at TEXT,
        state TEXT NOT NULL,
        current_task_id TEXT,
        last_active_task_id TEXT,
        engine_state TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_started ON learning_sessions(started_at DESC);

      CREATE TABLE IF NOT EXISTS learning_events (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        type TEXT NOT NULL,
        source TEXT NOT NULL,
        at TEXT NOT NULL,
        payload TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_events_session ON learning_events(session_id, at);

      CREATE TABLE IF NOT EXISTS checkpoints (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        concept_id TEXT NOT NULL,
        concept_title TEXT NOT NULL,
        goal TEXT NOT NULL,
        mastered TEXT NOT NULL,
        unresolved TEXT NOT NULL,
        current_task_id TEXT NOT NULL,
        current_task_title TEXT NOT NULL,
        current_step INTEGER NOT NULL,
        friction_state TEXT NOT NULL,
        next_best_action TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_checkpoints_session ON checkpoints(session_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS interventions (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        at TEXT NOT NULL,
        state TEXT NOT NULL,
        action TEXT NOT NULL,
        reason TEXT NOT NULL,
        shown_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_interventions_session ON interventions(session_id, at);

      CREATE TABLE IF NOT EXISTS outcomes (
        id TEXT PRIMARY KEY,
        intervention_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        at TEXT NOT NULL,
        state TEXT NOT NULL,
        action TEXT NOT NULL,
        accepted INTEGER NOT NULL,
        dismissed INTEGER NOT NULL,
        task_completed INTEGER NOT NULL,
        resume_latency_ms INTEGER,
        quiz_outcome TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_outcomes_session ON outcomes(session_id, at);

      CREATE TABLE IF NOT EXISTS resume_cards (
        checkpoint_id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        shown_at TEXT NOT NULL,
        accepted_at TEXT,
        dismissed_at TEXT,
        resume_latency_ms INTEGER
      );

      CREATE TABLE IF NOT EXISTS app_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `,
  },
  {
    id: '0002-localized-messages',
    sql: `
      -- The two domain-generated strings the learner reads become message
      -- descriptors: an identity plus the values to interpolate. The renderer
      -- owns the wording, so there is exactly one implementation per language
      -- instead of a translated copy of the domain.
      --
      -- SQLite cannot drop a NOT NULL column, so both tables are rebuilt.
      -- Existing rows are migrated to a plausible key rather than losing data.
      CREATE TABLE checkpoints_v2 (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        concept_id TEXT NOT NULL,
        concept_title TEXT NOT NULL,
        goal TEXT NOT NULL,
        mastered TEXT NOT NULL,
        unresolved TEXT NOT NULL,
        current_task_id TEXT NOT NULL,
        current_task_title TEXT NOT NULL,
        current_step INTEGER NOT NULL,
        friction_state TEXT NOT NULL,
        next_action_key TEXT NOT NULL,
        next_action_params TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      INSERT INTO checkpoints_v2
        (id, session_id, concept_id, concept_title, goal, mastered, unresolved,
         current_task_id, current_task_title, current_step, friction_state,
         next_action_key, next_action_params, created_at)
      SELECT
         id, session_id, concept_id, concept_title, goal, mastered, unresolved,
         current_task_id, current_task_title, current_step, friction_state,
         'action.start.next', '{}', created_at
      FROM checkpoints;

      DROP TABLE checkpoints;
      ALTER TABLE checkpoints_v2 RENAME TO checkpoints;
      CREATE INDEX IF NOT EXISTS idx_checkpoints_session
        ON checkpoints(session_id, created_at DESC);

      CREATE TABLE interventions_v2 (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        at TEXT NOT NULL,
        state TEXT NOT NULL,
        action TEXT NOT NULL,
        reason_key TEXT NOT NULL,
        reason_params TEXT NOT NULL,
        shown_at TEXT NOT NULL
      );

      INSERT INTO interventions_v2
        (id, session_id, at, state, action, reason_key, reason_params, shown_at)
      SELECT id, session_id, at, state, action, 'reason.none', '{}', shown_at
      FROM interventions;

      DROP TABLE interventions;
      ALTER TABLE interventions_v2 RENAME TO interventions;
      CREATE INDEX IF NOT EXISTS idx_interventions_session
        ON interventions(session_id, at);

      INSERT INTO app_meta (key, value) VALUES ('locale', 'en')
        ON CONFLICT(key) DO NOTHING;
    `,
  },
  {
    id: '0003-intervention-answers-request',
    sql: `
      -- Which help request an intervention was produced in answer to, when it answers one.
      --
      -- Without it the only evidence that a request has been dealt with is that *something* was shown
      -- at or after it, which is not the same claim: an intervention shown in the same millisecond for
      -- an unrelated reason reads as an answer and the learner's press goes unanswered. Nullable
      -- because most interventions answer nothing — the agent speaking up unasked is the common case —
      -- and because rows written before this column existed answer nothing, which is how they read.
      ALTER TABLE interventions ADD COLUMN answers_request_id TEXT;
    `,
  },
  {
    id: '0004-rescue-outcome-times',
    sql: `
      ALTER TABLE outcomes ADD COLUMN accepted_at TEXT;
      ALTER TABLE outcomes ADD COLUMN dismissed_at TEXT;
      ALTER TABLE outcomes ADD COLUMN continued_at TEXT;
      UPDATE outcomes
      SET accepted_at = CASE WHEN accepted = 1 THEN at ELSE NULL END,
          dismissed_at = CASE WHEN dismissed = 1 THEN at ELSE NULL END;
      CREATE INDEX IF NOT EXISTS idx_outcomes_intervention
        ON outcomes(intervention_id, at, id);
    `,
  },
  {
    id: '0005-agent-proposals',
    sql: `
      -- AG4/AG8 confirmation envelope: one row per proposal, with its audit outcome.
      CREATE TABLE IF NOT EXISTS agent_proposals (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        payload TEXT NOT NULL,
        proposed_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        proposal_hash TEXT NOT NULL,
        state_fingerprint TEXT NOT NULL,
        idempotency_key TEXT NOT NULL UNIQUE,
        created_by TEXT NOT NULL,
        status TEXT NOT NULL,
        confirmed_at TEXT,
        executed_at TEXT,
        event_id TEXT,
        refusal_reason TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_agent_proposals_session
        ON agent_proposals(session_id, proposed_at, id);
    `,
  },
];

export function migrate(db: SqlDatabase): readonly string[] {
  db.exec(
    'CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL);',
  );
  const applied = new Set(
    (db.prepare('SELECT id FROM schema_migrations;').all() as Array<{ id: string }>).map(
      (row) => row.id,
    ),
  );

  const newlyApplied: string[] = [];
  const record = db.prepare('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?);');

  for (const migration of MIGRATIONS) {
    if (applied.has(migration.id)) continue;
    const run = db.transaction(() => {
      db.exec(migration.sql);
      record.run(migration.id, new Date().toISOString());
    });
    run();
    newlyApplied.push(migration.id);
  }

  return newlyApplied;
}
