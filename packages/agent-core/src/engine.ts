import { randomUUID } from 'node:crypto';
import type {
  AgentContextReport,
  Course,
  DashboardSummary,
  DispatchEventRequest,
  DispatchEventResponse,
  EndSessionRequest,
  ImportMaterialResponse,
  InsightRange,
  InsightsSummary,
  Intervention,
  InterventionOutcome,
  LearningCheckpoint,
  LearningEvent,
  LearningSession,
  MaterialDocument,
  MicroTask,
  ResolveInterventionRequest,
  ResumeCardView,
  ResumeDecisionResponse,
  SessionSnapshot,
  SimulatorAvailability,
  SimulatorCommand,
  StartSessionResponse,
  ThemePreference,
} from '@focusloop/shared-types';
import { findMaterialForCourse, message } from '@focusloop/shared-types';
import { buildAgentContext } from './agent-context';
import {
  DEFAULT_INSIGHT_RANGE,
  coerceLocale,
  coerceShowMaterialText,
  coerceTheme,
} from '@focusloop/shared-types';
import type { AppSettings, Locale } from '@focusloop/shared-types';
import {
  DEFAULT_STATE_ENGINE_CONFIG,
  computeSessionProgress,
  createInitialState,
  evaluateTimeBasedState,
  reduceState,
  type StateEngineConfig,
  type StateEngineState,
} from '@focusloop/learning-state';
import { buildCheckpoint, buildResumeCard, shouldOfferResume } from '@focusloop/continuity';
import {
  DEFAULT_POLICY_CONFIG,
  createIntervention,
  decideIntervention,
  recordOutcome,
  type InterventionPolicyConfig,
} from '@focusloop/intervention-policy';
import { parseMaterial } from '@focusloop/material-parser';
import type { FocusLoopStore, SessionRecord } from '@focusloop/persistence';
import {
  completeWithFallback,
  type CompleteWithFallbackResult,
  type ProviderSelection,
} from '@focusloop/llm-provider';
import { buildDashboardSummary } from './dashboard';
import { buildInsightsSummary, type InsightsSessionSource } from './insights';
import { demoCourse, demoInterruption } from './demo-course';
import { generateCourse } from './micro-task-generator';

/** The `app_meta` key the interface language is stored under. */
export const LOCALE_KEY = 'locale';

/** The `app_meta` key the theme preference is stored under. */
export const THEME_KEY = 'theme';

/** The `app_meta` key the "show the imported text" preference is stored under. */
export const SHOW_MATERIAL_TEXT_KEY = 'show-material-text';

/**
 * A request the engine refuses, carrying the code the caller branches on — so a rejection is a value
 * rather than a message to parse.
 */
export class EngineError extends Error {
  readonly code:
    'session-not-found' | 'course-not-found' | 'checkpoint-not-found' | 'simulator-disabled';

  constructor(code: EngineError['code'], message: string) {
    super(message);
    this.name = 'EngineError';
    this.code = code;
  }
}

export interface FocusLoopEngineOptions {
  readonly store: FocusLoopStore;
  readonly providers: ProviderSelection;
  /** Injected clock so sessions are reproducible in tests. */
  readonly clock?: () => string;
  readonly idFactory?: () => string;
  readonly stateConfig?: Partial<StateEngineConfig>;
  readonly policyConfig?: Partial<InterventionPolicyConfig>;
  readonly simulatorEnabled?: boolean;
}

/**
 * Application service. Every rule lives in a pure package; this class only
 * wires them to persistence and the clock.
 */
export class FocusLoopEngine {
  private readonly store: FocusLoopStore;
  private readonly providers: ProviderSelection;
  private readonly clock: () => string;
  private readonly idFactory: () => string;
  private readonly simulatorEnabled: boolean;
  private readonly stateConfig: Partial<StateEngineConfig>;
  private readonly policyConfig: Partial<InterventionPolicyConfig>;

