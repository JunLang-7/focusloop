import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent, type WebContents } from 'electron';
import {
  IPC_CHANNELS,
  BRIDGE_PROTOCOL_VERSION,
  type DispatchEventResponse,
} from '@focusloop/shared-types';
import type { FocusLoopService } from '../service';
import {
  parseCourseId,
  parseDispatchRequest,
  parseEndSession,
  parseImportMaterial,
  parseInsightsRequest,
  parseNoArgs,
  parseResolveIntervention,
  parseResumeDecision,
  parseSessionId,
  parseSetLocale,
  parseSimulatorCommand,
  parseStartSession,
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
      channel: IPC_CHANNELS.getSimulatorAvailability,
      parse: parseNoArgs,
      handle: () => engine.getSimulatorAvailability(),
    }),
    defineHandler({
      channel: IPC_CHANNELS.simulateEvent,
      parse: parseSimulatorCommand,
      handle: (command) => engine.simulate(command),
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
      channel: IPC_CHANNELS.getInsights,
      parse: parseInsightsRequest,
      handle: (request) => engine.getInsights(request.range),
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
  const response = service.engine.tick();
  if (response === null) return;
  for (const window of windows) {
    if (window.isDestroyed()) continue;
    pushEventToRenderer(window.webContents, response);
  }
}
