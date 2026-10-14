import { Injectable, effect, signal, computed } from '@angular/core';
import {
  DEFAULT_AMBIENT_SOUND,
  DEFAULT_CLOCK_FORMAT,
  DEFAULT_INSIGHT_RANGE,
  DEFAULT_LOCALE,
  DEFAULT_SHOW_MATERIAL_TEXT,
  DEFAULT_THEME,
} from '@focusloop/shared-types';
import type {
  AppSettings,
  AnswerSourceResponse,
  ClockFormat,
  MoodEntry,
  BridgeInfo,
  Course,
  DashboardSummary,
  DataInfo,
  DeleteDataResponse,
  DispatchEventResponse,
  FocusLoopApi,
  InsightRange,
  InsightsSummary,
  InterventionDecision,
  LearningEvent,
  LearningState,
  Locale,
  AgentProposal,
  ProposalConfirmResult,
  ProposalDeclineResult,
  ProposalExecuteResult,
  MaterialDocument,
  ModelSettings,
  LlmSettings,
  SaveProviderRequest,
  ActiveModelSelection,
  TestModelResult,
  DiscoverModelsRequest,
  DiscoverModelsResult,
  QuizAnswerResponse,
  QuizAnswerResult,
  ResumeCardView,
  RescueView,
  TutorAnswer,
  TutorMode,
  RuntimeInfo,
  SessionSnapshot,
  ThemePreference,
  AgentMemorySummaryResult,
  LearnerPreferenceCandidatesResult,
  LearnerPreferenceListResult,
  PreferenceDeleteResult,
  WeeklyReflection,
} from '@focusloop/shared-types';
import type { FocusNoticeFold } from './focus-notice';
import type { MessageKey } from './i18n/messages.en';
import { answerSourceNote, insertAnswerText } from './step-answer';
import { shouldSuggestRescueText } from './rescue-suggestion';
import { LEARNER_ANSWER_CHARACTERS } from '@focusloop/shared-types';

declare global {
  interface Window {
    focusloop: FocusLoopApi;
  }
}

export interface MaterialImportResult {
  readonly title: string;
  readonly conceptsCreated: number;
  readonly microTasksCreated: number;
}

export function focusLoopApi(): FocusLoopApi {
  const api = globalThis.window?.focusloop;
  if (api === undefined) {
    throw new Error(
      'The FocusLoop bridge is unavailable. The renderer must run inside the Electron shell.',
    );
  }
  return api;
}

/**
 * Single source of renderer state. Every value comes from the main process; the
 * renderer never computes domain decisions itself.
 */
@Injectable({ providedIn: 'root' })
export class AppStateService {
  private readonly api = focusLoopApi();

  constructor() {
    /*
     * One loader for every snapshot there has ever been: boot (`refresh` sets it directly), a start
     * (the wrapper sets the signal itself), an end, and every event push through `reloadSnapshot`.
     * Chasing those paths with individual calls is how the panel showed "no session" over a running
     * one — the effect watches the signal they all write, and that is the whole contract. It reads
     * `snapshot` through `loadMemorySummary` before the first await, so every change re-fires it.
     */
    effect(() => {
      void this.loadMemorySummary();
      void this.loadPreferences();
      void this.loadPreferenceCandidates();
    });
  }

