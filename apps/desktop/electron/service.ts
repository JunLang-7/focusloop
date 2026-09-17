import { app } from 'electron';
import { join } from 'node:path';
import { FocusLoopEngine } from '@focusloop/agent-core';
import { createProviderSelection, DeepSeekProvider } from '@focusloop/llm-provider';
import { openDatabase, FocusLoopStore } from '@focusloop/persistence';
import { startBridgeServer, type BridgeServerHandle } from './bridge/server';

export interface FocusLoopService {
  readonly engine: FocusLoopEngine;
  readonly store: FocusLoopStore;
  readonly databasePath: string;
  bridge: BridgeServerHandle | null;
  dispose(): void;
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

  const service: FocusLoopService = {
    engine,
    store,
    databasePath,
    bridge: null,
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
  port?: number,
): Promise<BridgeServerHandle | null> {
  try {
    service.bridge = await startBridgeServer({
      engine: service.engine,
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
