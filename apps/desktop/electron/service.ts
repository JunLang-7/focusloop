import { app, shell } from 'electron';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { FocusLoopEngine } from '@focusloop/agent-core';
import { createProviderSelection, DeepSeekProvider } from '@focusloop/llm-provider';
import { openDatabase, FocusLoopStore } from '@focusloop/persistence';
import type { DataInfo, DeleteDataResponse, OpenDataFolderResponse } from '@focusloop/shared-types';
import { startBridgeServer, type BridgeServerHandle } from './bridge/server';
import type { EventEngine } from './event-router';
import { databaseFiles, deleteFiles } from './data-files';

export interface FocusLoopService {
  readonly engine: FocusLoopEngine;
  readonly store: FocusLoopStore;
  readonly databasePath: string;
  bridge: BridgeServerHandle | null;
  dispose(): void;
  /**
   * Where the data is, read from Electron rather than assembled from a template.
   *
   * `directory` is `app.getPath('userData')` — which follows `--user-data-dir`, a portable install or a
   * moved profile — and `databasePath` is the file the store actually has open. A hand-written path in
   * the renderer would be a claim about where the data is; this is the answer.
   */
  getDataInfo(): DataInfo;
  openDataFolder(): Promise<OpenDataFolderResponse>;
  /**
   * Deletes the database and its sidecars, and returns the app to a first-run state without a restart.
   *
   * Reports what it did rather than assuming it worked: see `DeleteDataResponse`.
   */
  deleteAllData(): Promise<DeleteDataResponse>;
}

let singleton: FocusLoopService | null = null;

export interface CreateServiceOptions {
  readonly databasePath?: string;
  readonly userDataPath?: string;
  readonly deepSeekApiKey?: string | undefined;
  readonly simulatorEnabled?: boolean;
  readonly bridgePort?: number;
  readonly startBridge?: boolean;
}

/**
 * Builds the single application service. Local-first: the database lives in the
 * OS user-data directory and no network provider is created unless the user has
 * supplied a key.
 */
