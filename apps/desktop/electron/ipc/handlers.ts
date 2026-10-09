import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent, type WebContents } from 'electron';
import {
  IPC_CHANNELS,
  BRIDGE_PROTOCOL_VERSION,
  type DispatchEventResponse,
} from '@focusloop/shared-types';
import type { FocusLoopService } from '../service';
import {
  parseConfirmProposal,
  parseCourseId,
  parseDeleteAllData,
  parseDispatchRequest,
  parseEndSession,
  parseExecuteProposal,
  parseImportMaterial,
  parseInsightsRequest,
  parseNoArgs,
  parseProposeStructuralChange,
  parseTutorAsk,
  parseResolveIntervention,
  parseResolveRescue,
  parseResumeDecision,
  parseSessionId,
  parseSetLocale,
  parseSetAmbientSound,
  parseSetShowMaterialText,
  parseSetTheme,
  parseSimulatorCommand,
  parseStartSession,
  parseMemoryList,
  parsePreferenceDelete,
} from './validate';

interface Handler<TPayload, TResult> {
  readonly channel: string;
  readonly parse: (channel: string, value: unknown) => TPayload;
  readonly handle: (payload: TPayload, event: IpcMainInvokeEvent) => TResult | Promise<TResult>;
}

function defineHandler<TPayload, TResult>(
  handler: Handler<TPayload, TResult>,
): Handler<TPayload, TResult> {
  return handler;
}