  readonly runtime = signal<RuntimeInfo | null>(null);
  /**
   * The model in use, and whether a key is configured (#255).
   *
   * Its own signal rather than a field of `runtime`: `runtime` is read once at launch and describes the
   * build, while this is a setting the learner changes while the app is running — and the surface that
   * changes it has to see the new value arrive rather than keep showing what was true at start-up.
   */
  readonly model = signal<ModelSettings | null>(null);
  readonly llmSettings = signal<LlmSettings | null>(null);
  readonly courses = signal<readonly Course[]>([]);
  /**
   * The parsed documents behind imported courses. A course keeps concept summaries and tasks; the
   * text that was uploaded lives here and nowhere else, so this is what makes the material readable
   * inside the application instead of only quizzed.
   */
  readonly materials = signal<readonly MaterialDocument[]>([]);
  readonly snapshot = signal<SessionSnapshot | null>(null);
  readonly resumeCard = signal<ResumeCardView | null>(null);
  readonly dashboard = signal<DashboardSummary | null>(null);
  readonly decision = signal<InterventionDecision | null>(null);
  readonly interventionId = signal<string | null>(null);
  /** The card as the engine hands it over; `rescue` below overlays the generated line (#205). */
  private readonly rescueBase = signal<RescueView | null>(null);
  /**
   * A generated line for one intervention — in-memory by design: display-only, it survives event
   * pushes (the overlay below) and dies with the app, so nothing generated is ever written.
   */
  private readonly rescueSuggestion = signal<RescueView | null>(null);
  /** One generation call per card, whatever else happens — the pass is a call, not a loop. */
  private readonly rescueGenerationAttempted = new Set<string>();
  /** The card on screen: the engine's view with a generated line overlaid while it still belongs. */
  readonly rescue = computed<RescueView | null>(() => {
    const base = this.rescueBase();
    const suggested = this.rescueSuggestion();
    return suggested !== null && base !== null && suggested.interventionId === base.interventionId
      ? suggested
      : base;
  });
  readonly rescuePauseRequest = signal(0);
  /**
   * A structural proposal waiting for the learner (#209).
   *
   * Set from the event push — the proposal rides in the event's payload, because that push is the
   * one channel the renderer already listens on and the dialog must show the very object the
   * confirmation will be bound to.
   */
  readonly pendingProposal = signal<AgentProposal | null>(null);
  readonly rescueContinueRequest = signal(0);
  /** Presentation only: folding must never dismiss a rescue or a checkpoint. */
  readonly focusNoticeFold = signal<FocusNoticeFold>({ sessionId: null, folded: false });
  readonly lastError = signal<string | null>(null);
  readonly busy = signal(false);
  readonly recentEvents = signal<readonly LearningEvent[]>([]);
  /**
   * What the data panel shows of the agent's memory (AG7.5): the whole input, metadata only.
   * `null` before the first read — distinct from a refusal, which is an answer.
   */
  readonly memorySummary = signal<AgentMemorySummaryResult | null>(null);
  /** This week as counts and quoted preferences (AG6.5) — cross-session, like the dashboard's views. */
  readonly weeklyReflection = signal<WeeklyReflection | null>(null);
  /** Stored preferences for this session (AG7.4), read the same way as the summary. */
  readonly preferences = signal<LearnerPreferenceListResult | null>(null);
  /** This session's suggestion candidates (AG6.6) — derived with evidence, stored nowhere. */
  readonly preferenceCandidates = signal<LearnerPreferenceCandidatesResult | null>(null);
  readonly preferenceNotice = signal<MessageKey | null>(null);
  /**
   * The tutor's last result, all three outcomes included, **and the step it was about**.
   *
   * Not an error signal: a rejected answer and an unreachable model are outcomes the learner reads, and
   * putting them in `lastError` would show them in the error banner *and* leave the panel empty.
   *
   * The task id is here because an answer is about the step it was asked on. The panel is unmounted when
   * the step changes, so without it the first time the learner opened the panel on the *next* step they
   * read the previous step's answer — `tutorAnswerApplies` is the rule, and it is checked where the step
   * is known.
   */
  readonly tutorAnswer = signal<{
    readonly taskId: string | null;
    readonly answer: TutorAnswer;
  } | null>(null);
  /**
   * A request from a step's answer box to the tutor panel: this text, in this mode, opened.
   *
   * The panel consumes it by setting it back to `null`, so each request is acted on exactly once. It is
   * deliberately still a signal rather than a callback: the panel is created and destroyed with the step
   * it sits in, and a request that is never consumed must not be lost when its consumer is.
   *
   * The alternative — remembering the last request inside the panel — was tried and failed, because the
   * panel does not outlive the step: the next step's panel remembered nothing, found this signal still
   * set, and opened over the new step quoting the answer from the previous one.
   */
  readonly tutorCheckRequest = signal<{ readonly mode: TutorMode; readonly text: string } | null>(
    null,
  );
  /**
   * The step's answer box, its chosen option and its verdict, as one piece of state.
   *
   * One, rather than one per surface, because three surfaces can show that box: the step itself, the
   * resume notice above it, and the resume card on every other route. Two copies of "what the learner
   * wrote" would mean an answer written in the notice vanishing the moment the notice was continued —
   * and the learner's own words are the one thing in this app that must not be lost between two places
   * that look like the same field.
   *
   * Held here rather than in the page for the same reason the tutor's request is: the state outlives
   * the component that shows it. It is cleared when a step starts and when one is finished, never when
   * a route changes — a half-written answer that survives a trip to the dashboard is a feature, not a
   * leak.
   */
  readonly stepAnswer = signal('');
  readonly stepChoice = signal<number | null>(null);
  readonly stepVerdict = signal<QuizAnswerResult | null>(null);
  /**
   * What to say about the last file attached to the box, or `null` when there is nothing to say.
   *
   * A key and a file name rather than a sentence: the wording is the shell's, in both languages, and the
   * name is the learner's own file. Cleared with the step, like the box it is about.
   */
  readonly answerSourceNote = signal<{
    readonly key: MessageKey;
    readonly params: { readonly name: string };
  } | null>(null);
  readonly locale = signal<Locale>(DEFAULT_LOCALE);
  readonly theme = signal<ThemePreference>(DEFAULT_THEME);
  /**
   * Whether a course shows the text it was generated from. The learner's own material is not
   * something to decide for them: the tasks stand on their own, and the full section is there for
   * whoever wants it.
   */
  readonly showMaterialText = signal<boolean>(DEFAULT_SHOW_MATERIAL_TEXT);
  /**
   * Whether the learner wants the generated ambient layer (#57).
   *
   * A preference the store owns, and deliberately not a playback state: the sound itself is started
   * and stopped by a running session, so remembering `true` across a restart cannot make sound begin
   * on its own.
   */
  readonly ambientSound = signal<boolean>(DEFAULT_AMBIENT_SOUND);
  /** `24h` writes `13:05`, `12h` writes `1:05 PM`. A display preference, stored by the store. */
  readonly clockFormat = signal<ClockFormat>(DEFAULT_CLOCK_FORMAT);
  /**
   * Where the database is, as the main process resolved it.
   *
   * Read rather than assembled: the renderer has no business knowing that `%APPDATA%` exists, and a path
   * built here could disagree with the file the app actually opened. Null until it has been asked for.
   */
  readonly dataInfo = signal<DataInfo | null>(null);
  readonly insights = signal<InsightsSummary | null>(null);
  readonly insightRange = signal<InsightRange>(DEFAULT_INSIGHT_RANGE);
  /**
   * The sidebar's ambient summary. Kept apart from `insights` on purpose: that one
   * belongs to whichever window the dashboard has selected, and a sidebar that
   * silently reset it to "today" every time an event arrived would be a bug.
   */
  readonly todayInsights = signal<InsightsSummary | null>(null);
  /**
   * The day's wellbeing check-in and its recent history.
   *
   * Its own read, not part of the insights window: "how do I feel today" is a question about the day,
   * not about whichever range the dashboard happens to be showing.
   */
  readonly moodToday = signal<MoodEntry | null>(null);
  readonly moodHistory = signal<readonly MoodEntry[]>([]);

