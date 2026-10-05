import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openDatabase } from '@focusloop/persistence';

/*
 * The only spec in this package that stands in for Electron.
 *
 * `createService` reads `app.getPath('userData')` and `app.isPackaged`, and `openDataFolder` shells out — three things
 * a test cannot have. Mocking the module is the alternative to not testing the orchestration at all, and the
 * orchestration is where "did the data actually go" is decided.
 */
const getPath = vi.hoisted(() => vi.fn<() => string>());
const openPath = vi.hoisted(() => vi.fn<(path: string) => Promise<string>>());
/** Set to make the next `openDatabase` throw, which is how the deletion's reopen is made to fail. */
const openFailure = vi.hoisted(() => ({ next: false }));

vi.mock('electron', () => ({
  app: { getPath, isPackaged: true },
  shell: { openPath },
  // `handlers.ts` imports these at module load; only `broadcastTick` is exercised through them.
  ipcMain: { handle: vi.fn(), removeHandler: vi.fn(), on: vi.fn() },
}));

/*
 * A partial stand-in for the persistence package: everything real, except that `openDatabase` can be made
 * to fail once. That is the one way to test the state the deletion must never leave behind silently: the
 * file gone, or intact, while the connection cannot be put back.
 *
 * Nothing from this file's own imports appears in the factory, because the factory is hoisted above them
 * and would be reading a binding that does not exist yet. The shape is described structurally instead:
 * only `openDatabase` is typed, and the rest is spread through as it is.
 */
vi.mock('@focusloop/persistence', async (importOriginal) => {
  const actual = (await importOriginal()) as { openDatabase: (path: string) => unknown };
  return {
    ...actual,
    openDatabase: (path: string) => {
      if (openFailure.next) {
        openFailure.next = false;
        throw new Error('the database could not be opened');
      }
      return actual.openDatabase(path);
    },
  };
});

const { createService } = await import('./service');
const { broadcastTick } = await import('./ipc/handlers');

const temporaryDirectories: string[] = [];

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'focusloop-service-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  getPath.mockReset();
  openPath.mockReset();
  openFailure.next = false;
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

/*
 * The fact the deletion's honesty rests on, pinned rather than assumed.
 *
 * `deleteAllData` reports success when the database file is gone even if a `-wal` beside it could not be
 * removed, which is only defensible if a log that is not the new database's own cannot bring the learner's
 * rows back. The way to settle that is not to reason about it: commit rows in WAL mode, keep a copy of the
 * live log, remove the database, put the log back where it was, and open the path again with the same
 * `openDatabase` the app uses.
 */
describe('a log left behind by the database that was deleted', () => {
  it('is not replayed into the fresh database at the same path', () => {
    const directory = temporaryDirectory();
    const databasePath = join(directory, 'focusloop.sqlite');
    const saved = join(directory, 'saved.wal');

    const old = openDatabase(databasePath);
    old.exec('create table rows_left_behind (secret)');
    old.prepare('insert into rows_left_behind values (?)').run('the learner wrote this');
    // Copied while the connection is live, because closing checkpoints the log away and removes it.
    copyFileSync(`${databasePath}-wal`, saved);
    old.close();

    rmSync(databasePath, { force: true });
    copyFileSync(saved, `${databasePath}-wal`);

    const fresh = openDatabase(databasePath);
    try {
      const tables = fresh.prepare("select name from sqlite_master where type = 'table'").all() as {
        name: string;
      }[];
      expect(tables.map((row) => row.name)).not.toContain('rows_left_behind');
    } finally {
      fresh.close();
    }
  });
});

