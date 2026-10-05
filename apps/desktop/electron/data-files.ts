import { existsSync, unlinkSync } from 'node:fs';

/**
 * The files a FocusLoop database consists of on disk.
 *
 * SQLite writes a `-wal` and a `-shm` beside the database when it is in WAL mode, and the `-wal` holds page
 * images — the learner's rows — until it is checkpointed, so deleting the database alone leaves a file with
 * their content still in it. The database file is first so that a failure to remove it is the first thing
 * `deleteFiles` sees.
 *
 * Removing the log is not about resurrection: measured on this machine (2026-10-03), a `-wal` left beside a
 * freshly created database at the same path is ignored rather than replayed — SQLite ties a log to the
 * database it belongs to, and `service.spec.ts` pins that. It is about the learner's rows not staying on
 * disk in a file nobody is looking at.
 */
export function databaseFiles(databasePath: string): readonly string[] {
  return [databasePath, `${databasePath}-wal`, `${databasePath}-shm`];
}

/** Why a file could not be removed. `locked` is the one the learner can act on. */
export type DeleteFailureReason = 'locked' | 'failed';

export interface DeleteFilesOutcome {
  readonly removed: readonly string[];
  /**
   * The files this call could not remove. Only the one it failed on: the deletion stops there, so nothing
   * after it was attempted and an untouched file is not a file that was left behind.
   */
  readonly remaining: readonly string[];
  /** Null when every file that was there is gone. Otherwise the reason for the failure. */
  readonly reason: DeleteFailureReason | null;
}

/**
 * Which reason a failed unlink is reported with.
 *
 * `EBUSY` alone, and that is a correction rather than a simplification. Windows can answer an unlink of a
 * file another process has open with `EPERM` or `EACCES`, which is why an earlier version of this mapped
 * those to `locked` on `win32` — but `EPERM`/`EACCES` is also what Windows returns for a read-only file
 * attribute, where "close that program" is advice that cannot work. Measured here on 2026-10-03: a second
 * SQLite connection holding a database open fails the unlink with `EBUSY`, so the open-file case is already
 * named unambiguously and the speculative branch only bought a wrong diagnosis.
 */
export function deleteFailureReason(code: string | undefined): DeleteFailureReason {
  return code === 'EBUSY' ? 'locked' : 'failed';
}

function errorCode(error: unknown): string | undefined {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return typeof code === 'string' ? code : undefined;
}

/**
 * Removes each file that is there, and reports what it did.
 *
 * Nothing is thrown: a file the OS will not let go of is a normal outcome of this operation, not an
 * exception — the caller has to be able to say "it is still there" to the learner, and it cannot do that
 * from a stack trace. A file that is already absent is not a failure: the job was to have it not exist.
 *
 * The first failure ends the deletion. Continuing would unlink the sidecars of a database that is still
 * there, which is not "removing what could be removed": in WAL mode those files are the durability record
 * of the other holder's connection, and a report that named them while the database survived would be an
 * account of work that was never worth doing.
 */
export function deleteFiles(paths: readonly string[]): DeleteFilesOutcome {
  const removed: string[] = [];
  const remaining: string[] = [];
  let reason: DeleteFailureReason | null = null;

  for (const path of paths) {
    if (!existsSync(path)) continue;
    try {
      unlinkSync(path);
      removed.push(path);
    } catch (error) {
      remaining.push(path);
      reason = deleteFailureReason(errorCode(error));
      break;
    }
  }

  return { removed, remaining, reason };
}
