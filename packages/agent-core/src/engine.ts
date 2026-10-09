import { randomUUID } from 'node:crypto';
import type {
  AgentContext,
  AgentContextReport,
  AgentProposal,
  AgentProposalKind,
  AgentProposalProposedEvent,
  ConfirmProposalRequest,
  Course,
  DashboardSummary,
  DispatchEventRequest,
  DispatchEventResponse,
  EndSessionRequest,
  ExecuteProposalRequest,
  ImportMaterialResponse,
  InsightRange,
  InsightsSummary,
  Intervention,
  InterventionDecision,
  InterventionOutcome,
  LearningCheckpoint,
  LearningEvent,
  LearningSession,
  MaterialDocument,
  MicroTask,
  ProposalConfirmResult,
  ProposalExecuteResult,
  ResolveInterventionRequest,
  ResumeCardView,
  RescueView,
  ResolveRescueRequest,
  ResolveRescueResponse,
  ResumeDecisionResponse,
  SessionSnapshot,
  SimulatorAvailability,
  SimulatorCommand,
  StartSessionResponse,
  ThemePreference,
  ToolCallRecord,
  ToolCallRequest,
  ToolCallResult,
  TutorAnswer,
  TutorAskRequest,
  TutorContextReport,
  TutorProviderInfo,
  TutorReply,
  TutorUnavailableReason,
  TaskRewrite,
  ProposeStructuralChangeResponse,
  AgentMemoryItem,
  AgentMemoryListResult,
  AgentMemoryRefusal,
  AgentMemoryScope,
  AgentMemorySourceCount,
  AgentMemorySummaryResult,
  LearnerPreferenceListResult,
  PreferenceDeleteResult,
  AgentMemoryWindow,
  EpisodicCleanupResult,
} from '@focusloop/shared-types';
import {
  AGENT_MEMORY_SOURCES,
  AGENT_MEMORY_RETENTION_MS,
  MEMORY_LIST_LIMIT,
  MEMORY_QUERY_MAX,
  TASK_REWRITE_ACTIONS,
  TUTOR_LIMITS,
  findMaterialForCourse,
  isRescueAction,
  isStuckReason,
  isTaskRewrite,
  isTaskRewriteAction,
  message,
} from '@focusloop/shared-types';
import { buildAgentContext } from './agent-context';
import { buildRescueGrounding } from './rescue-grounding';
import { createAgentReadRegistry, type ToolRegistry } from './tool-registry';
import {
  DEFAULT_INSIGHT_RANGE,
  coerceLocale,
  coerceAmbientSound,
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
  buildRescuePlan,
  buildRescueView,
  estimatedMinutesFor,
  evaluateRescueSuccess,
} from '@focusloop/intervention-policy';
import { parseMaterial } from '@focusloop/material-parser';
import type { FocusLoopStore, SessionRecord } from '@focusloop/persistence';
import {
  AgentRuntime,
  type CompleteWithFallbackResult,
  type ProviderSelection,
} from '@focusloop/llm-provider';
import { buildDashboardSummary, type EvaluatedRescue } from './dashboard';
import { buildInsightsSummary, type InsightsSessionSource } from './insights';
import { demoCourse, demoInterruption } from './demo-course';
import { generateCourse } from './micro-task-generator';
import { buildTutorPrompt, buildTutorRetryPrompt, isRetryable, readTutorReply } from './tutor';
import { confirmAgentProposal, createAgentProposal, executeAgentProposal } from './proposal';
import { applyTaskRewrite, buildTaskRewrite, rewriteIdempotencyKey } from './task-rewrite';
import {
  TutorTranscript,
  composeRetryPrompt,
  fallbackFor,
  formatAnswer,
  providerInfo,
  unsentReport,
} from './tutor-ask';

/** Leaves room for the widest legal Tutor answer and its labels; see complete(). */
const TUTOR_COMPLETION_TOKEN_CAP = 2048;

/** The `app_meta` key the interface language is stored under. */
export const LOCALE_KEY = 'locale';

/** The `app_meta` key the theme preference is stored under. */
export const THEME_KEY = 'theme';

/** The `app_meta` key the "show the imported text" preference is stored under. */
export const SHOW_MATERIAL_TEXT_KEY = 'show-material-text';

/** The `app_meta` key the ambient-layer preference is stored under (#57). */
export const AMBIENT_SOUND_KEY = 'ambient-sound';

/**
 * A request the engine refuses, carrying the code the caller branches on — so a rejection is a value
 * rather than a message to parse.
 */
