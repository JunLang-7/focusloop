/**
 * The local store.
 *
 * Append-only events, sessions, courses, checkpoints and intervention outcomes over SQLite, with
 * append-only migrations. Local-first: this is the only place a learner's work exists, so the store
 * is also the only thing that has to survive.
 */

export * from './sqlite-database';
export * from './migrations';
export * from './store';