  constructor(options: FocusLoopEngineOptions) {
    this.store = options.store;
    this.providers = options.providers;
    this.clock = options.clock ?? (() => new Date().toISOString());
    this.idFactory = options.idFactory ?? (() => randomUUID());
    this.stateConfig = options.stateConfig ?? {};
    this.policyConfig = options.policyConfig ?? {};
    this.simulatorEnabled = options.simulatorEnabled ?? true;
  }

  initialize(): void {
    this.store.initialize();
  }

  /** Idempotent: safe on every boot. */
  seedBuiltInCourses(): void {
    this.store.saveCourse(demoCourse(), { source: 'builtin' });
  }

  // --------------------------------------------------------------- catalogue

  listCourses(): Course[] {
    return this.store.listCourses();
  }

  getCourse(courseId: string): Course | null {
    return this.store.getCourse(courseId);
  }

  importMaterial(fileName: string, content: string): ImportMaterialResponse {
    const now = this.clock();
    const { document, warnings } = parseMaterial({ fileName, content, now });

    const existing = this.store.getMaterialByHash(document.contentHash);
    const material: MaterialDocument = existing ?? document;
    if (existing === null) this.store.saveMaterial(material);

    const generated = generateCourse(material);
    const courseExists = this.store.getCourse(generated.course.id) !== null;
    if (!courseExists) {
      this.store.saveCourse(generated.course, { source: 'imported', materialId: material.id });
    }

    return {
      materialId: material.id,
      title: material.title,
      conceptsCreated: courseExists ? 0 : generated.course.concepts.length,
      microTasksCreated: courseExists ? 0 : generated.course.microTasks.length,
      warnings: [...warnings, ...generated.warnings],
    };
  }

  listMaterials(): MaterialDocument[] {
    return this.store.listMaterials();
  }

  // ---------------------------------------------------------------- sessions

  startSession(courseId: string): StartSessionResponse {
    // Validated before anything is ended, so a bad request cannot cost the learner the
    // session they are in.
    const course = this.store.getCourse(courseId);
    if (course === null) {
      throw new EngineError('course-not-found', `Unknown course: ${courseId}`);
    }

    /*
     * One session at a time.
     *
     * Starting another ends the running one first. Two active sessions made "the current
     * session" ambiguous — `getActiveSession` picked one of them, newest first — so ending
     * the newest silently handed the application back to the one the learner had already
     * left, which is what made "no session running" unreachable.
     *
     * `reason: 'user'` rather than a new vocabulary member: the learner is the one who
     * pressed Start. The ended session keeps its events, progress and checkpoint; only its
     * `endedAt` is set, so nothing is destroyed by switching courses.
     */
    const running = this.store.getActiveSession();
    if (running !== null) {
      this.endSession({ sessionId: running.session.id, reason: 'user' });
    }

    const now = this.clock();
    const sessionId = this.idFactory();
    const event: LearningEvent = {
      id: this.idFactory(),
      sessionId,
      at: now,
      type: 'SESSION_STARTED',
      source: 'system',
      payload: { courseId, sessionId },
    };

    const engineState = reduceState(createInitialState(now), event, this.stateConfig).state;
    const session = toSession(engineState, { id: sessionId, courseId, startedAt: now }, now);

    const persist = this.store.transaction(() => {
      this.store.appendEvent(event);
      this.store.saveSession({ session, engineState });
    });
    persist();

    return { session, checkpoint: null, resumeCard: null };
  }

  endSession(request: EndSessionRequest): LearningSession {
    const response = this.dispatch({
      sessionId: request.sessionId,
      type: 'SESSION_ENDED',
      source: 'user',
      payload: { reason: request.reason },
    });
    const record = this.requireSession(request.sessionId);
    const session: LearningSession = { ...record.session, endedAt: response.event.at };
    this.store.saveSession({ session, engineState: record.engineState });
    return session;
  }