export class EngineError extends Error {
  readonly code:
    | 'session-not-found'
    | 'session-ended'
    | 'course-not-found'
    | 'checkpoint-not-found'
    | 'simulator-disabled';

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
  /**
   * The one door to providers: serialisable request data, in-process abort
   * options, text vs structured modes. Skills never talk to `AIProvider` directly.
   */
  private readonly runtime: AgentRuntime;
  /**
   * The tool contract (AG8.1): registered reads, validated in this process.
   *
   * On the engine and not on the renderer, for the same reason the context builder is: grading a
   * call needs the session, and the renderer must never hold what it would need to grade one.
   * Phase 2 adds the write registrations, which route through the proposal envelope.
   */
  private readonly tools: ToolRegistry;
  private readonly clock: () => string;
  private readonly idFactory: () => string;
  private readonly simulatorEnabled: boolean;
  private readonly stateConfig: Partial<StateEngineConfig>;
  private readonly policyConfig: Partial<InterventionPolicyConfig>;
  /**
   * The tutor's conversations, keyed by session, in memory.
   *
   * On the engine and not in the store: the transcript is model prose that becomes an input to the
   * next prompt, so it is the one piece of AG3 state that is both untrusted and transient. Persisting
   * it would mean a table that grows with every question and a deletion path that has to be right, for
   * a working aid whose value ends with the session. AG7 is where this becomes durable, deliberately.
   */
  private readonly transcript = new TutorTranscript();
  constructor(options: FocusLoopEngineOptions) {
    this.store = options.store;
    this.providers = options.providers;
    this.runtime = new AgentRuntime(options.providers);
    this.tools = createAgentReadRegistry();
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

  /**
   * Drops the learner's words that were never written to disk.
   *
   * The tutor transcript is held in memory on purpose (it is a working aid, and persisting model prose
   * would be a table that grows with every question), which makes it the part of "my data" that
   * deleting the database does not reach. Called by the delete-everything path, after the file is gone,
   * so nothing of the learner is left in this process either — a deletion that leaves the last question
   * in memory is not the deletion it claims to be.
   */
  discardTransientData(): void {
    this.transcript.clear();
  }

  // --------------------------------------------------------------- catalogue

  listCourses(): Course[] {
    const rewrite = this.activeTaskRewrite();
    const courses = this.store.listCourses();
    // A rewrite narrows one task for as long as the learner is on it; the stored row is untouched.
    return rewrite === null ? courses : courses.map((course) => applyTaskRewrite(course, rewrite));
  }

  getCourse(courseId: string): Course | null {
    const course = this.store.getCourse(courseId);
    if (course === null) return null;
    const rewrite = this.activeTaskRewrite();
    return rewrite === null ? course : applyTaskRewrite(course, rewrite);
  }

  /**
   * The rewrite the learner accepted for the task they are on.
   *
   * Read back from the proposal that recorded it rather than from a second copy: the envelope's
   * `executed` status is what "accepted and applied" means, and keeping one source of truth means a
   * refused or expired proposal cannot leave a narrowing behind. Nothing is returned once the learner
   * has moved on to another task, which is the whole of "finishing or dismissing returns the full
   * task" — the course was never rewritten in the first place.
   */
  private activeTaskRewrite(): TaskRewrite | null {
    const active = this.store.getActiveSession();
    if (active === null || active.session.endedAt !== undefined) return null;
    const taskId = active.session.currentTaskId;
    if (taskId === undefined) return null;
    for (const action of TASK_REWRITE_ACTIONS) {
      const stored = this.store.getAgentProposalByIdempotencyKey(
        rewriteIdempotencyKey(active.session.id, taskId, action),
      );
      if (stored === null || stored.status !== 'executed') continue;
      const payload = stored.proposal.payload['rewrite'];
      // The task id is checked again here: a rewrite belongs to the task it was built for, whoever
      // else may have looked it up.
      if (!isTaskRewrite(payload) || payload.taskId !== taskId) continue;
      /*
       * Continuing the task ends the narrowing. "Continue" is the learner saying they want the whole
       * task after all, and that is an outcome rather than a change to anything stored — so it is read
       * from the outcome of the intervention that accepted the rewrite.
       */
      const interventionId = stored.proposal.payload['interventionId'];
      if (
        typeof interventionId === 'string' &&
        this.store.getOutcomeByIntervention(interventionId)?.continuedAt !== undefined
      )
        continue;
      return payload;
    }
    return null;
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
    /*
     * The transcript goes with the session.
     *
     * Not because it is sensitive, but because the alternative is a new session starting inside the
     * old one's conversation: the tutor would answer with the previous session's questions in its
     * context and report them as this session's transcript. The map is also the only thing here that
     * is not in the store, so this is the one place it can leak per-session.
     */
    this.transcript.forget(request.sessionId);
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

  /**
   * Runs one tool call through the contract: validate, grade, run, record (AG8.1).
   *
   * Every attempt produces a `ToolCall` row — success, refusal, even a name nobody registered —
   * because the attempt is what AG8.8's audit reads. The row is the only write on this path; the
   * reads themselves serve the `AgentContext` slices above, so there is no second query path to
   * keep side-effect free and no write for a refusal to leave half-done.
   */
  executeToolCall(request: ToolCallRequest): ToolCallResult {
    const snapshot = this.getCurrentSession();
    const result = this.tools.execute(request, {
      currentSessionId: snapshot === null ? null : snapshot.session.id,
      context: this.getAgentContext().context,
      now: this.clock(),
      id: () => this.idFactory(),
    });
    this.store.insertToolCall(result.call);
    return result;
  }

  /**
   * The same context, for a session that is named rather than the one that is running.
   *
   * The inspector asks about "now" and the tutor asks about the session the question arrived on, and
   * those are the same context assembled from the same six inputs. Two copies of this list is how the
   * tutor and the inspector end up disagreeing about what the agent was given, which is the one
   * disagreement AG1 exists to prevent.
   */
  private contextFor(record: SessionRecord): AgentContextReport {
    const snapshot = this.snapshot(record);
    const { session } = snapshot;
    return buildAgentContext({
      session,
      progress: snapshot.progress,
      course: this.getCourse(session.courseId),
      courseCount: this.listCourses().length,
      material: findMaterialForCourse(this.listMaterials(), session.courseId),
      events: this.listEvents(session.id),
      checkpoint: this.getLatestCheckpoint(session.id),
      learningState: session.state,
    });
  }

  /**
   * Asks the tutor about the step the learner is on (AG3 step two).
   *
   * Three things are deliberate and each is a decision rather than an implementation detail:
   *
   * **The prompt is built before the provider is consulted.** Ordering it the other way round would
   * make an empty question unavailable *because* there is no model, which tells the learner the wrong
   * thing about their own message — and the build is pure and free, so there is no cost to knowing
   * first. The report returned for an unreachable model is the built one with `sent` zeroed.
   *
   * **No learning event is emitted.** An intervention decision may not be an LLM inference (the epic's
   * invariant), and an ask is not an event either: the tutor helps with the step in front of the
   * learner, so emitting `HELP_REQUESTED` per question would make three questions in a row look like
   * overload and trigger `OVERLOADED`/`BREAK` — the feature punishing the learner for using it. The
   * transcript is in-memory and the log stays about the learner's work.
   *
   * **One retry, and only for the format.** `isRetryable` is the gate, and it is not a general
   * "ask again": a grounding failure teaches a model to satisfy the checker, so a rejection for
   * `unquoted-confirmation` or `not-from-the-material` is final. The retry also does not happen when
   * the provider is offline, because the offline provider's output never parses by construction — a
   * retry there is two calls and no answer on every question in the golden path.
   */
  async askTutor(request: TutorAskRequest): Promise<TutorAnswer> {
    const record = this.store.getSession(request.sessionId);
    if (record === null) {
      throw new EngineError('session-not-found', `No session ${request.sessionId}.`);
    }
    /*
     * An ask about a session that is over is refused rather than answered.
     *
     * The answer is grounded in "the step you are on", and after the session ends there is no step — the
     * context would be the last moment of a finished session presented as the current one, which is the
     * same failure `getCurrentSession` was fixed not to have. `dispatch` still accepts events on an ended
     * session (the state machine records them), and the difference is deliberate: an event is a fact
     * about something that happened, and an answer is a claim about now.
     */
    if (record.session.endedAt !== undefined) {
      throw new EngineError('session-ended', `Session ${request.sessionId} has ended.`);
    }

    const report = this.contextFor(record);
    const context = report.context;
    /*
     * A null context has exactly one producer — `buildAgentContext` with no session — and this method
     * has already refused that case, so this is the same refusal one step later rather than a second
     * kind of failure. It is written rather than asserted because `AgentContext | null` is what the
     * builder hands back, and this is the only place a missing session could reach a prompt.
     */
    if (context === null) {
      throw new EngineError('session-not-found', `No context for session ${request.sessionId}.`);
    }

    const built = buildTutorPrompt({
      mode: request.mode,
      context,
      question: request.question,
      turns: this.transcript.list(request.sessionId),
    });

    if (built.status === 'refused') {
      return this.unavailable(built.reason, context, built.report);
    }

    /*
     * The question as the model was given it, named once.
     *
     * It is needed in three places — the quote check, the retry's complaint and the transcript — and all
     * three must be the *sent* text rather than `request.question`: the sanitiser may have trimmed it, and
     * a learner cannot be quoted on a line the model never saw.
     */
    const asked = built.question;

    const provider = this.providers.primary;
    if (provider.offline) {
      /*
       * Not "the model answered badly": the configured provider cannot answer at all, and the mock's
       * output is documented never to parse. Calling it would produce a rejection and then a retry,
       * which is two calls and no answer — so the honest outcome is the one the learner can act on.
       */
      return this.unavailable('no-model', context, unsentReport(built.report));
    }

    let completion = await this.complete(built.system, built.prompt);
    if (completion.degraded) {
      /*
       * A failing provider was **called**, so the built number is what this reports. `unsentReport` is
       * for the offline gate above, where no call is made at all: `sent` is what the inspector reads to
       * watch a prompt grow, and zeroing it here would hide the growth in the one case where the prompt
       * was handed over and nobody answered.
       */
      return this.unavailable(
        'provider-failed',
        context,
        built.report,
        providerInfo(provider, true, completion.failure),
      );
    }

    let reading = readTutorReply({
      mode: request.mode,
      text: completion.text,
      /*
       * The excerpt **the builder says is in the prompt**, not `context.material`.
       *
       * They differ exactly when the reduction dropped the excerpt for space, and passing the material
       * there would let a model's `[section]` citation resolve against a section it was never given —       * which is the one thing `resolveSource` exists to catch. Derived from the builder's return rather
       * than from `report.sent.excerptCharacters > 0`, because the report is a number about the prompt
       * and this is the object that went into it.
       */
      excerpt: built.excerpt,
      /*
       * The question that was just asked, **and** everything said before it.
       *
       * The transcript does not hold this question yet — it is recorded only when an answer comes back — so
       * passing the transcript alone made a confirmation of the learner's own message unquotable, which is
       * the whole of what `CHECK_MY_ANSWER` is for: the mode could never pass its quote check on the first
       * ask, and could only ever confirm something said in an *earlier* exchange.
       *
       * `built.question` rather than `request.question`: the text the model was given. A learner whose
       * message the sanitiser trimmed cannot be quoted on the trimmed line, because the model never saw it.
       */
      learnerText: [...this.transcript.learnerText(request.sessionId), built.question],
    });

    const omissions = [...built.report.omitted];
    /*
     * A rejected reading's omissions are collected **when they happen**, not at the return.
     *
     * A retry produces two readings and the second overwrites `reading`, so appending `reading.omissions`
     * at the end reports the retry's and drops the first one's — which is what the rejected path did, and
     * the degraded-retry path dropped both because it appends nothing. The contract says `omitted` is the
     * complete account on every outcome, so each reading is pushed as it arrives and the returns below add
     * only what is genuinely theirs.
     */
    if (reading.status === 'rejected') omissions.push(...reading.omissions);
    /*
     * What has actually been sent, which a retry changes.
     *
     * The first version reported `built.report.sent` on every path, so the one call that sends two
     * prompts reported the size of the smaller one — and the degraded-retry path reported zero, for an
     * exchange in which a prompt was handed over and answered by nobody. The sum is the honest number: a
     * retry is a second payment, and the inspector's job is to show the total the tutor is spending.
     */
    let sent: TutorContextReport['sent'] = built.report.sent;

    if (reading.status === 'rejected' && isRetryable(reading.reason)) {
      const retry = buildTutorRetryPrompt({
        mode: request.mode,
        reason: reading.reason,
        // The text the model was sent, not the request text: handing the retry the raw string would
        // sanitise it a second time, over a string the first pass already changed.
        question: built.question,
      });
      const composed = composeRetryPrompt({
        system: built.system,
        // The preamble, not the prompt: the prompt ends with the `[question]` block and the retry
        // restates the question, so composing from the prompt sends it twice — which is what made the
        // retry unaffordable for exactly the long questions it is most needed for.
        preamble: built.preamble,
        answer: completion.text,
        retry,
      });

      if (composed.status === 'does-not-fit') {
        /*
         * Reported rather than skipped in silence. The retry is a second call and the ceiling bounds
         * every call, so this is the correct outcome — but the learner is owed the reason their answer
         * came back as a fallback rather than as a repaired one.
         */
        omissions.push({
          field: 'conversation',
          detail: 'the answer could not be asked for again: it would have gone over the limit',
        });
      } else {
        completion = await this.complete(built.system, composed.prompt);
        sent = {
          turns: built.report.sent.turns,
          // The size `composeRetryPrompt` checked, not a second computation of it.
          inputCharacters: sent.inputCharacters + composed.inputCharacters,
          excerptCharacters: built.report.sent.excerptCharacters,
        };
        if (completion.degraded) {
          return this.unavailable(
            'provider-failed',
            context,
            { sent, omitted: omissions },
            providerInfo(provider, true, completion.failure),
          );
        }
        reading = readTutorReply({
          mode: request.mode,
          text: completion.text,
          excerpt: built.excerpt,
          learnerText: [...this.transcript.learnerText(request.sessionId), asked],
        });
        if (reading.status === 'rejected') omissions.push(...reading.omissions);
      }
    }

    if (reading.status === 'rejected') {
      return {
        outcome: {
          status: 'rejected',
          reason: reading.reason,
          provider: providerInfo(provider, false, null),
          fallback: fallbackFor(reading.reason, context),
        },
        context: { sent, omitted: [...omissions] },
      };
    }

    const reply: TutorReply = reading.reply;
    /*
     * Recorded only on an answer.
     *
     * A rejected reply is model prose that failed the mode's shape, and putting it in the transcript
     * would make the next prompt carry text the tutor refused to show the learner — with the tutor's
     * own role on it.
     *
     * The omissions this returns describe the transcript as it is now, and every other omission here
     * describes the prompt that was just sent. Two lifetimes in one array, which the contract's shape
     * forces: a dropped turn was not left out of the prompt just answered, it will be left out of the
     * next one. Reported as soon as it is true rather than when it takes effect, because the learner's
     * question is the moment they can do something about it.
     */
    omissions.push(
      ...this.transcript.record(request.sessionId, {
        /*
         * The question **as the model saw it**, from the builder rather than from the request.
         *
         * They differ when the learner typed something the sanitiser strips. Storing the raw text would
         * put a `[hint]` the learner wrote into the next prompt in the learner's turn — a label the
         * model is meant to produce, shown to it as input, which is what the sanitiser exists to prevent.
         */
        question: asked,
        answer: formatAnswer(reply.parts),
      }),
    );

    return {
      outcome: { status: 'answered', reply },
      context: { sent, omitted: [...omissions, ...reply.omissions] },
    };
  }

  /** One shape for "no model answered", so the four reasons cannot drift apart in three call sites. */
  private unavailable(
    reason: TutorUnavailableReason,
    context: AgentContext,
    report: TutorContextReport,
    provider?: TutorProviderInfo,
  ): TutorAnswer {
    return {
      outcome: {
        status: 'unavailable',
        reason,
        provider: provider ?? providerInfo(this.providers.primary, false, null),
        fallback: fallbackFor(reason, context),
      },
      context: report,
    };
  }

  /**
   * The one path to a network provider, for one completion.
   *
   * `completeWithFallback` and not `this.enrich`: `enrich` caps at 256 tokens and 0.3 temperature, which
   * is right for a one-line suggestion and wrong for an answer with labelled parts in it.
   *
   * **The token cap is sized so the formatter is what bounds an answer, not the provider's stop.** The
   * widest answer any mode allows is `CHECK_MY_ANSWER`'s two parts at `partCharacters` each, which is
   * 1,200 characters; in the language where a character is closest to a token that is over 1,200 tokens,
   * so 512 would truncate a legal answer — and a truncated part still has its label, so it parses as a
   * complete one and nothing anywhere reports that the end went missing. 2,048 leaves room for that plus
   * the labels. Anything the model returns beyond it is caught by the clip, which reports.
   */
  private complete(system: string, prompt: string): Promise<CompleteWithFallbackResult> {
    return this.runtime.completeText(
      {
        system,
        prompt,
        maxTokens: TUTOR_COMPLETION_TOKEN_CAP,
        temperature: 0.3,
      },
      {
        budgets: {
          contextBudget: TUTOR_LIMITS.inputCharacters,
          tokenBudget: TUTOR_COMPLETION_TOKEN_CAP,
        },
      },
    );
  }

  /**
   * This session's tool calls, resolved to their events (AG8.8) — the audit's read surface.
   *
   * A passthrough on purpose: the store's join is the query that must not become a per-row round
   * trip, and there is nothing to derive between it and the caller. Nothing in the renderer asks
   * for it any more — the developer panel that displayed it is gone — so the callers are the
   * registry's own specs.
   */
  listToolCalls(sessionId: string): readonly ToolCallRecord[] {
    return this.store.listToolCalls(sessionId);
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
        rescue: null,
      };
    }

    const reduced = reduceState(record.engineState, event, this.stateConfig);
    const engineState = reduced.state;

    const session = toSession(engineState, record.session, at);
    this.store.saveSession({ session, engineState });

    /*
     * Two views of the same course, and the difference is deliberate.
     *
     * The resume path reads the course as the learner is being served it, because the thing being
     * resumed is what is on screen — after a rescue narrowed the task, that is a two-minute step and
     * not the three-minute task the row holds (AG5.6). The policy keeps the authored task: its
     * "runs far past its estimate" rule asks about the plan the course states, and moving that
     * question onto the narrowed estimate would change when the agent speaks, which is a decision of
     * its own rather than a side effect of this one.
     */
    const resume = this.ensureResumeArtifacts(
      session,
      this.getCourse(session.courseId),
      engineState,
      at,
    );
    const policy = this.applyPolicy(session, course, engineState, at);

    return {
      event,
      state: engineState.state,
      checkpoint: resume.checkpoint,
      resumeCard: resume.resumeCard,
      decision: policy.decision,
      interventionId: policy.interventionId,
      rescue: policy.rescue,
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
    // Same split as `dispatch`: the resume artifacts follow what is on screen, the policy the plan.
    const resume = this.ensureResumeArtifacts(
      session,
      this.getCourse(session.courseId),
      engineState,
      now,
    );
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
      rescue: policy.rescue,
    };
  }