  readonly state = computed<LearningState>(() => this.snapshot()?.session.state ?? 'READY');
  readonly hasSession = computed(() => this.snapshot() !== null);
  readonly currentCourse = computed<Course | null>(() => {
    const snapshot = this.snapshot();
    if (snapshot === null) return null;
    return this.courses().find((course) => course.id === snapshot.session.courseId) ?? null;
  });
  readonly currentTask = computed(() => {
    const course = this.currentCourse();
    const taskId = this.snapshot()?.session.currentTaskId;
    if (course === null || taskId === undefined) return null;
    return course.microTasks.find((task) => task.id === taskId) ?? null;
  });
  readonly progress = computed(() => this.snapshot()?.progress ?? null);

  async refresh(): Promise<void> {
    await this.run(async () => {
      const [runtime, courses, materials, snapshot, dashboard, model] = await Promise.all([
        this.api.getRuntimeInfo(),
        this.api.listCourses(),
        this.api.listMaterials(),
        this.api.getCurrentSession(),
        this.api.getDashboard(),
        this.api.getModelSettings(),
      ]);
      this.runtime.set(runtime);
      this.model.set(model);
      this.courses.set(courses);
      this.materials.set(materials);
      this.snapshot.set(snapshot);
      this.dashboard.set(dashboard);
      this.rescueBase.set(
        snapshot === null ? null : await this.api.getPendingRescue(snapshot.session.id),
      );
      this.maybeSuggestRescueText();
      this.resumeCard.set(
        snapshot === null ? null : await this.api.getResumeCard(snapshot.session.id),
      );
      /*
       * The log has to be loaded here too, not only in `reloadSnapshot`.
       *
       * `refresh` is the launch path, and without this the dashboard showed "No events
       * recorded yet" for a session that had plenty of them — the list stayed empty
       * until the learner happened to cause one more event.
       */
      this.recentEvents.set(
        snapshot === null ? [] : await this.api.listEvents(snapshot.session.id),
      );
    });
    await this.refreshToday();
  }

  /**
   * Re-reads the sidebar summary.
   *
   * Deliberately not routed through `run()`: that would clear `lastError` and flip
   * `busy` on every event, and a decoration failing to load must not raise a banner
   * over the page the learner is actually using. A stale summary is the right
   * failure mode.
   */
  private async refreshToday(): Promise<void> {
    try {
      this.todayInsights.set(await this.api.getInsights({ range: 'today' }));
    } catch {
      // Intentionally swallowed. See above.
    }
  }

  /**
   * Restores the interface language and theme. Called once at startup, before the
   * first paint that shows any chrome, so the window never flashes the wrong
   * language or the wrong theme.
   */
  async loadSettings(): Promise<AppSettings> {
    try {
      return await this.api.getSettings();
    } catch (error) {
      this.lastError.set(error instanceof Error ? error.message : String(error));
      return {
        locale: DEFAULT_LOCALE,
        theme: DEFAULT_THEME,
        showMaterialText: DEFAULT_SHOW_MATERIAL_TEXT,
        ambientSound: DEFAULT_AMBIENT_SOUND,
        clockFormat: DEFAULT_CLOCK_FORMAT,
      };
    }
  }

  async setLocale(locale: Locale): Promise<void> {
    await this.run(async () => {
      const settings = await this.api.setLocale({ locale });
      // The store is the authority; reflect what it actually kept.
      this.locale.set(settings.locale);
      /*
       * The built-in course is written in the language the learner just chose and the main process
       * re-seeds it here, so the catalogue is re-read rather than left showing the language it was
       * seeded in. A course that is already running is unaffected: the ids do not move, only their
       * words.
       */
      await this.refresh();
    });
  }

  async setTheme(theme: ThemePreference): Promise<void> {
    await this.run(async () => {
      const settings = await this.api.setTheme({ theme });
      this.theme.set(settings.theme);
    });
  }

  async setShowMaterialText(showMaterialText: boolean): Promise<void> {
    await this.run(async () => {
      const settings = await this.api.setShowMaterialText({ showMaterialText });
      this.showMaterialText.set(settings.showMaterialText);
    });
  }

  async setAmbientSound(ambientSound: boolean): Promise<void> {
    await this.run(async () => {
      const settings = await this.api.setAmbientSound({ ambientSound });
      this.ambientSound.set(settings.ambientSound);
    });
  }

  async setClockFormat(clockFormat: ClockFormat): Promise<void> {
    await this.run(async () => {
      const settings = await this.api.setClockFormat({ clockFormat });
      this.clockFormat.set(settings.clockFormat);
    });
  }