  /**
   * The session that is running, or `null`.
   *
   * Deliberately not "the most recent session". The fallback to `getLatestSession` read as
   * a convenience, but it made a finished session look live: the workspace kept its End
   * session button, the home page offered to continue it, and its resume card was fetched
   * again on every reload — so ending a session left the card on screen over the app.
   */
  getCurrentSession(): SessionSnapshot | null {
    const record = this.store.getActiveSession();
    if (record === null) return null;
    return this.snapshot(record);
  }

  /**
   * What the agent would be given about the current moment, and what it would not (AG1).
   *
   * This belongs here rather than in the renderer. The builder needs the course, the material and the
   * event log, and the renderer has none of them directly — it has only what it was sent. Assembling
   * the context in the renderer would also mean the debug view could show something the agent never
   * receives, which is the one failure an inspector must not have.
   */
  getAgentContext(): AgentContextReport {
    const snapshot = this.getCurrentSession();
    if (snapshot === null) {
      return buildAgentContext({
        session: null,
        progress: null,
        course: null,
        courseCount: this.listCourses().length,
        material: null,
        events: [],
        checkpoint: null,
        learningState: 'READY',
      });
    }

    const { session } = snapshot;
    const course = this.getCourse(session.courseId);
    return buildAgentContext({
      session,
      progress: snapshot.progress,
      course,
      courseCount: this.listCourses().length,
      material: findMaterialForCourse(this.listMaterials(), session.courseId),
      events: this.listEvents(session.id),
      checkpoint: this.getLatestCheckpoint(session.id),
      learningState: session.state,
    });
  }

  getSessionProgress(sessionId: string) {
    const record = this.store.getSession(sessionId);
    if (record === null) return null;
    const course = this.store.getCourse(record.session.courseId);
    return computeSessionProgress({
      sessionId: record.session.id,
      startedAt: record.session.startedAt,
      endedAt: record.session.endedAt,
      totalTasks: course?.microTasks.length ?? 0,
      completedTaskIds: record.engineState.completedTaskIds,
      now: this.clock(),
    });
  }

  private snapshot(record: SessionRecord): SessionSnapshot {
    const course = this.store.getCourse(record.session.courseId);
    const progress = computeSessionProgress({
      sessionId: record.session.id,
      startedAt: record.session.startedAt,
      endedAt: record.session.endedAt,
      totalTasks: course?.microTasks.length ?? 0,
      completedTaskIds: record.engineState.completedTaskIds,
      now: this.clock(),
    });
    return {
      session: record.session,
      progress,
      courseTitle: course?.title ?? null,
      checkpoints: this.store.listCheckpoints(record.session.id),
    };
  }

  private requireSession(sessionId: string): SessionRecord {
    const record = this.store.getSession(sessionId);
    if (record === null) {
      throw new EngineError('session-not-found', `Unknown session: ${sessionId}`);
    }
    return record;
  }

  // ----------------------------------------------------------------- events

  /**
   * The single write path. Ordering matters: dedupe, reduce, persist, then
   * checkpoint/resume, then policy.
   */
  dispatch(request: DispatchEventRequest): DispatchEventResponse {
    const record = this.requireSession(request.sessionId);
    const course = this.store.getCourse(record.session.courseId);
    const at = request.at ?? this.clock();

    /*
     * SAFETY: `type` and `source` are already members of the union — the IPC boundary and the bridge
     * both check the type against LEARNING_EVENT_TYPES before a request reaches the engine — so the
     * only thing the compiler cannot see is that `payload` matches the member its type names. That
     * shape is the caller's contract, and the per-event payload builders are what satisfy it.
     */
    const event = {
      id: request.eventId ?? this.idFactory(),
      sessionId: request.sessionId,
      at,
      type: request.type,
      source: request.source,
      payload: request.payload ?? {},
    } as unknown as LearningEvent;

    const stored = this.store.appendEvent(event);
    if (!stored) {
      // Duplicate / replayed event: report the current truth without moving.
      return {
        event,
        state: record.engineState.state,
        checkpoint: this.store.getLatestCheckpoint(request.sessionId),
        resumeCard: this.getResumeCard(request.sessionId),
        decision: null,
        interventionId: null,
      };
    }

    const reduced = reduceState(record.engineState, event, this.stateConfig);
    const engineState = reduced.state;

    const session = toSession(engineState, record.session, at);
    this.store.saveSession({ session, engineState });

    const resume = this.ensureResumeArtifacts(session, course, engineState, at);
    const policy = this.applyPolicy(session, course, engineState, at);

    return {
      event,
      state: engineState.state,
      checkpoint: resume.checkpoint,
      resumeCard: resume.resumeCard,
      decision: policy.decision,
      interventionId: policy.interventionId,
    };
  }