/** The complete, closed list of what the renderer may ask for. */
export function createHandlers(service: FocusLoopService) {
  const { engine } = service;
  const bridgeInfo = () =>
    service.bridge === null
      ? {
          running: false,
          url: '',
          token: '',
          protocolVersion: BRIDGE_PROTOCOL_VERSION,
          connections: 0,
        }
      : {
          running: true,
          url: service.bridge.url,
          token: service.bridge.token,
          protocolVersion: BRIDGE_PROTOCOL_VERSION,
          connections: service.bridge.connectionCount(),
        };

  return [
    defineHandler({
      channel: IPC_CHANNELS.getAppVersion,
      parse: parseNoArgs,
      handle: () => process.env['npm_package_version'] ?? '0.1.0-demo',
    }),
    defineHandler({
      channel: IPC_CHANNELS.getRuntimeInfo,
      parse: parseNoArgs,
      handle: () => {
        const provider = engine.providerInfo();
        return {
          appVersion: process.env['npm_package_version'] ?? '0.1.0-demo',
          electronVersion: process.versions.electron ?? 'unknown',
          chromeVersion: process.versions.chrome ?? 'unknown',
          nodeVersion: process.versions.node,
          platform: process.platform,
          simulatorEnabled: engine.getSimulatorAvailability().enabled,
          providerId: provider.id,
          providerModel: provider.model,
          providerOffline: provider.offline,
          providerDegraded: provider.degraded,
        };
      },
    }),
    defineHandler({
      channel: IPC_CHANNELS.listCourses,
      parse: parseNoArgs,
      handle: () => engine.listCourses(),
    }),
    defineHandler({
      channel: IPC_CHANNELS.getCourse,
      parse: parseCourseId,
      handle: (courseId) => engine.getCourse(courseId),
    }),
    defineHandler({
      channel: IPC_CHANNELS.listMaterials,
      parse: parseNoArgs,
      handle: () => engine.listMaterials(),
    }),
    defineHandler({
      channel: IPC_CHANNELS.importMaterial,
      parse: parseImportMaterial,
      handle: (request) => engine.importMaterial(request.fileName, request.content),
    }),
    defineHandler({
      channel: IPC_CHANNELS.startSession,
      parse: parseStartSession,
      handle: (request) => engine.startSession(request.courseId),
    }),
    defineHandler({
      channel: IPC_CHANNELS.endSession,
      parse: parseEndSession,
      handle: (request) => engine.endSession(request),
    }),
    defineHandler({
      channel: IPC_CHANNELS.getCurrentSession,
      parse: parseNoArgs,
      handle: () => engine.getCurrentSession(),
    }),
    defineHandler({
      channel: IPC_CHANNELS.getSessionProgress,
      parse: parseSessionId,
      handle: (sessionId) => engine.getSessionProgress(sessionId),
    }),
    defineHandler({
      channel: IPC_CHANNELS.dispatchEvent,
      parse: parseDispatchRequest,
      handle: (request) => engine.dispatch(request),
    }),
    defineHandler({
      channel: IPC_CHANNELS.listEvents,
      parse: parseSessionId,
      handle: (sessionId) => engine.listEvents(sessionId),
    }),
    defineHandler({
      channel: IPC_CHANNELS.getCheckpoint,
      parse: parseSessionId,
      handle: (sessionId) => engine.getLatestCheckpoint(sessionId),
    }),
    defineHandler({
      channel: IPC_CHANNELS.createCheckpoint,
      parse: parseSessionId,
      handle: (sessionId) => engine.createCheckpoint(sessionId),
    }),
    defineHandler({
      channel: IPC_CHANNELS.getResumeCard,
      parse: parseSessionId,
      handle: (sessionId) => engine.getResumeCard(sessionId),
    }),
    defineHandler({
      channel: IPC_CHANNELS.acceptResume,
      parse: parseResumeDecision,
      handle: (request) => engine.acceptResume(request.checkpointId),
    }),
    defineHandler({
      channel: IPC_CHANNELS.dismissResume,
      parse: parseResumeDecision,
      handle: (request) => engine.dismissResume(request.checkpointId),
    }),
    defineHandler({
      channel: IPC_CHANNELS.getDashboard,
      parse: parseNoArgs,
      handle: () => engine.getDashboard(),
    }),
    defineHandler({
      channel: IPC_CHANNELS.listOutcomes,
      parse: parseSessionId,
      handle: (sessionId) => engine.listOutcomes(sessionId),
    }),
    defineHandler({
      channel: IPC_CHANNELS.resolveIntervention,
      parse: parseResolveIntervention,
      handle: (request) => engine.resolveIntervention(request),
    }),
    defineHandler({
      channel: IPC_CHANNELS.getPendingRescue,
      parse: parseSessionId,
      handle: (sessionId) => engine.getPendingRescue(sessionId),
    }),
    defineHandler({
      channel: IPC_CHANNELS.resolveRescue,
      parse: parseResolveRescue,
      handle: (request) => engine.resolveRescue(request),
    }),
    defineHandler({
      channel: IPC_CHANNELS.getSimulatorAvailability,
      parse: parseNoArgs,
      handle: () => engine.getSimulatorAvailability(),
    }),
    defineHandler({
      channel: IPC_CHANNELS.simulateEvent,
      parse: parseSimulatorCommand,
      handle: (command, invokeEvent) => {
        const response = engine.simulate(command);
        /*
         * Pushed to the renderer rather than left for a tick to carry.
         *
         * The renderer refreshes on its own actions and on whatever the five-second tick's
         * transitions happen to push, so a simulation it did not click itself stays invisible until
         * some unrelated state change arrives — which is how the long resume card stayed off screen
         * while the engine had already offered it (#192). `subscribeToEvents` is subscribed to exactly
         * this channel, waiting for events the renderer did not cause; this is one of them.
         */
        pushEventToRenderer(invokeEvent.sender, response);
        return response;
      },
    }),
    defineHandler({
      channel: IPC_CHANNELS.getBridgeInfo,
      parse: parseNoArgs,
      handle: () => bridgeInfo(),
    }),
    defineHandler({
      channel: IPC_CHANNELS.getSettings,
      parse: parseNoArgs,
      handle: () => engine.getSettings(),
    }),
    defineHandler({
      channel: IPC_CHANNELS.setLocale,
      parse: parseSetLocale,
      handle: (request) => engine.setLocale(request.locale),
    }),
    defineHandler({
      channel: IPC_CHANNELS.setTheme,
      parse: parseSetTheme,
      handle: (request) => engine.setTheme(request.theme),
    }),
    defineHandler({
      channel: IPC_CHANNELS.setShowMaterialText,
      parse: parseSetShowMaterialText,
      handle: (request) => engine.setShowMaterialText(request.showMaterialText),
    }),
    defineHandler({
      channel: IPC_CHANNELS.setAmbientSound,
      parse: parseSetAmbientSound,
      handle: (request) => engine.setAmbientSound(request.ambientSound),
    }),
    /*
     * The data controls go to the service rather than to the engine.
     *
     * They are about the file: its path, the folder it is in, and deleting it. The engine is what knows
     * about courses and sessions, and it has no business knowing where it is stored.
     */
    defineHandler({
      channel: IPC_CHANNELS.getDataInfo,
      parse: parseNoArgs,
      handle: () => service.getDataInfo(),
    }),
    defineHandler({
      channel: IPC_CHANNELS.openDataFolder,
      parse: parseNoArgs,
      handle: () => service.openDataFolder(),
    }),
    defineHandler({
      channel: IPC_CHANNELS.deleteAllData,
      parse: parseDeleteAllData,
      handle: () => service.deleteAllData(),
    }),
    defineHandler({
      channel: IPC_CHANNELS.getInsights,
      parse: parseInsightsRequest,
      handle: (request) => engine.getInsights(request.range),
    }),
    defineHandler({
      channel: IPC_CHANNELS.memorySummary,
      parse: parseSessionId,
      handle: (sessionId) => engine.getMemorySummary(sessionId),
    }),
    defineHandler({
      channel: IPC_CHANNELS.memoryList,
      parse: parseMemoryList,
      handle: ({ sessionId, scope }) => engine.listMemory(sessionId, scope),
    }),
    defineHandler({
      channel: IPC_CHANNELS.memoryClear,
      parse: parseSessionId,
      handle: (sessionId) => engine.clearAgentMemory(sessionId, { actor: 'user' }),
    }),
    defineHandler({
      channel: IPC_CHANNELS.preferencesList,
      parse: parseSessionId,
      handle: (sessionId) => engine.listPreferences(sessionId),
    }),
    defineHandler({
      channel: IPC_CHANNELS.preferenceDelete,
      parse: parsePreferenceDelete,
      handle: (request) => engine.deletePreference(request),
    }),
    defineHandler({
      channel: IPC_CHANNELS.memoryCleanup,
      parse: parseNoArgs,
      handle: () => engine.cleanupOldEpisodicMemory({ actor: 'user' }),
    }),
    defineHandler({
      channel: IPC_CHANNELS.proposeStructuralChange,
      parse: parseProposeStructuralChange,
      handle: (request, invokeEvent) => {
        const response = engine.proposeStructuralChange(request);
        /*
         * Pushed for the same reason the simulator's result is (#192): the renderer refreshes on
         * its own actions and on pushed events, and a proposal created here is neither — without
         * this push the confirmation dialog would never know there was anything to confirm. The
         * surrounding response is the dispatch shape this channel carries; only `event` is read on
         * the other side, and proposing itself changes no state, writes no checkpoint and offers
         * no rescue — which is exactly what the other fields say.
         */
        if (response.event !== null) {
          pushEventToRenderer(invokeEvent.sender, {
            event: response.event,
            state: engine.getCurrentSession()?.session.state ?? 'READY',
            checkpoint: null,
            resumeCard: null,
            decision: null,
            interventionId: null,
            rescue: null,
          });
        }
        return response;
      },
    }),
    defineHandler({
      channel: IPC_CHANNELS.confirmProposal,
      parse: parseConfirmProposal,
      handle: (request) => engine.confirmProposal(request),
    }),
    defineHandler({
      channel: IPC_CHANNELS.executeProposal,
      parse: parseExecuteProposal,
      handle: (request) => engine.executeProposal(request),
    }),
    defineHandler({
      channel: IPC_CHANNELS.askTutor,
      parse: parseTutorAsk,
      handle: (request) => engine.askTutor(request),
    }),
  ] as const;
}