  async loadLlmSettings(): Promise<void> {
    this.llmSettings.set(await this.api.getLlmSettings());
    this.model.set(await this.api.getModelSettings());
  }

  private async updateLlm(settings: LlmSettings): Promise<void> {
    this.llmSettings.set(settings);
    this.model.set(await this.api.getModelSettings());
    this.runtime.set(await this.api.getRuntimeInfo());
  }

  async saveLlmProvider(request: SaveProviderRequest): Promise<void> {
    await this.updateLlm(await this.api.saveLlmProvider(request));
  }
  async removeLlmProvider(providerConfigId: string): Promise<void> {
    await this.updateLlm(await this.api.removeLlmProvider({ providerConfigId }));
  }
  async clearLlmProviderKey(providerConfigId: string): Promise<void> {
    await this.updateLlm(await this.api.clearLlmProviderKey({ providerConfigId }));
  }
  async selectLlmModel(selection: ActiveModelSelection | null): Promise<void> {
    await this.updateLlm(await this.api.selectLlmModel({ selection }));
  }
  async discoverLlmModels(request: DiscoverModelsRequest): Promise<DiscoverModelsResult> {
    return this.api.discoverLlmModels(request);
  }
  async testLlmModel(selection: ActiveModelSelection): Promise<TestModelResult> {
    const result = await this.api.testLlmModel(selection);
    await this.loadLlmSettings();
    return result;
  }

  /**
   * Loads where the data is.
   *
   * Swallowed like the sidebar summary, and for the same reason: a path that fails to load leaves the
   * panel showing nothing, and that is not worth a banner over the page the learner is using.
   */
  async loadDataInfo(): Promise<void> {
    try {
      this.dataInfo.set(await this.api.getDataInfo());
    } catch {
      this.dataInfo.set(null);
    }
  }

  /** Returns whether the OS showed the folder, so the caller can say so when it did not. */
  async openDataFolder(): Promise<boolean> {
    try {
      return (await this.api.openDataFolder()).opened;
    } catch {
      // The same news as `opened: false` — the folder did not appear — so it is reported once, there.
      return false;
    }
  }

  /**
   * Deletes everything the app has stored, then puts the renderer back where a first run would leave it.
   *
   * Returns the main process's own account rather than a boolean, because "it is still there" has a
   * reason and the learner has to read it. `null` means the request itself failed, which the error banner
   * already reports.
   *
   * The stored state is dropped **before** it is reloaded, and that order is the point. `refresh` reads the
   * database through six calls inside `run`, whose `catch` turns a failure into `lastError` — so a refresh
   * that failed *after* a successful deletion would leave the session the learner was just in on screen,
   * underneath a message saying that everything had been deleted. Clearing first makes a failed reload end in
   * a first-run screen rather than a stale one, which would be a lie.
   *
   * There are two ways that can end, and `usable` is what separates them.
   *
   * - The database was replaced: the settings and the summary are re-read and the screen is repopulated. This
   *   is the ordinary path.
   * - The database could not be opened again: nothing below the guard can be read, so the reload is skipped
   *   and the screen stays on the first-run state the clearing produced. No internal "database is not open" in
   *   the banner over a deletion that worked, and the data panel reports the restart. One thing is knowingly
   *   left stale there, and it is the one that cannot be fixed from here: the locale and theme were stored in
   *   the database that was just deleted, and re-reading them needs the database. They follow the restart.
   *
   * The settings are re-read for the same kind of reason: they lived in the database that was just deleted, so
   * the shell would otherwise keep showing a language and a theme that no longer exist.
   */
  async deleteAllData(): Promise<DeleteDataResponse | null> {
    let outcome: DeleteDataResponse | null = null;

    await this.run(async () => {
      outcome = await this.api.deleteAllData({ confirmed: true });
      if (!outcome.ok) return;

      this.forgetStoredState();

      /*
       * And stop here when the database could not be opened again. Every read below goes through the closed
       * store, so the reload would fail into `lastError` — an internal message in the banner, over a deletion
       * that succeeded, next to the restart notice that says the same thing properly. The screen is already
       * the first-run state the learner should see.
       */
      if (!outcome.usable) return;

      const settings = await this.loadSettings();
      this.locale.set(settings.locale);
      this.theme.set(settings.theme);
      this.showMaterialText.set(settings.showMaterialText);
      this.clockFormat.set(settings.clockFormat);

      await this.refresh();
      await this.reloadInsightsQuietly();
    });

    return outcome;
  }

  /**
   * Drops everything the renderer holds that came out of the database.
   *
   * `refresh` reloads the database-derived ones (the session, the log, the card, the rescue, the dashboard,
   * the courses, the material) and `reloadInsightsQuietly` reloads
   * the insights window. What is left is what has no session to belong to any more — the tutor's last
   * answer, the pending decision and the intervention it refers to, and the focus-notice fold — and those
   * are meant to stay empty rather than come back.
   */
  private forgetStoredState(): void {
    this.snapshot.set(null);
    this.recentEvents.set([]);
    this.resumeCard.set(null);
    this.rescueBase.set(null);
    this.rescueSuggestion.set(null);
    this.dashboard.set(null);
    this.courses.set([]);
    this.materials.set([]);
    this.tutorAnswer.set(null);
    this.decision.set(null);
    this.interventionId.set(null);
    this.insights.set(null);
    this.todayInsights.set(null);
    this.weeklyReflection.set(null);
    this.preferenceCandidates.set(null);
    this.preferenceNotice.set(null);
    this.pendingProposal.set(null);
    this.focusNoticeFold.set({ sessionId: null, folded: false });
  }