  listEvents(sessionId: string): LearningEvent[] {
    return this.store.listEvents(sessionId);
  }

  /**
   * Time-based evaluation. The host calls this on a tick; it is what turns
   * "away for 20s" or "idle for 2 minutes" into an interruption without an
   * event having to arrive.
   */
  tick(at?: string): DispatchEventResponse | null {
    const record = this.store.getActiveSession();
    if (record === null) return null;

    const now = at ?? this.clock();
    const result = evaluateTimeBasedState(record.engineState, now, this.stateConfig);
    if (result.transition === null) return null;

    const engineState = result.state;
    const session = toSession(engineState, record.session, now);
    this.store.saveSession({ session, engineState });

    const course = this.store.getCourse(record.session.courseId);
    const resume = this.ensureResumeArtifacts(session, course, engineState, now);
    const policy = this.applyPolicy(session, course, engineState, now);

    /*
     * SAFETY: `eventType` comes from `evaluateTimeBasedState`, which reports only TAB_LEFT or
     * IDLE_STARTED and with an empty payload, so the result is a member of the union. The cast covers
     * `payload`: the transition record does not type it per event.
     */
    const event: LearningEvent = {
      id: `tick:${result.transition.eventId}`,
      sessionId: session.id,
      at: now,
      type: result.transition.eventType,
      source: 'system',
      payload: {},
    } as unknown as LearningEvent;

    return {
      event,
      state: engineState.state,
      checkpoint: resume.checkpoint,
      resumeCard: resume.resumeCard,
      decision: policy.decision,
      interventionId: policy.interventionId,
    };
  }

  // -------------------------------------------------------------- checkpoints

  getLatestCheckpoint(sessionId: string): LearningCheckpoint | null {
    return this.store.getLatestCheckpoint(sessionId);
  }

  createCheckpoint(sessionId: string): LearningCheckpoint {
    const record = this.requireSession(sessionId);
    const course = this.store.getCourse(record.session.courseId);
    if (course === null) {
      throw new EngineError('course-not-found', `Unknown course: ${record.session.courseId}`);
    }
    const now = this.clock();
    const checkpoint = buildCheckpoint({
      session: record.session,
      course,
      engineState: record.engineState,
      now,
      checkpointId: `${sessionId}:manual:${now}`,
    });
    this.store.saveCheckpoint(checkpoint);
    return checkpoint;
  }

  private ensureResumeArtifacts(
    session: LearningSession,
    course: Course | null,
    engineState: StateEngineState,
    now: string,
  ): { checkpoint: LearningCheckpoint | null; resumeCard: ResumeCardView | null } {
    if (course === null || !shouldOfferResume(engineState)) {
      return { checkpoint: null, resumeCard: null };
    }

    const checkpointId = `${session.id}:${engineState.since}`;
    const existing = this.store.getCheckpoint(checkpointId);

    const checkpoint =
      existing ??
      buildCheckpoint({
        session,
        course,
        engineState,
        now,
        checkpointId,
      });
    if (existing === null) this.store.saveCheckpoint(checkpoint);

    this.store.saveResumeShown(checkpoint.id, session.id, checkpoint.createdAt);
    this.store.saveIntervention(
      createIntervention(
        { id: `intervention-resume:${checkpoint.id}`, sessionId: session.id, at: now },
        {
          action: 'RESUME',
          state: engineState.state,
          reason: message('reason.resume.interruption'),
          confidence: 1,
          estimatedMinutes: 5,
        },
      ),
    );

    return { checkpoint, resumeCard: this.resumeCardView(checkpoint, session, course) };
  }