export function pushEventToRenderer(target: WebContents, response: DispatchEventResponse): void {
  if (target.isDestroyed()) return;
  target.send(IPC_CHANNELS.onEvent, response);
}

export function registerIpcHandlers(service: FocusLoopService): () => void {
  const handlers = createHandlers(service);

  for (const handler of handlers) {
    ipcMain.handle(handler.channel, async (event, rawPayload) => {
      const scoped = (handler.parse as (c: string, v: unknown) => unknown)(
        handler.channel,
        rawPayload,
      );
      return (handler.handle as (p: unknown, e: IpcMainInvokeEvent) => unknown)(scoped, event);
    });
  }

  return () => {
    for (const handler of handlers) ipcMain.removeHandler(handler.channel);
  };
}

/** Called by a timer in the main process; broadcasts state changes to windows. */
export function broadcastTick(service: FocusLoopService, windows: readonly BrowserWindow[]): void {
  /*
   * Guarded, and not defensively.
   *
   * The tick is one of the callers with no learner behind it, so it is one the UI cannot protect by refusing
   * to act: it fires every five seconds from a `setInterval` in the main process. The bridge's socket handler
   * is the other one, and it is guarded the same way for the same reason. The store is closed while a deletion
   * replaces the database, and it stays closed if the reopen fails (#10) — a state the learner is told about
   * and that ends with a restart. An uncaught throw from a timer callback is not a no-op there: Electron puts
   * up an error dialog, every five seconds, over the message telling them to restart. Reported once rather than
   * per tick, and a later success clears the flag so a transient failure still says so again.
   */
  let response: DispatchEventResponse | null;
  try {
    response = service.engine.tick();
    tickFailed = false;
  } catch (error) {
    if (!tickFailed) {
      tickFailed = true;
      console.error('FocusLoop could not run a tick; the store is not available:', error);
    }
    return;
  }

  if (response === null) return;
  for (const window of windows) {
    if (window.isDestroyed()) continue;
    pushEventToRenderer(window.webContents, response);
  }
}

/** Whether a tick has already failed, so a closed store is reported once instead of every five seconds. */
let tickFailed = false;