describe('createService', () => {
  /*
   * The acceptance criterion, at the only level where it can be pinned: the directory the UI shows is the one
   * Electron resolved. The e2e makes the same comparison against `--user-data-dir`, which is the same claim
   * through a real profile; this one cannot be satisfied by a hand-written string, because the value exists
   * only in this mock. `getPath` has no default, so a service built without `userDataPath` reads it — which
   * is the path the app itself takes.
   */
  it('takes the data directory from Electron rather than deciding it', () => {
    const directory = temporaryDirectory();
    getPath.mockReturnValue(directory);
    const service = createService();
    try {
      expect(getPath).toHaveBeenCalledWith('userData');
      expect(service.getDataInfo().directory).toBe(directory);
    } finally {
      service.dispose();
    }
  });

  it('reports the directory Electron gave it, and the file it actually opened', () => {
    const directory = temporaryDirectory();
    const service = createService({ userDataPath: directory });
    try {
      expect(service.getDataInfo()).toEqual({
        directory,
        databasePath: join(directory, 'focusloop.sqlite'),
      });
    } finally {
      service.dispose();
    }
  });

  it('says the folder did not open when the OS refuses to open it', async () => {
    openPath.mockResolvedValue('the file manager is not available');
    const service = createService({ userDataPath: temporaryDirectory() });
    try {
      expect(await service.openDataFolder()).toEqual({ opened: false });
      expect(openPath).toHaveBeenCalledWith(service.getDataInfo().directory);
    } finally {
      service.dispose();
    }
  });

  it('deletes the database and leaves a working first-run database behind', async () => {
    const directory = temporaryDirectory();
    const databasePath = join(directory, 'focusloop.sqlite');
    const service = createService({ userDataPath: directory });
    try {
      const courseId = service.engine.listCourses()[0]!.id;
      const before = service.engine.startSession(courseId).session.id;
      expect(service.engine.getCurrentSession()).not.toBeNull();

      const outcome = await service.deleteAllData();

      expect(outcome).toEqual({
        ok: true,
        reason: null,
        removed: [databasePath],
        leftBehind: [],
        usable: true,
      });
      expect(existsSync(databasePath)).toBe(true);
      expect(service.engine.getCurrentSession()).toBeNull();
      // The built-in course is the product's own content rather than the learner's, so it comes back.
      expect(service.engine.listCourses().map((course) => course.id)).toEqual([courseId]);
      expect(service.engine.getSettings().locale).toBe('en');

      /*
       * And a new session runs on the database that is there now. A different id is the proof that this is
       * a new file rather than the deleted one still open: the store keeps its identity while the
       * connection underneath it is replaced, which is the whole reason the app needs no restart.
       */
      expect(service.engine.startSession(courseId).session.id).not.toBe(before);
    } finally {
      service.dispose();
    }
  });

  it('reports a locked database honestly and keeps working on the data that survived', async () => {
    const directory = temporaryDirectory();
    const databasePath = join(directory, 'focusloop.sqlite');
    const service = createService({ userDataPath: directory });
    const other = openDatabase(databasePath);
    try {
      const courseId = service.engine.listCourses()[0]!.id;
      service.engine.startSession(courseId);

      const outcome = await service.deleteAllData();

      /*
       * Windows-only in practice, so the maintainer's machine runs the first branch and CI's other
       * platforms run the second. Both are the same claim — the report and the data have to agree — read
       * through the only answer the platform can give.
       */
      if (process.platform === 'win32') {
        expect(outcome.ok).toBe(false);
        expect(outcome.reason).toBe('locked');
        expect(service.engine.getCurrentSession()).not.toBeNull();
        expect(service.engine.listCourses().map((course) => course.id)).toContain(courseId);
      } else {
        expect(outcome.ok).toBe(true);
        expect(service.engine.getCurrentSession()).toBeNull();
      }
    } finally {
      other.close();
    }

    /*
     * And the app is still usable, which is what the failure branch promises and what the store's identity
     * buys: the reopen happens underneath the object the engine is holding, so the engine answers instead of
     * throwing against a closed connection. A read rather than a second deletion, because what is under test
     * is that a live connection is back — not Windows' timing around a fresh unlink.
     */
    expect(service.engine.listCourses().length).toBeGreaterThan(0);
    service.dispose();
  });

  /*
   * The one state where a success report and a leftover file are both true: the database went, and something
   * beside it did not. A `-shm` that is a directory cannot be unlinked anywhere, so the file cannot be made
   * to survive any other way from inside one process — and it is the shape a crashed holder leaves.
   */
  it('names the files it could not remove while still reporting the deletion', async () => {
    const directory = temporaryDirectory();
    const databasePath = join(directory, 'focusloop.sqlite');
    const service = createService({ userDataPath: directory });
    try {
      // Closed by the test, which is what the deletion does first: the connection is gone and the sidecar is
      // then created in its place.
      service.store.close();
      mkdirSync(`${databasePath}-shm`);

      const outcome = await service.deleteAllData();

      /*
       * Both halves of the truth at once: the deletion happened, and a file it could not remove is named.
       * Nothing is asserted about the path afterwards — the guarded reopen creates a database file before it
       * can fail, and in this synthetic corner (a directory where the sidecar belongs) it fails doing so, so
       * the path exists again while `removed` is the honest account of what this call deleted.
       */
      expect(outcome.ok).toBe(true);
      expect(outcome.removed).toEqual([databasePath]);
      expect(outcome.leftBehind).toEqual([`${databasePath}-shm`]);
      /*
       * And the two facts come apart here, which is the case `usable` exists for: the deletion worked, and the
       * app cannot be used until it is restarted, because the reopen has to get past the file that would not
       * go. Pinned rather than left implicit, because a leftover file being the thing that costs a restart is
       * not obvious from either name on its own.
       */
      expect(outcome.usable).toBe(false);
    } finally {
      service.dispose();
    }
  });

  /*
   * The worst corner: the deletion happened and no connection could be put back under the store.
   *
   * Throwing out of the deletion would leave every later call failing against a closed handle with the learner
   * told one internal error, so it is reported instead — and reported as its own fact, because `ok` is about
   * the data and this is about the app. No second connection is needed to produce it: the mock fails the
   * reopen, which is the whole of the state.
   */
  it('says the app needs a restart when the database cannot be opened again', async () => {
    const directory = temporaryDirectory();
    const databasePath = join(directory, 'focusloop.sqlite');
    const service = createService({ userDataPath: directory });
    try {
      openFailure.next = true;

      const outcome = await service.deleteAllData();

      expect(outcome.ok).toBe(true);
      expect(outcome.usable).toBe(false);
      expect(existsSync(databasePath)).toBe(false);
      // The store is closed underneath the engine, which is exactly what `usable: false` is telling the
      // learner. Blunt evidence rather than a claim: the next read is what fails.
      expect(() => service.engine.listCourses()).toThrow();

      /*
       * And the timer keeps its five seconds without taking the app down with it. This is one of the callers with
       * no learner behind it (the bridge's socket handler is the other), so it cannot be protected by refusing to
       * act in the UI: an uncaught throw from a `setInterval` callback puts an Electron error dialog over the
       * message telling them to restart.
       */
      expect(() => broadcastTick(service, [])).not.toThrow();
    } finally {
      // And the store survives its own teardown in that state, which is why `close` is idempotent.
      expect(() => service.dispose()).not.toThrow();
    }
  });

  /*
   * Identity, not equality, and that is the whole assertion.
   *
   * With the guard, both calls are handed the one promise, so both resolve to the same object. Without it,
   * each call runs a full deletion of its own and the two answers are equal but distinct objects — a
   * `toEqual` would pass in both worlds, which is the shape of a check that cannot fail. `toBe` is also the
   * honest statement of the claim: one deletion, one answer, handed to however many callers asked.
   *
   * The body is synchronous today, so this cannot happen through the IPC boundary (each `invoke` is its own
   * task) and the guard is there for the version with an `await` in it.
   */
  it('hands every caller the same deletion, rather than running one each', async () => {
    const directory = temporaryDirectory();
    const service = createService({ userDataPath: directory });
    try {
      const [first, second] = await Promise.all([service.deleteAllData(), service.deleteAllData()]);

      expect(first).toBe(second);
      expect(existsSync(join(directory, 'focusloop.sqlite'))).toBe(true);
    } finally {
      service.dispose();
    }
  });

  /*
   * Why the deletion finds one file and not three.
   *
   * The connection is in WAL mode while it is open, so a `-shm` sits beside the database then, and
   * `close()` checkpoints the log back into the database and removes it. That is why the store is closed
   * before anything is unlinked, and why a clean deletion has one file left to remove.
   *
   * Nothing is asserted about the disk afterwards, because the success path reopens the database and seeds
   * the built-in course, and that fresh connection creates sidecars of its own which nothing here can tell
   * apart from leftovers. `data-files.spec.ts` covers the case this one cannot: a database beside sidecars
   * that are still there, which is what a crash or another process leaves behind.
   */
  it('closes the database before deleting it, so SQLite has folded its WAL away first', async () => {
    const directory = temporaryDirectory();
    const databasePath = join(directory, 'focusloop.sqlite');
    const service = createService({ userDataPath: directory });
    try {
      /*
       * One file, and that is what closing first buys: this call's `close()` checkpointed the log into the
       * database, so the `-wal` and `-shm` that were there a moment ago are gone and one file is left to
       * unlink. Nothing is asserted about the disk afterwards, because the success path reopens the database
       * and seeds the built-in course, and that fresh connection creates sidecars of its own which nothing
       * here can tell apart from leftovers.
       */
      expect(await service.deleteAllData()).toMatchObject({ ok: true, removed: [databasePath] });
    } finally {
      service.dispose();
    }
  });
});
