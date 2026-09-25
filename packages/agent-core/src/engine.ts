import { randomUUID } from 'node:crypto';
import type {
  AgentContext,
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
  RescueView,
  ResolveRescueRequest,
  ResolveRescueResponse,
  ResumeDecisionResponse,
  SessionSnapshot,
  SimulatorAvailability,
  SimulatorCommand,
  StartSessionResponse,
  ThemePreference,
  TutorAnswer,
  TutorAskRequest,
  TutorContextReport,
  TutorProviderInfo,
  TutorReply,
  TutorUnavailableReason,
} from '@focusloop/shared-types';
import {
  findMaterialForCourse,
  isRescueAction,
  isStuckReason,
  message,
} from '@focusloop/shared-types';
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
  buildRescuePlan,
  buildRescueView,
  estimatedMinutesFor,
  evaluateRescueSuccess,
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
import { buildTutorPrompt, buildTutorRetryPrompt, isRetryable, readTutorReply } from './tutor';
import {
  TutorTranscript,
  composeRetryPrompt,
  fallbackFor,
  formatAnswer,
  providerInfo,
  unsentReport,
} from './tutor-ask';

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
    return completeWithFallback(this.providers, {
      system,
      prompt,
      maxTokens: 2048,
      temperature: 0.3,
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
        rescue: null,
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
      rescue: policy.rescue,
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
      const decision = {
        action: intervention.action,
        state: intervention.state,
        reason: intervention.reason,
        confidence: 1,
        estimatedMinutes: estimatedMinutesFor(intervention.action),
        ...(intervention.answersRequestId === undefined
          ? {}
          : { answersRequestId: intervention.answersRequestId }),
      };
      const seed = {
        interventionId: intervention.id,
        sessionId,
        taskId: this.taskIdForIntervention(intervention),
      };
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
      return buildRescueView(decision, seed, outcome?.accepted ? 'active' : 'offered');
    }
    return null;
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
    return {
      outcome: this.store.getOutcomeByIntervention(intervention.id),
      rescue: this.getPendingRescue(request.sessionId),
    };
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
    return buildDashboardSummary({
      session: record.session,
      course: this.store.getCourse(record.session.courseId),
      outcomes: this.store.listOutcomes(record.session.id),
      checkpointCount: this.store.listCheckpoints(record.session.id).length,
      resumeTimings: this.store.listResumeTimings(record.session.id),
      checkpoints: this.store.listCheckpoints(record.session.id),
      events: this.store.listEvents(record.session.id),
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

  // ------------------------------------------------------- agent memory clear

  /**
   * Clears agent memory for one session — ADR
   * `docs/wiki/adr/0001-agent-memory-deletion.md`.
   *
   * - **Working**: tutor transcript (physical, in-process).
   * - **Episodic**: events, checkpoints, interventions, outcomes, resume_cards (physical, SQLite).
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
    return { clearedAt, actor };
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
