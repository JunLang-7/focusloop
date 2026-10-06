import type { AgentContextReport } from './agent-context';
import type { Course } from './course';
import type { LearningCheckpoint } from './checkpoint';
import type { DashboardSummary } from './dashboard';
import type { LearningEvent, SessionEndReason } from './events';
import type { InterventionDecision, InterventionOutcome } from './intervention';
import type { RescueView } from './rescue';
import type { InsightsRequest, InsightsSummary } from './insights';
import type { MaterialDocument } from './material';
import type { AppSettings, Locale, ThemePreference } from './settings';
import type { ResumeCardView } from './resume';
import type { LearningSession, SessionProgress } from './session';
import type { LearningState } from './state';
import type { TutorAnswer, TutorAskRequest } from './tutor';
import type { OutboundRequest } from './outbound';
import type {
  AgentProposal,
  AgentProposalKind,
  ConfirmProposalRequest,
  ExecuteProposalRequest,
  ProposalConfirmResult,
  ProposalExecuteResult,
} from './proposal';

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
  getInsights: 'focusloop:insights:get',
  getAgentContext: 'focusloop:agent:context',
  getOutboundRequest: 'focusloop:agent:outbound-request',
  proposeStructuralChange: 'focusloop:agent:propose',
  confirmProposal: 'focusloop:agent:confirm-proposal',
  executeProposal: 'focusloop:agent:execute-proposal',
  askTutor: 'focusloop:tutor:ask',
  listOutcomes: 'focusloop:outcome:list',
  resolveIntervention: 'focusloop:intervention:resolve',
  getPendingRescue: 'focusloop:intervention:pending-rescue',
  resolveRescue: 'focusloop:intervention:resolve-rescue',
  simulateEvent: 'focusloop:simulator:dispatch',
  getSimulatorAvailability: 'focusloop:simulator:available',
  getBridgeInfo: 'focusloop:bridge:info',
  getSettings: 'focusloop:settings:get',
  setLocale: 'focusloop:settings:set-locale',
  setTheme: 'focusloop:settings:set-theme',
  setShowMaterialText: 'focusloop:settings:set-material-text',
  setAmbientSound: 'focusloop:settings:set-ambient-sound',
  getDataInfo: 'focusloop:data:info',
  openDataFolder: 'focusloop:data:open-folder',
  deleteAllData: 'focusloop:data:delete-all',
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
  /** True when the last runtime call failed over to the fallback provider. */
  readonly providerDegraded: boolean;
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
  readonly rescue: RescueView | null;
}

export interface ResolveInterventionRequest {
  readonly interventionId: string;
  readonly accepted: boolean;
  readonly dismissed: boolean;
  readonly taskCompleted: boolean;
  readonly quizOutcome?: 'correct' | 'incorrect' | null;
}

export interface ResolveRescueRequest {
  readonly sessionId: string;
  readonly interventionId: string;
  readonly resolution: 'accept' | 'dismiss' | 'continue';
}

export interface ResolveRescueResponse {
  readonly outcome: InterventionOutcome | null;
  readonly rescue: RescueView | null;
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

export interface ProposeStructuralChangeRequest {
  readonly sessionId: string;
  readonly kind: AgentProposalKind;
  readonly payload: Record<string, unknown>;
  readonly createdBy: string;
  readonly idempotencyKey: string;
  readonly ttlMs?: number;
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

export interface SetLocaleRequest {
  readonly locale: Locale;
}

export interface SetThemeRequest {
  readonly theme: ThemePreference;
}

export interface SetShowMaterialTextRequest {
  readonly showMaterialText: boolean;
}

export interface SetAmbientSoundRequest {
  readonly ambientSound: boolean;
}

/**
 * Where the learner's data is. Both paths are the main process's answer, not the renderer's guess:
 * `directory` is `app.getPath('userData')` and `databasePath` is the file the store actually opened,
 * so what the UI shows cannot drift from where the data is.
 */
export interface DataInfo {
  readonly directory: string;
  readonly databasePath: string;
}

/** `opened` is false when the OS would not show the folder; the renderer says so rather than nothing. */
export interface OpenDataFolderResponse {
  readonly opened: boolean;
}

/**
 * A deletion carries the confirmation the learner pressed, not only the fact that a button was pressed.
 *
 * The dialog is what asks the question. This is what stops every other path to `deleteAllData` from
 * being one call away from an empty database, and it keeps the decision visible on the wire, where the
 * validator can refuse a payload that does not carry it.
 */
export interface ConfirmDeleteDataRequest {
  readonly confirmed: true;
}

/** Why the data is still there. A token the renderer translates, never a sentence from the OS. */
export type DeleteDataFailureReason = 'locked' | 'failed';

/**
 * What the deletion did, in the process's own words.
 *
 * `ok` is what the learner is told, so it is derived from the file being gone rather than from the code
 * path having run: a delete that reports success while the database is still on disk is the one outcome
 * this feature must not have.
 */
export interface DeleteDataResponse {
  readonly ok: boolean;
  readonly reason: DeleteDataFailureReason | null;
  /** The files this call removed, so a report can be checked against the disk rather than trusted. */
  readonly removed: readonly string[];
  /**
   * The files that are still there, which is not the same as "nothing was removed": the database can be
   * gone while a sidecar that holds its page images is not. Empty in the ordinary case.
   *
   * A leftover file is not by itself a reason the app cannot be used again, but it is the state in which
   * that can happen: the reopen has to get past whatever kept the file there. `usable` is what reports it.
   */
  readonly leftBehind: readonly string[];
  /**
   * False when the database could not be opened again after the delete, which is not the same question as
   * `ok`: the learner's data can be gone while nothing in the app works until it is restarted. The two are
   * reported separately because either one can be true on its own.
   */
  readonly usable: boolean;
}

/** Typed, promise-based API exposed as `window.focusloop`. */
export interface FocusLoopApi {
  getAppVersion(): Promise<string>;
  getRuntimeInfo(): Promise<RuntimeInfo>;