  /**
   * Re-reads the dashboard's window after a delete.
   *
   * Quiet like `refreshToday`, and for the same reason: a window that fails to reload must not raise a
   * banner over a deletion that already succeeded.
   */
  private async reloadInsightsQuietly(): Promise<void> {
    try {
      this.insights.set(await this.api.getInsights({ range: this.insightRange() }));
    } catch {
      this.insights.set(null);
    }
    try {
      this.weeklyReflection.set(await this.api.getWeeklyReflection());
    } catch {
      // Same rule as the insights reload: a window that will not load must not raise a banner.
      this.weeklyReflection.set(null);
    }
  }

  async startSession(courseId: string): Promise<void> {
    await this.run(async () => {
      const response = await this.api.startSession({ courseId });
      this.snapshot.set({
        session: response.session,
        progress: {
          sessionId: response.session.id,
          totalTasks:
            this.courses().find((course) => course.id === courseId)?.microTasks.length ?? 0,
          completedTasks: 0,
          completionRatio: 0,
          elapsedMs: 0,
        },
        courseTitle: this.courses().find((course) => course.id === courseId)?.title ?? null,
        checkpoints: [],
      });
      this.resumeCard.set(null);
      this.decision.set(null);
      this.rescueBase.set(null);
      this.rescueSuggestion.set(null);
      await this.refreshDerived();
    });
  }

  async endSession(reason: 'user' | 'completed' = 'user'): Promise<void> {
    const snapshot = this.snapshot();
    if (snapshot === null) return;
    await this.run(async () => {
      await this.api.endSession({ sessionId: snapshot.session.id, reason });
      await this.reloadSnapshot();
      /*
       * The tutor's last answer goes with the session, for the same reason the transcript does in the main
       * process: it is an answer about the step the learner was on, and leaving it on screen over a
       * finished session is the state `getCurrentSession` was already fixed not to have.
       */
      this.tutorAnswer.set(null);
    });
  }

  /**
   * Hands the step's answer to the tutor panel, with the mode that checks it.
   *
   * The panel owns whether it is open, what is in its box and which mode is chosen, so this asks rather
   * than does. It fills the box and opens; it does **not** send. A model call the learner did not press
   * for — spending a request, on text they can no longer edit — is the one thing this must not do, and
   * leaving the last press to them is also what lets them correct a typo before it costs anything.
   */
  requestTutorCheck(mode: TutorMode, text: string): void {
    this.tutorCheckRequest.set({ mode, text });
  }

  /**
   * The box and its verdict belong to one step: nothing of them survives starting another.
   *
   * Called when a step starts and when one is finished, and by the notice when it is showing a
   * *different* step's box than the one on screen — the rule is "one answer, for the step in front of
   * you", and every caller is a moment where that step has changed.
   */
  clearStepAnswer(): void {
    this.stepAnswer.set('');
    this.stepChoice.set(null);
    this.stepVerdict.set(null);
    this.answerSourceNote.set(null);
  }

  /**
   * Asks for a file and puts what is in it into the box.
   *
   * The reading happens in the main process — a PDF, a Word document and a photograph are three readers
   * that need a file system — and this is the shell's half: the picker, then the text, then the line that
   * says where the text came from. A refusal is a value rather than an exception, because it is about the
   * learner's own document (the wrong kind, too large, a scan with no words on it) and a red banner about
   * an internal error is the wrong way to say any of those.
   */
  async attachAnswerSource(): Promise<void> {
    const response = await this.pickAnswerSource();
    if (response === null) return;

    this.answerSourceNote.set(answerSourceNote(response));
    if (response.source === null) return;
    const { text } = response.source;
    this.stepAnswer.update((current) => insertAnswerText(current, text, LEARNER_ANSWER_CHARACTERS));
  }

  /**
   * The picker, which is a call of its own so the caller gets a value rather than a closure.
   *
   * `run` reports a failed call in the banner and returns nothing, which is right for every other channel
   * here — and wrong for this one, whose result is the whole point. So the request is raised through it
   * and its answer is handed back, exactly as `answerQuiz` does for the same reason.
   */
  private async pickAnswerSource(): Promise<AnswerSourceResponse | null> {
    let response: AnswerSourceResponse | null = null;
    await this.run(async () => {
      response = await this.api.pickAnswerSource();
    });
    return response;
  }

  /**
   * Answers the quiz this step asks, and returns the verdict for the screen to show.
   *
   * The grading is the main process's (see `focusloop:quiz:answer`): the screen sends the option and is
   * told whether it was right, which is also what makes the event the state machine reacts to a fact
   * rather than a renderer's opinion about a question it happens to be holding.
   */
  async answerQuiz(taskId: string, choiceIndex: number): Promise<QuizAnswerResponse | null> {
    const snapshot = this.snapshot();
    if (snapshot === null) return null;
    let response: QuizAnswerResponse | null = null;
    await this.run(async () => {
      response = await this.api.answerQuiz({
        sessionId: snapshot.session.id,
        taskId,
        choiceIndex,
      });
      this.applyResponse(response);
      await this.reloadSnapshot();
    });
    return response;
  }

