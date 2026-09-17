/**
 * The narrow slice of Node's built-in SQLite that this driver actually uses.
 *
 * `node:sqlite` is loaded through `process.getBuiltinModule` rather than a static
 * import. Bundlers do not yet treat it as a builtin, so a static import makes
 * Vite try to resolve a module called "sqlite", and it makes esbuild emit an
 * `import.meta.url` shim that is undefined in CommonJS output.
 */
interface SqliteDriverStatement {
  run(...params: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint };
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}

interface SqliteDriverDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqliteDriverStatement;
  close(): void;
}

interface SqliteDriverModule {
  DatabaseSync: new (path: string) => SqliteDriverDatabase;
}

const { DatabaseSync } = process.getBuiltinModule('node:sqlite') as unknown as SqliteDriverModule;

export interface SqlRunResult {
  readonly changes: number;
  readonly lastInsertRowid: number | bigint;
}

export interface SqlStatement {
  run(...params: unknown[]): SqlRunResult;
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}

/**
 * The only database surface the store depends on.
 *
 * The driver is Node's built-in SQLite (`node:sqlite`). That is a deliberate
 * choice: FocusLoop runs in two JavaScript runtimes (Node for tests and tooling,
 * Electron for the app), and a compiled native module would need a separate
 * binary per runtime and a rebuild step that silently breaks one of them.
 * `node:sqlite` ships with both, so the same code path is exercised everywhere.
 */
export interface SqlDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqlStatement;
  transaction<T>(fn: () => T): () => T;
  close(): void;
}

type SqlParam = null | number | bigint | string | Uint8Array;

function toParams(params: readonly unknown[]): SqlParam[] {
  return params.map((value) => {
    if (value === undefined) return null;
    if (
      value === null ||
      typeof value === 'number' ||
      typeof value === 'bigint' ||
      typeof value === 'string' ||
      value instanceof Uint8Array
    ) {
      return value;
    }
    if (typeof value === 'boolean') return value ? 1 : 0;
    throw new TypeError(`Unsupported SQL parameter type: ${typeof value}`);
  });
}

class NodeSqliteStatementAdapter implements SqlStatement {
  constructor(private readonly statement: SqliteDriverStatement) {}

  run(...params: unknown[]): SqlRunResult {
    const result = this.statement.run(...toParams(params));
    return {
      changes: Number(result.changes),
      lastInsertRowid: result.lastInsertRowid,
    };
  }

  get(...params: unknown[]): unknown {
    return this.statement.get(...toParams(params));
  }

  all(...params: unknown[]): unknown[] {
    return this.statement.all(...toParams(params)) as unknown[];
  }
}

export class NodeSqliteDatabase implements SqlDatabase {
  private readonly db: SqliteDriverDatabase;
  private depth = 0;

  constructor(fileName: string) {
    this.db = new DatabaseSync(fileName);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA foreign_keys = ON;');
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }

  prepare(sql: string): SqlStatement {
    return new NodeSqliteStatementAdapter(this.db.prepare(sql));
  }

  /**
   * `node:sqlite` has no transaction helper, so nesting is tracked explicitly.
   * Nested calls join the outer transaction instead of opening a second one.
   */
  transaction<T>(fn: () => T): () => T {
    return () => {
      if (this.depth > 0) {
        this.depth += 1;
        try {
          return fn();
        } finally {
          this.depth -= 1;
        }
      }

      this.db.exec('BEGIN');
      this.depth = 1;
      try {
        const result = fn();
        this.db.exec('COMMIT');
        return result;
      } catch (error) {
        this.db.exec('ROLLBACK');
        throw error;
      } finally {
        this.depth = 0;
      }
    };
  }

  close(): void {
    this.db.close();
  }
}

export function openDatabase(fileName: string): SqlDatabase {
  return new NodeSqliteDatabase(fileName);
}
