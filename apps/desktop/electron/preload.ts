import { contextBridge, ipcRenderer } from 'electron';
import {
  IPC_CHANNELS,
  type DispatchEventResponse,
  type FocusLoopApi,
  type LearningEvent,
} from '@focusloop/shared-types';
import { payload } from './ipc/payloads';

/**
 * The bridge. Only these methods exist on `window.focusloop`; the renderer can
 * never name an arbitrary channel nor reach Node.
 *
 * Every payload is built by the shared `payload` helpers, which are the same
 * shapes the main process validates. That is what keeps the two sides of the
 * bridge from drifting apart.
 */
const api: FocusLoopApi = {
  getAppVersion: () => ipcRenderer.invoke(IPC_CHANNELS.getAppVersion, payload.none()),
  getRuntimeInfo: () => ipcRenderer.invoke(IPC_CHANNELS.getRuntimeInfo, payload.none()),

  listCourses: () => ipcRenderer.invoke(IPC_CHANNELS.listCourses, payload.none()),
  getCourse: (courseId) => ipcRenderer.invoke(IPC_CHANNELS.getCourse, payload.courseId(courseId)),
  importMaterial: (request) =>
    ipcRenderer.invoke(
      IPC_CHANNELS.importMaterial,
      payload.importMaterial(request.fileName, request.content),
    ),

  startSession: (request) =>
    ipcRenderer.invoke(IPC_CHANNELS.startSession, payload.startSession(request.courseId)),
  endSession: (request) =>
    ipcRenderer.invoke(
      IPC_CHANNELS.endSession,
      payload.endSession(request.sessionId, request.reason),
    ),
  getCurrentSession: () => ipcRenderer.invoke(IPC_CHANNELS.getCurrentSession, payload.none()),
  getSessionProgress: (sessionId) =>
    ipcRenderer.invoke(IPC_CHANNELS.getSessionProgress, payload.sessionId(sessionId)),

  dispatchEvent: (request) =>
    ipcRenderer.invoke(IPC_CHANNELS.dispatchEvent, payload.dispatchEvent(request)),
  listEvents: (sessionId) =>
    ipcRenderer.invoke(IPC_CHANNELS.listEvents, payload.sessionId(sessionId)),

  getLatestCheckpoint: (sessionId) =>
    ipcRenderer.invoke(IPC_CHANNELS.getCheckpoint, payload.sessionId(sessionId)),
  createCheckpoint: (sessionId) =>
    ipcRenderer.invoke(IPC_CHANNELS.createCheckpoint, payload.sessionId(sessionId)),

  getResumeCard: (sessionId) =>
    ipcRenderer.invoke(IPC_CHANNELS.getResumeCard, payload.sessionId(sessionId)),
  acceptResume: (request) =>
    ipcRenderer.invoke(IPC_CHANNELS.acceptResume, payload.resumeDecision(request.checkpointId)),
  dismissResume: (request) =>
    ipcRenderer.invoke(IPC_CHANNELS.dismissResume, payload.resumeDecision(request.checkpointId)),

  getDashboard: () => ipcRenderer.invoke(IPC_CHANNELS.getDashboard, payload.none()),
  listOutcomes: (sessionId) =>
    ipcRenderer.invoke(IPC_CHANNELS.listOutcomes, payload.sessionId(sessionId)),
  resolveIntervention: (request) =>
    ipcRenderer.invoke(IPC_CHANNELS.resolveIntervention, payload.resolveIntervention(request)),

  getSimulatorAvailability: () =>
    ipcRenderer.invoke(IPC_CHANNELS.getSimulatorAvailability, payload.none()),
  simulate: (command) =>
    ipcRenderer.invoke(
      IPC_CHANNELS.simulateEvent,
      payload.simulatorCommand(command.command, command.sessionId),
    ),
  getBridgeInfo: () => ipcRenderer.invoke(IPC_CHANNELS.getBridgeInfo, payload.none()),

  getSettings: () => ipcRenderer.invoke(IPC_CHANNELS.getSettings, payload.none()),
  setLocale: (request) =>
    ipcRenderer.invoke(IPC_CHANNELS.setLocale, payload.setLocale(request.locale)),

  onEvent: (listener: (event: LearningEvent) => void) => {
    const handler = (_event: unknown, response: DispatchEventResponse): void => {
      listener(response.event);
    };
    ipcRenderer.on(IPC_CHANNELS.onEvent, handler);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.onEvent, handler);
    };
  },
};

contextBridge.exposeInMainWorld('focusloop', api);