export function createService(options: CreateServiceOptions = {}): FocusLoopService {
  const userDataPath = options.userDataPath ?? app.getPath('userData');
  const databasePath = options.databasePath ?? join(userDataPath, 'focusloop.sqlite');

  const store = new FocusLoopStore(openDatabase(databasePath));
  store.initialize();

  const apiKey = options.deepSeekApiKey ?? process.env['FOCUSLOOP_DEEPSEEK_API_KEY'];
  const remote = apiKey ? new DeepSeekProvider({ apiKey }) : null;
  const providers = createProviderSelection(remote);

  const engine = new FocusLoopEngine({
    store,
    providers,
    simulatorEnabled: options.simulatorEnabled ?? !app.isPackaged,
  });
  engine.seedBuiltInCourses();

  /*
   * The deletion runs once, however many times it is asked for.
   *
   * Honest about what this is for: the body below is entirely synchronous, so an async function returns an
   * already-settled promise and the field is non-null only for the rest of the current task — and each IPC
   * `invoke` is its own task, so two deletions cannot overlap today. It is here for the version of this that
   * has an `await` in it: the first thing a deletion does is close the store, and a caller that arrived
   * between a close and a reopen would be driving a connection nobody owns. `service.spec.ts` asserts the
   * identity of the two answers, which is a claim the guard is the only thing that can make true.
   */
  let deletion: Promise<DeleteDataResponse> | null = null;

  const performDeletion = async (): Promise<DeleteDataResponse> => {
    /*
     * Close first. On Windows an open handle cannot be unlinked at all, and everywhere else a delete
     * underneath a live connection leaves the connection writing to a file with no name left.
     */
    store.close();
    const outcome = deleteFiles(databaseFiles(databasePath));

    /*
     * Asked here, before anything is opened again, and that order is load-bearing rather than tidy: the
     * reopen below creates a fresh database at this path, so asking afterwards would answer "is there a
     * database file" with yes every time and report every deletion as a failure.
     */
    const databaseGone = !existsSync(databasePath);

    /*
     * Everything below depends on a live connection under the store, because the engine and every IPC
     * handler hold this object by reference and a closed one makes every later call throw — the learner
     * would be told one error and then find the app dead until it was restarted, which is the outcome this
     * feature exists to avoid. So the reopen is guarded, and failing it is reported rather than thrown: the
     * process cannot repair itself, but it can say so.
     */
    let reopened = false;
    try {
      store.replaceDatabase(openDatabase(databasePath));
      reopened = true;
    } catch (error) {
      console.error('FocusLoop could not reopen its database after a deletion:', error);
    }

    /*
     * Whether the deletion happened is a question about the disk, not about this function having run: the
     * file being absent is exactly a first-run state, and the file being present is exactly the case where
     * claiming success would be a lie. A database that was never there counts as gone.
     *
     * The file rather than `outcome.reason`, which is the other available answer and the wrong one: a
     * sidecar that will not unlink *after* the database has gone leaves `reason` set, but the learner's rows
     * went with the database, so reporting "nothing was deleted, your data is still there" would be false.
     * `leftBehind` is where those files are reported instead.
     */
    if (databaseGone) {
      /*
       * The in-memory copies of the learner's words go first and unconditionally: the transcript touches no
       * database, and the whole point of it is that it holds text the deletion
       * claims to have removed. Seeding the built-in course is the part that needs the store, so that is what
       * `reopened` gates.
       */
      engine.discardTransientData();

      /*
       * A fresh database: schema, then the built-in course the catalogue is supposed to have on a first run.
       * The store keeps its identity — the engine and every IPC handler hold this object — so the connection
       * is what is replaced, which is the only way the app keeps running without a restart.
       */
      if (reopened) {
        engine.seedBuiltInCourses();
      }
      return {
        ok: true,
        reason: null,
        removed: outcome.removed,
        leftBehind: outcome.remaining,
        usable: reopened,
      };
    }

    /*
     * The learner's data is still there, so the app has to keep working: the file that survived was reopened
     * above rather than left closed behind a failure message. `usable` carries the other half of the truth
     * for the case where that reopen failed — the data is intact, but nothing works until a restart.
     */
    return {
      ok: false,
      reason: outcome.reason ?? 'failed',
      removed: outcome.removed,
      leftBehind: outcome.remaining,
      usable: reopened,
    };
  };

  const service: FocusLoopService = {
    engine,
    store,
    databasePath,
    bridge: null,
    getDataInfo: () => ({ directory: userDataPath, databasePath }),
    // An OS that refuses to open the file manager is a reportable outcome, not a crash: `openPath`
    // answers with the reason as a string rather than throwing.
    openDataFolder: async () => ({ opened: (await shell.openPath(userDataPath)) === '' }),
    deleteAllData: () =>
      (deletion ??= performDeletion().finally(() => {
        deletion = null;
      })),
    dispose: () => {
      void service.bridge?.close();
      store.close();
    },
  };

  return service;
}

/**
 * Local-first, and the bridge is optional: if the port is taken the app still
 * starts and the golden path still works through the simulator.
 */
export async function startBridge(
  service: FocusLoopService,
  engine: EventEngine = service.engine,
  port?: number,
): Promise<BridgeServerHandle | null> {
  try {
    service.bridge = await startBridgeServer({
      engine,
      ...(port === undefined ? {} : { port }),
    });
    service.store.setMeta('bridge_token', service.bridge.token);
    return service.bridge;
  } catch (error) {
    console.warn('FocusLoop bridge could not start:', error);
    service.bridge = null;
    return null;
  }
}

export function getService(): FocusLoopService {
  singleton ??= createService();
  return singleton;
}

export function resetServiceForTests(): void {
  singleton?.dispose();
  singleton = null;
}
