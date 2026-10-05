import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from '@focusloop/persistence';
import { databaseFiles, deleteFailureReason, deleteFiles } from './data-files';

const temporaryDirectories: string[] = [];

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'focusloop-data-'));
  temporaryDirectories.push(directory);
  return directory;
}

/** A database that has been opened at least once: the file and the two WAL sidecars. */
function openDatabaseFile(directory: string): string {
  const path = join(directory, 'focusloop.sqlite');
  writeFileSync(path, 'database');
  writeFileSync(`${path}-wal`, 'wal');
  writeFileSync(`${path}-shm`, 'shm');
  return path;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('databaseFiles', () => {
  it('names the database and the two files SQLite can leave beside it', () => {
    expect(databaseFiles(join('data', 'focusloop.sqlite'))).toEqual([
      join('data', 'focusloop.sqlite'),
      join('data', 'focusloop.sqlite-wal'),
      join('data', 'focusloop.sqlite-shm'),
    ]);
  });
});

describe('deleteFiles', () => {
  it('removes the database and both sidecars', () => {
    const path = openDatabaseFile(temporaryDirectory());

    expect(deleteFiles(databaseFiles(path))).toEqual({
      removed: [path, `${path}-wal`, `${path}-shm`],
      remaining: [],
      reason: null,
    });
    expect(existsSync(path)).toBe(false);
    expect(existsSync(`${path}-wal`)).toBe(false);
    expect(existsSync(`${path}-shm`)).toBe(false);
  });

  it('reports only what it found, so a database that was never written to needs no sidecars', () => {
    const directory = temporaryDirectory();
    const path = join(directory, 'focusloop.sqlite');
    writeFileSync(path, 'database');

    expect(deleteFiles(databaseFiles(path))).toEqual({
      removed: [path],
      remaining: [],
      reason: null,
    });
  });

  it('succeeds and removes nothing when there is nothing there', () => {
    const path = join(temporaryDirectory(), 'focusloop.sqlite');

    expect(deleteFiles(databaseFiles(path))).toEqual({
      removed: [],
      remaining: [],
      reason: null,
    });
  });

  /**
   * The scenario the acceptance criteria name: another program has the file open.
   *
   * Windows-only, and not for convenience: POSIX unlinks a file another process has open without
   * complaint, so this failure cannot be produced there — which is also why the lock message is worth
   * having on the one platform that can give it.
   *
   * The second connection is a real SQLite one rather than a plain `fs.open`, and that difference is the
   * whole test: Node opens files with `FILE_SHARE_DELETE`, so an `openSync` handle can be unlinked
   * underneath it, while SQLite's own open does not share delete and refuses the unlink with `EBUSY`.
   * Using a read handle here would have asserted a lock that no program can produce.
   */
  it.skipIf(process.platform !== 'win32')('leaves a locked database alone and says why', () => {
    const path = join(temporaryDirectory(), 'focusloop.sqlite');
    const other = openDatabase(path);
    try {
      expect(deleteFiles([path])).toEqual({ removed: [], remaining: [path], reason: 'locked' });
      expect(existsSync(path)).toBe(true);
    } finally {
      other.close();
    }

    // The lock is the only thing in the way: released, the same call succeeds. That is what makes
    // telling the learner worth it rather than reporting a permanent failure.
    expect(deleteFiles([path]).removed).toEqual([path]);
    expect(existsSync(path)).toBe(false);
  });

  /**
   * A failed deletion removes nothing at all.
   *
   * The sidecars are written here rather than left to SQLite, so the case is about the loop's behaviour
   * and not about whether a given connection happens to be in WAL mode: the database is locked and the two
   * files beside it are deletable, which is the combination that used to strip a live database's write-ahead
   * log and then report it as removed.
   */
  it.skipIf(process.platform !== 'win32')(
    'stops at the database, leaving its sidecars in place',
    () => {
      const path = join(temporaryDirectory(), 'focusloop.sqlite');
      const other = openDatabase(path);
      try {
        writeFileSync(`${path}-wal`, 'wal');
        writeFileSync(`${path}-shm`, 'shm');

        expect(deleteFiles(databaseFiles(path))).toEqual({
          removed: [],
          remaining: [path],
          reason: 'locked',
        });
        expect(existsSync(`${path}-wal`)).toBe(true);
        expect(existsSync(`${path}-shm`)).toBe(true);
      } finally {
        other.close();
      }
    },
  );
});

describe('deleteFailureReason', () => {
  it('reads EBUSY as a lock, which is what an open file gives on both platforms', () => {
    expect(deleteFailureReason('EBUSY')).toBe('locked');
  });

  /*
   * `EPERM`/`EACCES` is a permission problem, and on Windows it is also what a read-only file attribute
   * gives — where "close the other program" would be advice that cannot work. The open-file case is
   * `EBUSY` (measured: a second SQLite connection holding the database open), so nothing is lost by not
   * guessing here.
   */
  it('does not read a permission error as a lock', () => {
    expect(deleteFailureReason('EPERM')).toBe('failed');
    expect(deleteFailureReason('EACCES')).toBe('failed');
  });

  it('calls anything else a plain failure', () => {
    expect(deleteFailureReason('EISDIR')).toBe('failed');
    expect(deleteFailureReason('ENOENT')).toBe('failed');
    expect(deleteFailureReason(undefined)).toBe('failed');
  });
});