  private resumeCardView(
    checkpoint: LearningCheckpoint,
    session: LearningSession,
    course: Course,
  ): ResumeCardView {
    const timing = this.store.getResumeTiming(checkpoint.id) ?? {
      checkpointId: checkpoint.id,
      shownAt: checkpoint.createdAt,
    };
    return {
      card: buildResumeCard({
        checkpoint,
        session,
        course,
        recentEvents: this.store.listEvents(session.id),
        now: checkpoint.createdAt,
      }),
      timing,
    };
  }

  /** Returns the pending card, or null once it has been accepted/dismissed. */
  getResumeCard(sessionId: string): ResumeCardView | null {
    const checkpoint = this.store.getLatestCheckpoint(sessionId);
    if (checkpoint === null) return null;
    const timing = this.store.getResumeTiming(checkpoint.id);
    if (timing !== null && (timing.acceptedAt !== undefined || timing.dismissedAt !== undefined)) {
      return null;
    }
    const record = this.store.getSession(sessionId);
    if (record === null) return null;
    const course = this.store.getCourse(record.session.courseId);
    if (course === null) return null;
    return this.resumeCardView(checkpoint, record.session, course);
  }

  acceptResume(checkpointId: string): ResumeDecisionResponse {
    return this.decideResume(checkpointId, 'accepted');
  }

  dismissResume(checkpointId: string): ResumeDecisionResponse {
    return this.decideResume(checkpointId, 'dismissed');
  }

  private decideResume(
    checkpointId: string,
    decision: 'accepted' | 'dismissed',
  ): ResumeDecisionResponse {
    const checkpoint = this.store.getCheckpoint(checkpointId);
    if (checkpoint === null) {
      throw new EngineError('checkpoint-not-found', `Unknown checkpoint: ${checkpointId}`);
    }

    const now = this.clock();
    const timing = this.store.markResumeDecided(checkpointId, decision, now);

    const response = this.dispatch({
      sessionId: checkpoint.sessionId,
      type: decision === 'accepted' ? 'RESUME_REQUESTED' : 'RESUME_DISMISSED',
      source: 'user',
      payload: { checkpointId },
    });

    const interventionId = `intervention-resume:${checkpointId}`;
    const intervention = this.store.getIntervention(interventionId);
    let outcome: InterventionOutcome | null = null;

    if (intervention !== null) {
      outcome = recordOutcome({
        id: `outcome:${interventionId}`,
        intervention,
        at: now,
        accepted: decision === 'accepted',
        dismissed: decision === 'dismissed',
        taskCompleted: false,
        resumeLatencyMs: timing?.resumeLatencyMs ?? null,
        quizOutcome: null,
      });
      this.store.saveOutcome(outcome);
    }

    return {
      timing: timing ?? { checkpointId, shownAt: now },
      state: response.state,
      outcome,
    };
  }

  // ------------------------------------------------------------ interventions

  private applyPolicy(
    session: LearningSession,
    course: Course | null,
    engineState: StateEngineState,
    now: string,
  ): { decision: ReturnType<typeof decideIntervention> | null; interventionId: string | null } {
    const shown = this.store
      .listInterventions(session.id)
      .filter((item) => item.action !== 'RESUME');
    const currentTask = findTask(course, engineState.currentTaskId);

    const decision = decideIntervention(
      {
        engineState,
        recentEvents: this.store.listEvents(session.id),
        shownInterventions: shown,
        currentTask,
        now,
      },
      this.policyConfig,
    );

    if (decision.action === 'NO_ACTION') {
      return { decision, interventionId: null };
    }

    const intervention = createIntervention(
      {
        id: `intervention:${session.id}:${now}:${decision.action}`,
        sessionId: session.id,
        at: now,
      },
      decision,
    );
    this.store.saveIntervention(intervention);
    return { decision, interventionId: intervention.id };
  }