  /**
   * Asks the tutor about the step in front of the learner (AG3 step three).
   *
   * **The question is the only thing sent.** The transcript lives in the main process and the renderer
   * neither holds it nor supplies it — `TutorAskRequest` has no field for turns — so this method takes the
   * mode and the learner's words and nothing else.
   *
   * The result is stored rather than returned, because all three outcomes are values the panel renders:
   * an answer, a refusal, and an unreachable model are three different screens and none of them is an
   * exception. A throw from the bridge — the session-ended backstop — is left to `run`, which is where every
   * other channel's failure goes.
   */
  async askTutor(mode: TutorMode, question: string): Promise<void> {
    const snapshot = this.snapshot();
    if (snapshot === null) return;
    /*
     * Cleared first, so the moment a question is asked the previous answer stops being on screen. Leaving
     * it there under a spinner would show the learner an answer to a question they have moved on from,
     * which is the same confusion as keeping it across a step.
     */
    this.tutorAnswer.set(null);
    await this.run(async () => {
      this.tutorAnswer.set({
        taskId: snapshot.session.currentTaskId ?? null,
        answer: await this.api.askTutor({ sessionId: snapshot.session.id, mode, question }),
      });
    });
  }

  async dispatch(
    type: LearningEvent['type'],
    payload: Record<string, unknown> = {},
  ): Promise<DispatchEventResponse | null> {
    const snapshot = this.snapshot();
    if (snapshot === null) return null;
    let response: DispatchEventResponse | null = null;
    await this.run(async () => {
      response = await this.api.dispatchEvent({
        sessionId: snapshot.session.id,
        type,
        source: 'user',
        payload,
      });
      this.applyResponse(response);
      await this.reloadSnapshot();
    });
    return response;
  }

  async acceptResume(): Promise<void> {
    const card = this.resumeCard();
    if (card === null) return;
    await this.run(async () => {
      await this.api.acceptResume({ checkpointId: card.timing.checkpointId });
      this.resumeCard.set(null);
      await this.reloadSnapshot();
    });
  }

  async dismissResume(): Promise<void> {
    const card = this.resumeCard();
    if (card === null) return;
    await this.run(async () => {
      await this.api.dismissResume({ checkpointId: card.timing.checkpointId });
      this.resumeCard.set(null);
      await this.reloadSnapshot();
    });
  }

  async dismissIntervention(accepted: boolean): Promise<void> {
    const rescue = this.rescue();
    if (rescue !== null) {
      await this.resolveRescue(accepted ? 'accept' : 'dismiss');
      return;
    }
    const interventionId = this.interventionId();
    if (interventionId === null) {
      this.decision.set(null);
      return;
    }
    await this.run(async () => {
      await this.api.resolveIntervention({
        interventionId,
        accepted,
        dismissed: !accepted,
        taskCompleted: false,
      });
      this.decision.set(null);
      this.interventionId.set(null);
    });
  }

  async resolveRescue(resolution: 'accept' | 'dismiss' | 'continue'): Promise<void> {
    const rescue = this.rescue();
    if (rescue === null) return;
    await this.run(async () => {
      const response = await this.api.resolveRescue({
        sessionId: rescue.sessionId,
        interventionId: rescue.interventionId,
        resolution,
      });
      if (
        resolution === 'accept' &&
        rescue.decision.action === 'BREAK' &&
        response.outcome?.accepted
      ) {
        this.rescuePauseRequest.update((count) => count + 1);
      }
      if (
        resolution === 'continue' &&
        rescue.decision.action === 'BREAK' &&
        response.outcome?.continuedAt !== undefined
      ) {
        this.rescueContinueRequest.update((count) => count + 1);
      }
      this.rescueBase.set(response.rescue);
      this.maybeSuggestRescueText();
      this.decision.set(null);
      this.interventionId.set(null);
      /*
       * An accepted MICRO_START narrows the task the learner is on, and continuing it hands the whole
       * task back; both are served through the course list, so it is refetched rather than patched
       * here. A refusal (a task that is already small) simply returns the course unchanged.
       */
      if (resolution === 'accept' || resolution === 'continue') {
        this.courses.set(await this.api.listCourses());
      }
      this.dashboard.set(await this.api.getDashboard());
    });
  }

  async simulate(
    command: 'distraction' | 'return' | 'confusion' | 'overload' | 'success',
  ): Promise<void> {
    const snapshot = this.snapshot();
    if (snapshot === null) return;
    await this.run(async () => {
      const response = await this.api.simulate({ command, sessionId: snapshot.session.id });
      this.applyResponse(response);
      await this.reloadSnapshot();
    });
  }

  /**
   * Returns the counts, not a sentence: the renderer owns the wording, and the
   * store has no idea what language the learner reads.
   */
  async importMaterial(fileName: string, content: string): Promise<MaterialImportResult | null> {
    let result: MaterialImportResult | null = null;
    await this.run(async () => {
      const imported = await this.api.importMaterial({ fileName, content });
      result = {
        title: imported.title,
        conceptsCreated: imported.conceptsCreated,
        microTasksCreated: imported.microTasksCreated,
      };
      /*
       * Both, not just the courses.
       *
       * An import writes a course and the document it came from, and the course only carries
       * summaries. Reloading the list alone left the new course without its text until the next
       * launch — the concept cards rendered and the material behind them did not.
       */
      const [courses, materials] = await Promise.all([
        this.api.listCourses(),
        this.api.listMaterials(),
      ]);
      this.courses.set(courses);
      this.materials.set(materials);
    });
    return result;
  }

