import type { Course } from './course';
import type { LearningCheckpoint } from './checkpoint';
import type { DashboardSummary } from './dashboard';
import type { LearningEvent, SessionEndReason } from './events';
import type { InterventionDecision, InterventionOutcome } from './intervention';
import type { ResumeCardView } from './resume';
import type { LearningSession, SessionProgress } from './session';
import type { LearningState } from './state';

/**
 * The ONLY surface the renderer may reach. Everything else in the renderer runs
 * with `contextIsolation: true` and `nodeIntegration: false`.
 */
export const IPC_CHANNELS = {
  getAppVersion: 'focusloop:app:get-version',
  getRuntimeInfo: 'focusloop:app:get-runtime-info',
  listCourses: 'focusloop:course:list',
  getCourse: 'focusloop:course:get',
  importMaterial: 'focusloop:material:import',
  listMaterials: 'focusloop:material:list',
  startSession: 'focusloop:session:start',
  endSession: 'focusloop:session:end',
  getCurrentSession: 'focusloop:session:current',
  getSessionProgress: 'focusloop:session:progress',
  dispatchEvent: 'focusloop:event:dispatch',
  listEvents: 'focusloop:event:list',
  getCheckpoint: 'focusloop:checkpoint:latest',
  createCheckpoint: 'focusloop:checkpoint:create',
  getResumeCard: 'focusloop:resume:get',
  acceptResume: 'focusloop:resume:accept',
  dismissResume: 'focusloop:resume:dismiss',
  getDashboard: 'focusloop:dashboard:get',
  listOutcomes: 'focusloop:outcome:list',
  resolveIntervention: 'focusloop:intervention:resolve',
  simulateEvent: 'focusloop:simulator:dispatch',
  getSimulatorAvailability: 'focusloop:simulator:available',
  getBridgeInfo: 'focusloop:bridge:info',
  subscribeEvents: 'focusloop:event:subscribe',
  unsubscribeEvents: 'focusloop:event:unsubscribe',
  onEvent: 'focusloop:event:push',
} as const;

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];

export interface RuntimeInfo {
  readonly appVersion: string;
  readonly electronVersion: string;
  readonly chromeVersion: string;
  readonly nodeVersion: string;
  readonly platform: string;
  readonly simulatorEnabled: boolean;
  readonly providerId: string;
  readonly providerModel: string;
  readonly providerOffline: boolean;
}

export interface ImportMaterialRequest {
  readonly fileName: string;
  readonly content: string;
}

export interface ImportMaterialResponse {
  readonly materialId: string;
  readonly title: string;
  readonly conceptsCreated: number;
  readonly microTasksCreated: number;
  readonly warnings: readonly string[];
}

export interface StartSessionRequest {
  readonly courseId: string;
}

export interface StartSessionResponse {
  readonly session: LearningSession;
  readonly checkpoint: LearningCheckpoint | null;
  readonly resumeCard: ResumeCardView | null;
}

export interface EndSessionRequest {
  readonly sessionId: string;
  readonly reason: SessionEndReason;
}

export interface DispatchEventRequest {
  readonly sessionId: string;
  readonly type: LearningEvent['type'];
  readonly source: LearningEvent['source'];
  readonly payload: Record<string, unknown>;
  /** Optional ISO timestamp; defaults to now. Used by deterministic replay. */
  readonly at?: string;
  /**
   * Optional caller-supplied id. The desktop–extension bridge sends the id it
   * already assigned so a reconnect cannot apply the same event twice.
   */
  readonly eventId?: string;
}

export interface DispatchEventResponse {
  readonly event: LearningEvent;
  readonly state: LearningState;
  readonly checkpoint: LearningCheckpoint | null;
  readonly resumeCard: ResumeCardView | null;
  /** Non-null whenever the policy produced something other than NO_ACTION. */
  readonly decision: InterventionDecision | null;
  readonly interventionId: string | null;
}

export interface ResolveInterventionRequest {
  readonly interventionId: string;
  readonly accepted: boolean;
  readonly dismissed: boolean;
  readonly taskCompleted: boolean;
  readonly quizOutcome?: 'correct' | 'incorrect' | null;
}

export interface SessionSnapshot {
  readonly session: LearningSession;
  readonly progress: SessionProgress;
  readonly courseTitle: string | null;
  readonly checkpoints: readonly LearningCheckpoint[];
}

export interface ResumeDecisionRequest {
  readonly checkpointId: string;
}

export interface ResumeDecisionResponse {
  readonly timing: ResumeCardView['timing'];
  readonly state: LearningState;
  readonly outcome: InterventionOutcome | null;
}

export interface SimulatorCommand {
  readonly command: 'distraction' | 'return' | 'confusion' | 'overload' | 'success';
  readonly sessionId: string;
}

export interface SimulatorAvailability {
  readonly enabled: boolean;
  readonly reason: string;
}

/**
 * Everything the extension needs to pair with this desktop instance.
 * The token is per-run and only valid on loopback.
 */
export interface BridgeInfo {
  readonly running: boolean;
  readonly url: string;
  readonly token: string;
  readonly protocolVersion: number;
  readonly connections: number;
}

/** Typed, promise-based API exposed as `window.focusloop`. */
export interface FocusLoopApi {
  getAppVersion(): Promise<string>;
  getRuntimeInfo(): Promise<RuntimeInfo>;

  listCourses(): Promise<readonly Course[]>;
  getCourse(courseId: string): Promise<Course | null>;
  importMaterial(request: ImportMaterialRequest): Promise<ImportMaterialResponse>;

  startSession(request: StartSessionRequest): Promise<StartSessionResponse>;
  endSession(request: EndSessionRequest): Promise<LearningSession>;
  getCurrentSession(): Promise<SessionSnapshot | null>;
  getSessionProgress(sessionId: string): Promise<SessionProgress | null>;

  dispatchEvent(request: DispatchEventRequest): Promise<DispatchEventResponse>;
  listEvents(sessionId: string): Promise<readonly LearningEvent[]>;

  getLatestCheckpoint(sessionId: string): Promise<LearningCheckpoint | null>;
  createCheckpoint(sessionId: string): Promise<LearningCheckpoint>;

  getResumeCard(sessionId: string): Promise<ResumeCardView | null>;
  acceptResume(request: ResumeDecisionRequest): Promise<ResumeDecisionResponse>;
  dismissResume(request: ResumeDecisionRequest): Promise<ResumeDecisionResponse>;

  getDashboard(): Promise<DashboardSummary>;
  listOutcomes(sessionId: string): Promise<readonly InterventionOutcome[]>;
  resolveIntervention(request: ResolveInterventionRequest): Promise<InterventionOutcome | null>;

  getSimulatorAvailability(): Promise<SimulatorAvailability>;
  simulate(command: SimulatorCommand): Promise<DispatchEventResponse>;
  getBridgeInfo(): Promise<BridgeInfo>;

  /** Returns an unsubscribe function. */
  onEvent(listener: (event: LearningEvent) => void): () => void;
}