  listCourses(): Promise<readonly Course[]>;
  getCourse(courseId: string): Promise<Course | null>;
  importMaterial(request: ImportMaterialRequest): Promise<ImportMaterialResponse>;
  /**
   * The parsed documents behind imported courses. Their sections hold the text that was uploaded,
   * which is the only place it is kept: a course carries concept summaries and tasks, never the
   * material itself.
   */
  listMaterials(): Promise<readonly MaterialDocument[]>;

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
  getPendingRescue(sessionId: string): Promise<RescueView | null>;
  resolveRescue(request: ResolveRescueRequest): Promise<ResolveRescueResponse>;

  getSimulatorAvailability(): Promise<SimulatorAvailability>;
  simulate(command: SimulatorCommand): Promise<DispatchEventResponse>;
  getBridgeInfo(): Promise<BridgeInfo>;

  getSettings(): Promise<AppSettings>;
  setLocale(request: SetLocaleRequest): Promise<AppSettings>;
  setTheme(request: SetThemeRequest): Promise<AppSettings>;
  setShowMaterialText(request: SetShowMaterialTextRequest): Promise<AppSettings>;
  setAmbientSound(request: SetAmbientSoundRequest): Promise<AppSettings>;

  /**
   * Where the local database is. Local-first, so this is the whole of it: one directory, one file, and
   * a button that opens the folder so the learner can see it for themselves instead of trusting a page.
   */
  getDataInfo(): Promise<DataInfo>;
  openDataFolder(): Promise<OpenDataFolderResponse>;
  /**
   * Deletes everything FocusLoop has stored and returns the app to a first-run state.
   *
   * Takes the confirmation rather than assuming it, and reports what happened instead of promising it:
   * see `DeleteDataResponse`.
   */
  deleteAllData(request: ConfirmDeleteDataRequest): Promise<DeleteDataResponse>;

  getInsights(request: InsightsRequest): Promise<InsightsSummary>;
  /**
   * What the agent would be given about the current moment, and what it would not.
   *
   * Built in the main process because that is where the course, the material and the event log are.
   * The renderer only displays it — importing `@focusloop/agent-core` there would drag the engine,
   * and `node:crypto`, into a sandboxed page that has neither.
   */
  getAgentContext(): Promise<AgentContextReport>;
  /**
   * Last outbound request for this session — the second inspector view.
   *
   * Development-only content (learner text); never persisted. Returns null when
   * nothing has been sent yet for the session.
   */
  getOutboundRequest(sessionId: string): Promise<OutboundRequest | null>;

  /**
   * Builds a structural proposal bound to the session's current state.
   * The learner must `confirmProposal` before `executeProposal` will run it.
   */
  proposeStructuralChange(request: ProposeStructuralChangeRequest): Promise<AgentProposal | null>;
  confirmProposal(request: ConfirmProposalRequest): Promise<ProposalConfirmResult>;
  executeProposal(request: ExecuteProposalRequest): Promise<ProposalExecuteResult>;

  /**
   * Asks the tutor about the step the learner is on, and gets back either an answer, a rejection or a
   * fallback.
   *
   * One channel rather than three, because the result is a discriminated union the renderer has to
   * branch on anyway: splitting "ask" from "ask again" would put the retry budget on the wrong side of
   * the boundary. **The renderer sends the question and nothing else** — the transcript lives in the
   * main process, because it becomes text the model reads as its own prior output.
   */
  askTutor(request: TutorAskRequest): Promise<TutorAnswer>;

  /** Returns an unsubscribe function. */
  onEvent(listener: (event: LearningEvent) => void): () => void;
}