  /**
   * Re-aggregates the dashboard for a window. The main process owns the maths;
   * the renderer only decides which range the learner asked for.
   */
  async loadMood(): Promise<void> {
    await this.run(async () => {
      this.moodToday.set(await this.api.getMood());
      this.moodHistory.set(await this.api.listMoods({ limit: 14 }));
    });
  }

  async saveMood(mood: number, note: string): Promise<void> {
    await this.run(async () => {
      const entry = await this.api.saveMood({ mood, note });
      this.moodToday.set(entry);
      this.moodHistory.set(await this.api.listMoods({ limit: 14 }));
    });
  }

  async loadInsights(range: InsightRange): Promise<void> {
    this.insightRange.set(range);
    await this.run(async () => {
      this.insights.set(await this.api.getInsights({ range }));
      // The week shares the insights lifecycle — page init, range change, post-delete reload — so
      // the two windows are read at the same moments and cannot drift into different truths (AG6.5).
      try {
        this.weeklyReflection.set(await this.api.getWeeklyReflection());
      } catch {
        this.weeklyReflection.set(null);
      }
    });
  }

  /** Bridge status and pairing token, shown to the user so they can pair the extension. */ async loadBridgeInfo(): Promise<BridgeInfo | null> {
    try {
      return await this.api.getBridgeInfo();
    } catch (error) {
      this.lastError.set(error instanceof Error ? error.message : String(error));
      return null;
    }
  }

  /**
   * Reads this session's memory summary. Asks the engine even when nothing is running (with no id):
   * the engine's `no-session` refusal is the answer the panel shows, and inventing the refusal here
   * would put the wording in two places.
   */
  /** Reads this session's preferences; the no-session answer is composed locally, as above. */
  async loadPreferences(): Promise<void> {
    const sessionId = this.snapshot()?.session.id;
    if (sessionId === undefined || sessionId === '') {
      this.preferences.set({
        ok: false,
        reason: 'no-session',
        messageKey: 'memory.refusal.no-session',
      });
      return;
    }
    this.preferences.set(await this.api.listPreferences(sessionId));
  }

  /**
   * Reads this session's suggestions, same gate, same refusal composition (AG6.6). The candidate
   * list is read-only — the renderer displays it and #236's confirm flow is the only writer.
   */
  async loadPreferenceCandidates(): Promise<void> {
    const sessionId = this.snapshot()?.session.id;
    if (sessionId === undefined || sessionId === '') {
      this.preferenceCandidates.set({
        ok: false,
        reason: 'no-session',
        messageKey: 'memory.refusal.no-session',
      });
      return;
    }
    this.preferenceCandidates.set(await this.api.listPreferenceCandidates(sessionId));
  }

  /**
   * Forgets one preference and re-reads both views it moves: the list loses the row and the memory
   * summary's preference count drops with it — the same write→delete→query the engine spec pins.
   */
  async forgetPreference(id: string): Promise<PreferenceDeleteResult | null> {
    const sessionId = this.snapshot()?.session.id;
    if (sessionId === undefined || sessionId === '') return null;
    const result = await this.api.deletePreference({ id, sessionId });
    // Forget also scrubs confirmation snapshots; reload the event cache and reflection quotes.
    await Promise.all([
      this.loadPreferences(),
      this.loadMemorySummary(),
      this.reloadSnapshot(),
      this.reloadInsightsQuietly(),
    ]);
    return result;
  }

  async loadMemorySummary(): Promise<void> {
    const sessionId = this.snapshot()?.session.id;
    if (sessionId === undefined || sessionId === '') {
      /*
       * The boundary requires a non-empty id — a call with '' is a malformed request, not a session
       * to inspect — so the no-session answer is composed here from the same shared key the engine
       * returns: one constant, two honest callers, and no rejected promise left to swallow the load.
       */
      this.memorySummary.set({
        ok: false,
        reason: 'no-session',
        messageKey: 'memory.refusal.no-session',
      });
      return;
    }
    this.memorySummary.set(await this.api.getMemorySummary(sessionId));
  }

  /**
   * Clears session memory through the tested engine path (ADR 0001), then re-reads so the panel
   * shows the zeros and the opaque audit rather than the counts that were there a moment ago.
   */
  async clearSessionMemory(): Promise<{ clearedAt: string; actor: string } | null> {
    const sessionId = this.snapshot()?.session.id;
    if (sessionId === undefined) return null;
    const cleared = await this.api.clearAgentMemory(sessionId);
    if (cleared !== null) await this.loadMemorySummary();
    return cleared;
  }

  /**
   * What the engine did without being asked: an event from the bridge, a tick, a demo command.
   *
   * The response is applied the same way a renderer action's own response is (`applyResponse`), and
   * that is the point: the decision used to ride back only to the caller, so an intervention taken in
   * the main process was applied, stored, and visible to nobody — the panel appeared only after the
   * window itself had acted. One push, one path: whoever caused the event, the learner sees what the
   * agent decided about it (#204).
   */
  subscribeToEvents(): () => void {
    return this.api.onDispatch((response) => {
      this.applyResponse(response);
      if (response.event.type === 'AGENT_PROPOSAL_PROPOSED') {
        this.pendingProposal.set(response.event.payload.proposal);
      }
      void this.reloadSnapshot();
    });
  }