  // -------------------------------------------------------------- checkpoints

  getLatestCheckpoint(sessionId: string): LearningCheckpoint | null {
    return this.store.getLatestCheckpoint(sessionId);
  }

  createCheckpoint(sessionId: string): LearningCheckpoint {
    const record = this.requireSession(sessionId);
    // The learner's position as they are being served it, narrowed step and all (AG5.6).
    const course = this.getCourse(record.session.courseId);
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
        currentStepText: this.servedStepText(course),
        refresherIdea: this.refresherIdea(session.id),
      }),
      timing,
    };
  }

  /**
   * The idea a long card names instead of asking the learner to recall one (#193, decision C).
   *
   * The selection is `buildRescueGrounding('HINT', …)`'s own — concept summary, else first key
   * point, with the guard that rejects text merely repeating the task — taken from the same
   * AgentContext a HINT quotes, never generated. `null` when nothing is quotable: the card then
   * carries no refresher rather than a demand it cannot support.
   */
  private refresherIdea(sessionId: string): string | null {
    const grounding = buildRescueGrounding(
      'HINT',
      this.contextFor(this.requireSession(sessionId)).context,
    );
    return grounding?.text ?? null;
  }

  /**
   * The step on screen, when a rescue has narrowed or split the task the learner is on (AG5.6).
   *
   * Read from the same executed proposal the served course is written from, so the card and the
   * screen cannot disagree about which step this is; `null` when the task is the course's own.
   */
  private servedStepText(course: Course | null): string | null {
    const rewrite = this.activeTaskRewrite();
    if (rewrite === null || course === null) return null;
    const task = course.microTasks.find((item) => item.id === rewrite.taskId);
    return task?.instructions ?? null;
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
    const course = this.getCourse(record.session.courseId);
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
  ): {
    decision: ReturnType<typeof decideIntervention> | null;
    interventionId: string | null;
    rescue: RescueView | null;
  } {
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
      return { decision, interventionId: null, rescue: null };
    }

    const intervention = createIntervention(
      {
        /*
         * The request being answered is part of the identity, and has to be.
         *
         * `saveIntervention` inserts and ignores a duplicate id, so two interventions that share a
         * session, a millisecond and an action are one row — and if the answer's row is the one that
         * is dropped, the request is never recorded as answered and the same answer is emitted on
         * every later dispatch. Two answers in the same millisecond for the same action are exactly
         * what this produces: a tick that lands on OVERLOADED (`BREAK`) during a `tired` request
         * (`BREAK`) is the ordinary case, not a contrived one.
         */
        id: `intervention:${session.id}:${now}:${decision.action}${
          decision.answersRequestId === undefined ? '' : `:${decision.answersRequestId}`
        }`,
        sessionId: session.id,
        at: now,
      },
      decision,
    );
    this.store.saveIntervention(intervention);
    const helpRequest =
      decision.answersRequestId === undefined
        ? undefined
        : this.store.listEvents(session.id).find((event) => event.id === decision.answersRequestId);
    const taskId =
      helpRequest?.type === 'HELP_REQUESTED'
        ? (helpRequest.payload.taskId ?? engineState.currentTaskId)
        : engineState.currentTaskId;
    const rescue =
      decision.answersRequestId !== undefined &&
      isRescueAction(decision.action) &&
      this.isCurrentRescue(intervention)
        ? buildRescueView(decision, {
            interventionId: intervention.id,
            sessionId: session.id,
            taskId,
          })
        : null;
    return { decision, interventionId: intervention.id, rescue };
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

  getPendingRescue(sessionId: string): RescueView | null {
    const interventions = this.store.listInterventions(sessionId);
    for (let index = interventions.length - 1; index >= 0; index -= 1) {
      const intervention = interventions[index];
      if (
        intervention === undefined ||
        !isRescueAction(intervention.action) ||
        !this.isCurrentRescue(intervention)
      )
        continue;
      const outcome = this.store.getOutcomeByIntervention(intervention.id);
      if (outcome?.dismissed || outcome?.continuedAt !== undefined) return null;
      const { decision, seed } = this.rescueInputs(intervention);
      if (outcome?.accepted) {
        const plan = buildRescuePlan(decision, seed);
        if (
          plan !== null &&
          evaluateRescueSuccess({
            plan,
            outcome,
            events: this.store.listEvents(sessionId),
            now: this.clock(),
            rescueSuccessWindowMs: this.policyConfig.rescueSuccessWindowMs,
          }).status !== 'pending'
        )
          return null;
      }
      const view = buildRescueView(decision, seed, outcome?.accepted ? 'active' : 'offered');
      return view.plan === null ? view : this.withGrounding(view, sessionId);
    }
    return null;
  }

  /**
   * Adds the passage a HINT or EXAMPLE quotes (AG2.5/2.6), taken from the same context the inspector
   * shows. Done on read, like the task rewrites, so nothing is stored and a replayed accept cannot
   * differ from the first one; a card with nothing to quote keeps its fixed steps.
   */
  private withGrounding(view: RescueView, sessionId: string): RescueView {
    if (view.plan === null) return view;
    const record = this.store.getSession(sessionId);
    if (record === null) return view;
    const grounding = buildRescueGrounding(view.plan.action, this.contextFor(record).context);
    return grounding === null ? view : { ...view, plan: { ...view.plan, grounding } };
  }

  /** The decision and seed a stored rescue intervention is rebuilt from. */
  private rescueInputs(intervention: Intervention): {
    decision: InterventionDecision;
    seed: { interventionId: string; sessionId: string; taskId: string | null };
  } {
    return {
      decision: {
        action: intervention.action,
        state: intervention.state,
        reason: intervention.reason,
        confidence: 1,
        estimatedMinutes: estimatedMinutesFor(intervention.action),
        ...(intervention.answersRequestId === undefined
          ? {}
          : { answersRequestId: intervention.answersRequestId }),
      },
      seed: {
        interventionId: intervention.id,
        sessionId: intervention.sessionId,
        taskId: this.taskIdForIntervention(intervention),
      },
    };
  }

  /**
   * Every rescue the learner accepted in a session, judged against that session's log (AG2.8).
   *
   * Not limited to the current rescue: the dashboard is about how rescues went, including the ones
   * that have since been replaced. Recomputed on every read, so nothing is stored and a changed clock
   * or a later event is reflected without a migration.
   */
  private evaluatedRescues(sessionId: string, events: readonly LearningEvent[]): EvaluatedRescue[] {
    const now = this.clock();
    const result: EvaluatedRescue[] = [];
    for (const intervention of this.store.listInterventions(sessionId)) {
      if (!isRescueAction(intervention.action)) continue;
      const outcome = this.store.getOutcomeByIntervention(intervention.id);
      if (!outcome?.accepted) continue;
      const { decision, seed } = this.rescueInputs(intervention);
      const plan = buildRescuePlan(decision, seed);
      if (plan === null) continue;
      result.push({
        action: plan.action,
        evaluation: evaluateRescueSuccess({
          plan,
          outcome,
          events,
          now,
          rescueSuccessWindowMs: this.policyConfig.rescueSuccessWindowMs,
        }),
      });
    }
    return result;
  }

  resolveRescue(request: ResolveRescueRequest): ResolveRescueResponse {
    const intervention = this.store.getIntervention(request.interventionId);
    if (
      intervention === null ||
      intervention.sessionId !== request.sessionId ||
      !isRescueAction(intervention.action) ||
      !this.isCurrentRescue(intervention)
    ) {
      return { outcome: null, rescue: this.getPendingRescue(request.sessionId) };
    }
    const prior = this.store.getOutcomeByIntervention(intervention.id);
    const now = this.clock();
    if (request.resolution === 'continue' && !prior?.accepted) {
      return { outcome: prior, rescue: this.getPendingRescue(request.sessionId) };
    }
    if (prior?.continuedAt !== undefined) {
      return { outcome: prior, rescue: this.getPendingRescue(request.sessionId) };
    }
    if (prior?.dismissed || (prior?.accepted && request.resolution === 'dismiss')) {
      return { outcome: prior, rescue: this.getPendingRescue(request.sessionId) };
    }
    const acceptedAt =
      request.resolution === 'accept'
        ? (prior?.acceptedAt ?? (prior?.accepted ? prior.at : now))
        : prior?.acceptedAt;
    const dismissedAt =
      request.resolution === 'dismiss'
        ? (prior?.dismissedAt ?? (prior?.dismissed ? prior.at : now))
        : prior?.dismissedAt;
    const continuedAt =
      request.resolution === 'continue' ? (prior?.continuedAt ?? now) : prior?.continuedAt;
    const outcome = recordOutcome({
      id: `outcome:${intervention.id}`,
      intervention,
      at: prior?.at ?? now,
      accepted: prior?.accepted ?? request.resolution !== 'dismiss',
      dismissed: prior?.dismissed ?? request.resolution === 'dismiss',
      taskCompleted: prior?.taskCompleted ?? false,
      resumeLatencyMs: prior?.resumeLatencyMs ?? null,
      quizOutcome: prior?.quizOutcome ?? null,
      ...(acceptedAt === undefined ? {} : { acceptedAt }),
      ...(dismissedAt === undefined ? {} : { dismissedAt }),
      ...(continuedAt === undefined ? {} : { continuedAt }),
    });
    this.store.saveOutcome(outcome);
    // A first accept, not a replay: one proposal, one change, per task and action.
    if (request.resolution === 'accept' && prior?.accepted !== true) {
      this.applyRescueRewrite(intervention);
    }
    return {
      outcome: this.store.getOutcomeByIntervention(intervention.id),
      rescue: this.getPendingRescue(request.sessionId),
    };
  }

  /**
   * MICRO_START and SIMPLIFY promise a smaller task, so accepting either goes through the confirmation
   * envelope (#114) even though the learner has already tapped Accept: the tap *is* the confirmation,
   * the proposal is bound to the state it was built from, and one idempotency key per action keeps a
   * second accept from writing a second change.
   *
   * Nothing here is fatal. A task that is already small, a concept without a grounded focus or a
   * session that moved on simply leaves the deterministic plan the card is showing, which is how the
   * rescue still works offline.
   */
  private applyRescueRewrite(intervention: Intervention): void {
    const action = intervention.action;
    if (!isTaskRewriteAction(action)) return;
    const record = this.store.getSession(intervention.sessionId);
    const taskId = this.taskIdForIntervention(intervention);
    if (record === null || taskId === null) return;
    const key = rewriteIdempotencyKey(record.session.id, taskId, action);
    // Already proposed once: replaying the decision must not change anything, including a refusal.
    if (this.store.getAgentProposalByIdempotencyKey(key) !== null) return;
    const built = buildTaskRewrite(action, this.contextFor(record).context);
    if (built.status !== 'suggested') return;
    const proposal = this.createStructuralProposal({
      sessionId: record.session.id,
      kind: 'structural-write',
      // The intervention id is carried so the rewrite can be ended by the learner continuing the task,
      // which is an outcome rather than a change to the course.
      payload: { rewrite: built.rewrite, interventionId: intervention.id },
      createdBy: `engine.rescue.${action}`,
      idempotencyKey: key,
    });
    if (proposal === null) return;
    const confirmed = this.confirmProposal({
      proposalId: proposal.id,
      sessionId: record.session.id,
      expectedHash: proposal.proposalHash,
    });
    if (!confirmed.ok) return;
    this.executeProposal({
      proposalId: proposal.id,
      sessionId: record.session.id,
      idempotencyKey: key,
    });
  }

  private taskIdForIntervention(intervention: Intervention): string | null {
    const requestId = intervention.answersRequestId;
    if (requestId !== undefined) {
      const event = this.store
        .listEvents(intervention.sessionId)
        .find((item) => item.id === requestId);
      if (event?.type === 'HELP_REQUESTED' && event.payload.taskId !== undefined)
        return event.payload.taskId;
    }
    return this.store.getSession(intervention.sessionId)?.session.currentTaskId ?? null;
  }

  private isCurrentRescue(intervention: Intervention): boolean {
    if (intervention.answersRequestId === undefined) return false;
    const active = this.store.getActiveSession();
    if (active === null || active.session.id !== intervention.sessionId) return false;
    const request = this.store
      .listEvents(intervention.sessionId)
      .find((event) => event.id === intervention.answersRequestId);
    if (request?.type !== 'HELP_REQUESTED') return false;
    if (!isStuckReason(request.payload.reason)) return false;
    const requestedTaskId = request.payload.taskId;
    return requestedTaskId === undefined || active.session.currentTaskId === requestedTaskId;
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
    const events = this.store.listEvents(record.session.id);
    return buildDashboardSummary({
      session: record.session,
      course: this.store.getCourse(record.session.courseId),
      outcomes: this.store.listOutcomes(record.session.id),
      checkpointCount: this.store.listCheckpoints(record.session.id).length,
      resumeTimings: this.store.listResumeTimings(record.session.id),
      checkpoints: this.store.listCheckpoints(record.session.id),
      events,
      rescues: this.evaluatedRescues(record.session.id, events),
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
    // The demo's 30 seconds unless a test says how long it was away — see `durationMs`.
    const awayMs = command.durationMs ?? demoInterruption().durationMs;
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
   * Optional enrichment obeys the runtime's finite default budgets. Provider failures degrade
   * to the mock; malformed or oversized input rejects before provider work instead of being clipped.
   */
  async enrich(prompt: string, system?: string): Promise<CompleteWithFallbackResult> {
    return this.runtime.completeText({
      prompt,
      ...(system === undefined ? {} : { system }),
      maxTokens: 256,
      temperature: 0.3,
    });
  }

  providerInfo(): { id: string; model: string; offline: boolean; degraded: boolean } {
    const provider = this.providers.primary;
    return {
      id: provider.id,
      model: provider.model,
      offline: provider.offline,
      degraded: this.runtime.degraded,
    };
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

  // ------------------------------------------------------- agent memory clear

  /**
   * Clears agent memory for one session — ADR
   * `docs/wiki/adr/0001-agent-memory-deletion.md`.
   *
   * - **Working**: the tutor transcript (physical, in-process).
   * - **Episodic**: events, checkpoints, interventions, outcomes, resume_cards, proposals
   *   (physical, SQLite).
   * - **Audit**: opaque `agent_memory_clears` row (session id, timestamp, actor) — no content.
   *
   * Session catalog and course structure stay. Dashboard/insights read the deleted tables, so
   * their episodic aggregates drop to empty for this session: derived paths are invalidated by
   * deletion, not by a side channel.
   */
  clearAgentMemory(
    sessionId: string,
    options: { actor?: string } = {},
  ): { clearedAt: string; actor: string } | null {
    if (this.store.getSession(sessionId) === null) return null;
    const actor = options.actor ?? 'user';
    const clearedAt = this.clock();
    this.transcript.forget(sessionId);

    const run = this.store.transaction(() => {
      this.store.clearSessionEpisodic(sessionId);
      this.store.recordAgentMemoryClear(sessionId, clearedAt, actor);
    });
    run();

    /*
     * Report the row that is actually in the audit. `recordAgentMemoryClear` keeps the first clear
     * (`ON CONFLICT DO NOTHING`), so returning this call's timestamp would make a second clear name a
     * moment the audit does not contain.
     */
    const row = this.store.getAgentMemoryClear(sessionId);
    return row === null ? { clearedAt, actor } : { clearedAt: row.clearedAt, actor: row.actor };
  }

  /**
   * What agent memory exists for this session — eight sources, counts and newest times (AG7.5).
   *
   * Session-scoped on purpose: the read is refused for another session and when nothing is running,
   * so the panel cannot show one learner's counts under another's visit, and "no session" is a
   * sentence rather than an empty table that reads as "nothing remembered".
   *
   * Nothing here is stored — every number is derived from what a clear would delete, and the result
   * carries metadata only, which is what makes the no-content scan in `memory-summary.spec` true by
   * construction rather than by review.
   */
  getMemorySummary(sessionId: string): AgentMemorySummaryResult {
    const refusal = this.memoryRefusal(sessionId);
    if (refusal !== null) return refusal;

    const counted = new Map(
      this.store.agentMemoryCounts(sessionId).map((row) => [row.source, row]),
    );
    const sources: AgentMemorySourceCount[] = AGENT_MEMORY_SOURCES.map((source) => {
      if (source === 'transcript') {
        // Turns, not messages: the transcript keeps a bounded window of exchanges.
        return { source, count: this.transcript.list(sessionId).length, latestAt: null };
      }
      return counted.get(source) ?? { source, count: 0, latestAt: null };
    });

    const cleared = this.store.getAgentMemoryClear(sessionId);
    return {
      ok: true,
      summary: {
        sessionId,
        sources,
        cleared: cleared === null ? null : { clearedAt: cleared.clearedAt, actor: cleared.actor },
      },
    };
  }

  /**
   * One scope's items, newest first and bounded (AG7.5): source and time, never content.
   *
   * `episodic` lists the rows a clear would delete; `working` names what exists (the transcript
   * keeps turns without times, so it is a presence rather than a timeline); `preference` is empty
   * until #214 builds its store.
   */
  listMemory(
    sessionId: string,
    scope: AgentMemoryScope,
    window: AgentMemoryWindow = {},
  ): AgentMemoryListResult {
    const refusal = this.memoryRefusal(sessionId);
    if (refusal !== null) return refusal;

    // A window is a claim about time, so it is validated here rather than passed down to compare
    // strings that never named a moment: an unparseable bound is a RangeError, at the API's edge.
    for (const bound of [window.since, window.until]) {
      if (bound !== undefined && !Number.isFinite(Date.parse(bound))) {
        throw new RangeError('memory window bounds must be ISO-8601 timestamps');
      }
    }
    if (window.limit !== undefined && (!Number.isInteger(window.limit) || window.limit < 1)) {
      throw new RangeError('memory window limit must be a positive integer');
    }

    if (scope === 'preference') {
      return { ok: true, list: { scope, items: [], truncated: false } };
    }
    if (scope === 'working') {
      const items: AgentMemoryItem[] = [];
      if (this.transcript.list(sessionId).length > 0)
        items.push({ source: 'transcript', at: null });
      return { ok: true, list: { scope, items, truncated: false } };
    }

    // The ceiling a caller cannot talk past: the named constant, never their number.
    const cap = Math.min(window.limit ?? MEMORY_LIST_LIMIT, MEMORY_QUERY_MAX);
    const rows = this.store.listEpisodicMemory(sessionId, {
      limit: cap + 1,
      ...(window.since === undefined ? {} : { since: window.since }),
      ...(window.until === undefined ? {} : { until: window.until }),
    });
    const truncated = rows.length > cap;
    return {
      ok: true,
      list: {
        scope,
        items: rows.slice(0, cap).map((row) => ({
          source: row.source as AgentMemoryItem['source'],
          at: row.at,
        })),
        truncated,
      },
    };
  }

  /**
   * This session's stored preferences, newest first (AG7.4).
   *
   * Same gate as the memory reads: the panel inspects the session that is running, and another
   * session's rows are a refusal rather than a list that quietly came back empty.
   */
  listPreferences(sessionId: string): LearnerPreferenceListResult {
    const refusal = this.memoryRefusal(sessionId);
    if (refusal !== null) return refusal;
    return { ok: true, preferences: this.store.listLearnerPreferences(sessionId) };
  }

  /**
   * Deletes one preference (AG7.6): idempotent, session-checked, audited in the same transaction.
   *
   * Three outcomes, all of them non-throwing: the row is gone (`deleted: true`), the id was already
   * gone (`deleted: false` — the second press of the same delete is a completed no-op, not an
   * error), or the row belongs to another session (a refusal, per ADR 0001's session rule).
   */
  deletePreference(request: {
    readonly id: string;
    readonly sessionId: string;
  }): PreferenceDeleteResult {
    const refusal = this.memoryRefusal(request.sessionId);
    if (refusal !== null) return refusal;

    const stored = this.store.getLearnerPreference(request.id);
    if (stored === null) return { ok: true, deleted: false };
    if (stored.sessionId !== request.sessionId) {
      return { ok: false, reason: 'wrong-session', messageKey: 'memory.refusal.wrong-session' };
    }

    const deleted = this.store.deleteLearnerPreference(
      request.id,
      request.sessionId,
      this.clock(),
      'user',
    );
    return { ok: true, deleted };
  }

  /**
   * Draws the retention line and removes what is past it, across sessions (AG7.3).
   *
   * The cutoff is `AGENT_MEMORY_RETENTION_MS` measured from this engine's own clock, so a test
   * controls it with the clock it already controls. The running session is excluded by id — an
   * old-dated row of the *current* session survives too, because "spared" means excluded rather
   * than "young enough": whatever the learner is in the middle of is not a thing a maintenance
   * pass may reach into. Idempotent by construction: a run that removes nothing writes no audit
   * row, so rerunning reports zeroes and leaves the audit alone.
   */
  cleanupOldEpisodicMemory(options: { readonly actor?: string } = {}): EpisodicCleanupResult {
    const cutoffAt = new Date(Date.parse(this.clock()) - AGENT_MEMORY_RETENTION_MS).toISOString();
    const active = this.store.getActiveSession();
    return this.store.cleanupEpisodicMemory({
      auditId: this.idFactory(),
      cutoffAt,
      clearedAt: this.clock(),
      actor: options.actor ?? 'user',
      excludeSessionId: active === null ? '' : active.session.id,
    });
  }

  /**
   * The shared gate for both memory reads: a session must be running, and it must be this one.
   * `null` means the read may proceed — anything else is the refusal to return verbatim.
   */
  private memoryRefusal(sessionId: string): AgentMemoryRefusal | null {
    const active = this.store.getActiveSession();
    if (active === null) {
      return { ok: false, reason: 'no-session', messageKey: 'memory.refusal.no-session' };
    }
    if (active.session.id !== sessionId) {
      return { ok: false, reason: 'wrong-session', messageKey: 'memory.refusal.wrong-session' };
    }
    return null;
  }

  /** Opaque audit for a cleared session, or null if it was never cleared. */
  getAgentMemoryClear(sessionId: string): { clearedAt: string; actor: string } | null {
    const row = this.store.getAgentMemoryClear(sessionId);
    return row === null ? null : { clearedAt: row.clearedAt, actor: row.actor };
  }

  // ---------------------------------------------------------------- settings

  getSettings(): AppSettings {
    return {
      locale: coerceLocale(this.store.getMeta(LOCALE_KEY)),
      theme: coerceTheme(this.store.getMeta(THEME_KEY)),
      showMaterialText: coerceShowMaterialText(this.store.getMeta(SHOW_MATERIAL_TEXT_KEY)),
      ambientSound: coerceAmbientSound(this.store.getMeta(AMBIENT_SOUND_KEY)),
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

  setAmbientSound(ambientSound: boolean): AppSettings {
    this.store.setMeta(AMBIENT_SOUND_KEY, ambientSound ? 'true' : 'false');
    return this.getSettings();
  }

  // --------------------------------------------------- structural proposals

  private proposalDeps() {
    return { store: this.store, now: this.clock, idFactory: this.idFactory };
  }

  /**
   * Builds a structural proposal bound to the session's current state.
   * The learner (or a later tool) must confirm it before it can execute.
   */
  proposeStructuralChange(input: {
    sessionId: string;
    kind: AgentProposalKind;
    payload: Record<string, unknown>;
    createdBy: string;
    idempotencyKey: string;
    ttlMs?: number;
  }): ProposeStructuralChangeResponse {
    const proposal = this.createStructuralProposal(input);
    if (proposal === null) return { proposal: null, event: null };
    /*
     * The announcement is an event, not a message: the log is where the asking is kept (#23), and
     * the renderer's one listening channel is the event push, so this is also how the confirmation
     * dialog learns there is something to confirm. Appended, never reduced — like
     * `AGENT_PROPOSAL_EXECUTED`, this is an audit fact, not a transition.
     */
    const event: AgentProposalProposedEvent = {
      id: this.idFactory(),
      sessionId: proposal.sessionId,
      at: proposal.proposedAt,
      type: 'AGENT_PROPOSAL_PROPOSED',
      source: 'agent',
      payload: { proposal },
    };
    this.store.appendEvent(event);
    return { proposal, event };
  }

  /**
   * Create without announcing — for the caller whose confirmation already happened (#209).
   *
   * The rescue's rewrite is proposed, confirmed and executed inside one accept: the tap was the
   * confirmation, so announcing a pending proposal would offer the learner a change that is already
   * done by the time the dialog could open.
   */
  private createStructuralProposal(input: {
    sessionId: string;
    kind: AgentProposalKind;
    payload: Record<string, unknown>;
    createdBy: string;
    idempotencyKey: string;
    ttlMs?: number;
  }): AgentProposal | null {
    return createAgentProposal(this.proposalDeps(), input);
  }

  confirmProposal(request: ConfirmProposalRequest): ProposalConfirmResult {
    return confirmAgentProposal(this.proposalDeps(), request);
  }

  /** The only structural write path: confirmed + idempotent + audited. */
  executeProposal(request: ExecuteProposalRequest): ProposalExecuteResult {
    return executeAgentProposal(this.proposalDeps(), request);
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
    // Carried on the session as well as in the blob, because the renderer only ever sees a session:
    // `engine_state` is the engine's own value object and is not part of any snapshot.
    taskOrder: engineState.taskOrder,
    updatedAt,
  };
}
