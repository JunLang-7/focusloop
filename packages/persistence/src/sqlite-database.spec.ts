import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, type SqlDatabase } from './sqlite-database';

function tempFile(): string {
  return join(tmpdir(), `focusloop-driver-${randomUUID()}.sqlite`);
}

function removeDatabase(file: string): void {
  for (const suffix of ['', '-wal', '-shm']) {
    rmSync(`${file}${suffix}`, { force: true });
  }
}

describe('the node:sqlite driver', () => {
  let file: string;
  let db: SqlDatabase;

  beforeEach(() => {
    file = tempFile();
    db = openDatabase(file);
    db.exec('CREATE TABLE sample (id INTEGER PRIMARY KEY, label TEXT, flag INTEGER, payload BLOB)');
  });

  afterEach(() => {
    db.close();
    removeDatabase(file);
  });

  describe('statements', () => {
    it('writes a row and reports what changed', () => {
      const result = db.prepare('INSERT INTO sample (label, flag) VALUES (?, ?)').run('first', 1);

      expect(result.changes).toBe(1);
      expect(Number(result.lastInsertRowid)).toBe(1);

      const row = db.prepare('SELECT label, flag FROM sample WHERE id = ?').get(1) as {
        label: string;
        flag: number;
      };
      expect(row).toEqual({ label: 'first', flag: 1 });
    });

    it('returns every matching row from all()', () => {
      const insert = db.prepare('INSERT INTO sample (label) VALUES (?)');
      insert.run('a');
      insert.run('b');

      const rows = db.prepare('SELECT label FROM sample ORDER BY label').all() as {
        label: string;
      }[];
      expect(rows.map((row) => row.label)).toEqual(['a', 'b']);
    });

    it('sends undefined and null as SQL NULL', () => {
      const statement = db.prepare('SELECT ? AS value');

      expect((statement.get(undefined) as { value: unknown }).value).toBeNull();
      expect((statement.get(null) as { value: unknown }).value).toBeNull();
    });

    it('sends booleans as 0 and 1', () => {
      const statement = db.prepare('SELECT ? AS value');

      expect((statement.get(true) as { value: unknown }).value).toBe(1);
      expect((statement.get(false) as { value: unknown }).value).toBe(0);
    });

    it('passes bigints and blobs through', () => {
      const blob = new Uint8Array([1, 2, 3]);
      const row = db.prepare('SELECT ? AS big, ? AS blob').get(7n, blob) as {
        big: unknown;
        blob: unknown;
      };

      expect(Number(row.big)).toBe(7);
      expect(new Uint8Array(row.blob as Uint8Array)).toEqual(blob);
    });

    it('refuses a parameter it cannot bind', () => {
      const statement = db.prepare('SELECT ? AS value');

      expect(() => statement.get({})).toThrow(TypeError);
      expect(() => statement.get({})).toThrow(/Unsupported SQL parameter type: object/);
    });
  });

  describe('transactions', () => {
    it('commits when the body returns', () => {
      db.transaction(() => {
        db.prepare('INSERT INTO sample (label) VALUES (?)').run('committed');
      })();

      const rows = db.prepare('SELECT label FROM sample').all() as { label: string }[];
      expect(rows.map((row) => row.label)).toEqual(['committed']);
    });

    it('rolls the whole body back when it throws', () => {
      expect(() =>
        db.transaction(() => {
          db.prepare('INSERT INTO sample (label) VALUES (?)').run('discarded');
          throw new Error('stop');
        })(),
      ).toThrow('stop');

      expect(db.prepare('SELECT label FROM sample').all()).toEqual([]);
    });

    it('joins an outer transaction instead of opening a second one', () => {
      db.transaction(() => {
        db.prepare('INSERT INTO sample (label) VALUES (?)').run('outer');
        db.transaction(() => {
          db.prepare('INSERT INTO sample (label) VALUES (?)').run('inner');
        })();
      })();

      const rows = db.prepare('SELECT label FROM sample ORDER BY label').all() as {
        label: string;
      }[];
      expect(rows.map((row) => row.label)).toEqual(['inner', 'outer']);
    });

    it('discards the outer rows when a nested body throws', () => {
      expect(() =>
        db.transaction(() => {
          db.prepare('INSERT INTO sample (label) VALUES (?)').run('outer');
          db.transaction(() => {
            throw new Error('nested');
          })();
        })(),
      ).toThrow('nested');

      expect(db.prepare('SELECT label FROM sample').all()).toEqual([]);
    });

    it('opens a fresh transaction after a rollback', () => {
      const failing = db.transaction(() => {
        throw new Error('first');
      });
      expect(failing).toThrow('first');

      db.transaction(() => {
        db.prepare('INSERT INTO sample (label) VALUES (?)').run('after');
      })();

      const rows = db.prepare('SELECT label FROM sample').all() as { label: string }[];
      expect(rows.map((row) => row.label)).toEqual(['after']);
    });
  });

  it('closes the handle', () => {
    const ownFile = tempFile();
    const own = openDatabase(ownFile);

    own.close();

    expect(() => own.exec('SELECT 1')).toThrow();
    removeDatabase(ownFile);
  });
});