  /** Ask to store a suggestion. Only its identity crosses IPC; main supplies the frozen claim. */
  async proposePreference(candidateId: string): Promise<void> {
    const sessionId = this.snapshot()?.session.id;
    if (sessionId === undefined || this.pendingProposal() !== null || this.busy()) return;
    await this.run(async () => {
      this.preferenceNotice.set(null);
      const response = await this.api.proposeStructuralChange({
        sessionId,
        kind: 'reversible-write',
        payload: { preferenceCandidateId: candidateId },
        createdBy: 'ag6.suggestion',
        idempotencyKey: candidateId,
      });
      if (response.proposal === null)
        this.preferenceNotice.set('proposal.refusal.unknown-proposal');
      else this.pendingProposal.set(response.proposal);
      await this.loadPreferenceCandidates();
    });
  }

  async declineProposal(proposal: AgentProposal): Promise<ProposalDeclineResult> {
    const result = await this.api.declineProposal({
      proposalId: proposal.id,
      sessionId: proposal.sessionId,
      expectedHash: proposal.proposalHash,
    });
    if (result.ok && 'preference' in proposal.payload) {
      this.preferenceNotice.set('app.reflection.declined');
      await this.loadPreferenceCandidates();
    }
    return result;
  }

  /** Confirm a pending proposal, bound to the hash the dialog showed (#209). */
  async confirmProposal(proposal: AgentProposal): Promise<ProposalConfirmResult> {
    return this.api.confirmProposal({
      proposalId: proposal.id,
      sessionId: proposal.sessionId,
      expectedHash: proposal.proposalHash,
    });
  }

  /** Execute what was confirmed. Nothing reaches this without a `confirmProposal` first. */
  async executeProposal(proposal: AgentProposal): Promise<ProposalExecuteResult> {
    return this.api.executeProposal({
      proposalId: proposal.id,
      sessionId: proposal.sessionId,
      idempotencyKey: proposal.idempotencyKey,
    });
  }

  /**
   * The renderer's own action just wrote an event that nothing pushed (#209): executing a proposal
   * appends `AGENT_PROPOSAL_EXECUTED` in the main process, and the event list the learner is
   * looking at refreshes on pushes and on its own actions — this is one of those.
   */
  refreshAfterOwnAction(): void {
    void this.reloadSnapshot();
  }

  /**
   * Asks for a generated line once per card, and only when a provider is configured (#205).
   *
   * Every decline — offline default, config not known yet, a card with nothing to write — keeps
   * the grounded quote already on screen; a failed or invalid reply arrives as the API's `null`
   * and does the same. Nothing here can empty a card.
   */
  private maybeSuggestRescueText(): void {
    const base = this.rescueBase();
    if (
      base === null ||
      !shouldSuggestRescueText({
        rescue: base,
        providerOffline: this.runtime()?.providerOffline,
        attempted: this.rescueGenerationAttempted,
      })
    ) {
      return;
    }
    const sessionId = this.snapshot()?.session.id;
    if (sessionId === undefined || sessionId === '') return;
    this.rescueGenerationAttempted.add(base.interventionId);
    const interventionId = base.interventionId;
    void this.api
      .generateRescueText(sessionId)
      .then((view) => {
        // Land only on the same card: a later rescue supersedes the line rather than inheriting it.
        if (view !== null && this.rescueBase()?.interventionId === interventionId) {
          this.rescueSuggestion.set(view);
        }
      })
      .catch(() => {
        // The offline floor: an error keeps the grounded quote already on screen — silently.
      });
  }

  private applyResponse(response: DispatchEventResponse | null): void {
    if (response === null) return;
    this.decision.set(response.decision);
    this.interventionId.set(response.interventionId);
    this.rescueBase.set(response.rescue);
    this.maybeSuggestRescueText();
    if (response.resumeCard !== null) this.resumeCard.set(response.resumeCard);
  }

  private async reloadSnapshot(): Promise<void> {
    const snapshot = await this.api.getCurrentSession();
    this.snapshot.set(snapshot);
    this.dashboard.set(await this.api.getDashboard());
    if (snapshot !== null) {
      this.resumeCard.set(await this.api.getResumeCard(snapshot.session.id));
      this.rescueBase.set(await this.api.getPendingRescue(snapshot.session.id));
      this.maybeSuggestRescueText();
      this.recentEvents.set(await this.api.listEvents(snapshot.session.id));
    } else {
      /*
       * Everything derived from the session goes when the session does. The card is the
       * one that bites: it is a modal over the whole app, so a stale one does not just
       * look wrong, it blocks the screen it is covering.
       */
      this.resumeCard.set(null);
      this.rescueBase.set(null);
      this.rescueSuggestion.set(null);
      this.recentEvents.set([]);
    }
    await this.refreshToday();
  }

  private async refreshDerived(): Promise<void> {
    this.dashboard.set(await this.api.getDashboard());
  }

  private async run(action: () => Promise<void>): Promise<void> {
    this.busy.set(true);
    this.lastError.set(null);
    try {
      await action();
    } catch (error) {
      this.lastError.set(error instanceof Error ? error.message : String(error));
    } finally {
      this.busy.set(false);
    }
  }
}
