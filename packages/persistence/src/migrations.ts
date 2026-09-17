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