  listInterventions(sessionId: string): Intervention[] {
    return this.store.listInterventions(sessionId);
  }

  resolveIntervention(request: ResolveInterventionRequest): InterventionOutcome | null {
    const intervention = this.store.getIntervention(request.interventionId);
    if (intervention === null) return null;

    const outcome = recordOutcome({
      id: `outcome:${intervention.id}`,
      intervention,
      at: this.clock(),
      accepted: request.accepted,
      dismissed: request.dismissed,
      taskCompleted: request.taskCompleted,
      resumeLatencyMs: null,
      quizOutcome: request.quizOutcome ?? null,
    });
    this.store.saveOutcome(outcome);
    return outcome;
  }

  listOutcomes(sessionId: string): InterventionOutcome[] {
    return this.store.listOutcomes(sessionId);
  }

  // ---------------------------------------------------------------- dashboard

  getDashboard(): DashboardSummary {
    const record = this.store.getActiveSession() ?? this.store.getLatestSession();
    if (record === null) {
      return buildDashboardSummary({
        session: null,
        course: null,
        outcomes: [],
        checkpointCount: 0,
        now: this.clock(),
      });
    }
    return buildDashboardSummary({
      session: record.session,
      course: this.store.getCourse(record.session.courseId),
      outcomes: this.store.listOutcomes(record.session.id),
      checkpointCount: this.store.listCheckpoints(record.session.id).length,
      now: this.clock(),
    });
  }

  // ----------------------------------------------------------------- insights

  /**
   * Rebuilds the dashboard's aggregates from the stored event log.
   *
   * Every session in the store is replayed, because the calendar windows (today,
   * last 7 days, all time) are not scoped to the session on screen. The window then
   * decides which of them contribute.
   */
  getInsights(range: InsightRange = DEFAULT_INSIGHT_RANGE): InsightsSummary {
    const sources: InsightsSessionSource[] = this.store.listSessions().map((record) => ({
      session: record.session,
      events: this.store.listEvents(record.session.id),
      // One checkpoint == one moment the learner had to be helped back in.
      interruptionAt: this.store
        .listCheckpoints(record.session.id)
        .map((checkpoint) => checkpoint.createdAt),
      outcomes: this.store.listOutcomes(record.session.id),
    }));

    const onScreen = this.store.getActiveSession() ?? this.store.getLatestSession();

    return buildInsightsSummary({
      range,
      now: this.clock(),
      sources,
      courses: this.store.listCourses(),
      currentSessionId: onScreen?.session.id ?? null,
      config: this.stateConfig,
    });
  }

  // ---------------------------------------------------------------- simulator

  getSimulatorAvailability(): SimulatorAvailability {
    return this.simulatorEnabled
      ? { enabled: true, reason: 'Development build — the simulator is available.' }
      : { enabled: false, reason: 'Disabled outside development builds.' };
  }

