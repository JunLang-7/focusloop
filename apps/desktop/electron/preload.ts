import { contextBridge, ipcRenderer } from 'electron';
import {
  IPC_CHANNELS,
  type DispatchEventResponse,
  type FocusLoopApi,
  type LearningEvent,
} from '@focusloop/shared-types';

/**
 * The bridge. Only these methods exist on `window.focusloop`; the renderer can
 * never name an arbitrary channel nor reach Node.
 */
const api: FocusLoopApi = {
  getAppVersion: () => ipcRenderer.invoke(IPC_CHANNELS.getAppVersion),
  getRuntimeInfo: () => ipcRenderer.invoke(IPC_CHANNELS.getRuntimeInfo),

  listCourses: () => ipcRenderer.invoke(IPC_CHANNELS.listCourses),
  getCourse: (courseId) => ipcRenderer.invoke(IPC_CHANNELS.getCourse, courseId),
  importMaterial: (request) => ipcRenderer.invoke(IPC_CHANNELS.importMaterial, request),

  startSession: (request) => ipcRenderer.invoke(IPC_CHANNELS.startSession, request),
  endSession: (request) => ipcRenderer.invoke(IPC_CHANNELS.endSession, request),
  getCurrentSession: () => ipcRenderer.invoke(IPC_CHANNELS.getCurrentSession),
  getSessionProgress: (sessionId) => ipcRenderer.invoke(IPC_CHANNELS.getSessionProgress, sessionId),

  dispatchEvent: (request) => ipcRenderer.invoke(IPC_CHANNELS.dispatchEvent, request),
  listEvents: (sessionId) => ipcRenderer.invoke(IPC_CHANNELS.listEvents, sessionId),

  getLatestCheckpoint: (sessionId) => ipcRenderer.invoke(IPC_CHANNELS.getCheckpoint, sessionId),
  createCheckpoint: (sessionId) => ipcRenderer.invoke(IPC_CHANNELS.createCheckpoint, sessionId),

  getResumeCard: (sessionId) => ipcRenderer.invoke(IPC_CHANNELS.getResumeCard, sessionId),
  acceptResume: (request) => ipcRenderer.invoke(IPC_CHANNELS.acceptResume, request),
  dismissResume: (request) => ipcRenderer.invoke(IPC_CHANNELS.dismissResume, request),

  getDashboard: () => ipcRenderer.invoke(IPC_CHANNELS.getDashboard),
  listOutcomes: (sessionId) => ipcRenderer.invoke(IPC_CHANNELS.listOutcomes, sessionId),
  resolveIntervention: (request) => ipcRenderer.invoke(IPC_CHANNELS.resolveIntervention, request),

  getSimulatorAvailability: () => ipcRenderer.invoke(IPC_CHANNELS.getSimulatorAvailability),
  simulate: (command) => ipcRenderer.invoke(IPC_CHANNELS.simulateEvent, command),
  getBridgeInfo: () => ipcRenderer.invoke(IPC_CHANNELS.getBridgeInfo),

  onEvent: (listener: (event: LearningEvent) => void) => {
    const handler = (_event: unknown, payload: DispatchEventResponse): void => {
      listener(payload.event);
    };
    ipcRenderer.on(IPC_CHANNELS.onEvent, handler);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.onEvent, handler);
    };
  },
};

contextBridge.exposeInMainWorld('focusloop', api);