  /**
   * Demo Event Simulator. This is a supported fallback for the golden path when
   * the browser extension is not installed — not a test-only hack.
   */
  simulate(command: SimulatorCommand): DispatchEventResponse {
    if (!this.simulatorEnabled) {
      throw new EngineError('simulator-disabled', 'The event simulator is disabled.');
    }

    const sessionId = command.sessionId;
    const awayMs = demoInterruption().durationMs;
    let last: DispatchEventResponse | null = null;

    const fire = (type: LearningEvent['type'], payload: Record<string, unknown>): void => {
      last = this.dispatch({ sessionId, type, source: 'simulator', payload });
    };

    switch (command.command) {
      case 'distraction':
        fire('TAB_LEFT', { origin: 'simulator' });
        break;
      case 'return':
        fire('TAB_RETURNED', { awayMs });
        break;
      case 'confusion':
        fire('QUIZ_INCORRECT', { taskId: 'rbt-t2', quizId: 'rbt-q1' });
        fire('QUIZ_INCORRECT', { taskId: 'rbt-t2', quizId: 'rbt-q1' });
        break;
      case 'overload':
        for (let index = 0; index < 3; index += 1) {
          fire('HELP_REQUESTED', { taskId: 'rbt-t2' });
        }
        break;
      case 'success':
        fire('QUIZ_CORRECT', { taskId: 'rbt-t2', quizId: 'rbt-q1' });
        break;
      default: {
        const exhaustive: never = command.command;
        throw new EngineError(
          'simulator-disabled',
          `Unsupported simulator command: ${String(exhaustive)}`,
        );
      }
    }

    if (last === null) {
      throw new EngineError('session-not-found', 'The simulator produced no events.');
    }
    return last;
  }

  // ------------------------------------------------------------ optional LLM

  /**
   * The only path that may reach a network provider. It always resolves: on
   * failure it degrades to the mock provider and reports why.
   */
  async enrich(prompt: string, system?: string): Promise<CompleteWithFallbackResult> {
    return completeWithFallback(this.providers, {
      prompt,
      ...(system === undefined ? {} : { system }),
      maxTokens: 256,
      temperature: 0.3,
    });
  }

  providerInfo(): { id: string; model: string; offline: boolean } {
    const provider = this.providers.primary;
    return { id: provider.id, model: provider.model, offline: provider.offline };
  }

  configSnapshot(): {
    state: Required<StateEngineConfig>;
    policy: Required<InterventionPolicyConfig>;
  } {
    return {
      state: { ...DEFAULT_STATE_ENGINE_CONFIG, ...this.stateConfig },
      policy: { ...DEFAULT_POLICY_CONFIG, ...this.policyConfig },
    };
  }

  // ---------------------------------------------------------------- settings

  getSettings(): AppSettings {
    return {
      locale: coerceLocale(this.store.getMeta(LOCALE_KEY)),
      theme: coerceTheme(this.store.getMeta(THEME_KEY)),
      showMaterialText: coerceShowMaterialText(this.store.getMeta(SHOW_MATERIAL_TEXT_KEY)),
    };
  }

  setLocale(locale: Locale): AppSettings {
    this.store.setMeta(LOCALE_KEY, locale);
    return this.getSettings();
  }

  setTheme(theme: ThemePreference): AppSettings {
    this.store.setMeta(THEME_KEY, theme);
    return this.getSettings();
  }

  setShowMaterialText(showMaterialText: boolean): AppSettings {
    this.store.setMeta(SHOW_MATERIAL_TEXT_KEY, showMaterialText ? 'true' : 'false');
    return this.getSettings();
  }
}

function findTask(course: Course | null, taskId: string | null): MicroTask | null {
  if (course === null || taskId === null) return null;
  return course.microTasks.find((task) => task.id === taskId) ?? null;
}

function toSession(
  engineState: StateEngineState,
  base: Pick<LearningSession, 'id' | 'courseId' | 'startedAt'> & Partial<LearningSession>,
  updatedAt: string,
): LearningSession {
  return {
    id: base.id,
    courseId: base.courseId,
    startedAt: base.startedAt,
    ...(base.endedAt === undefined ? {} : { endedAt: base.endedAt }),
    state: engineState.state,
    ...(engineState.currentTaskId === null ? {} : { currentTaskId: engineState.currentTaskId }),
    ...(engineState.lastActiveTaskId === null
      ? {}
      : { lastActiveTaskId: engineState.lastActiveTaskId }),
    completedTaskIds: engineState.completedTaskIds,
    updatedAt,
  };
}
