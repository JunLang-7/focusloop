import { Injectable, signal, computed } from '@angular/core';
import {
  DEFAULT_INSIGHT_RANGE,
  DEFAULT_LOCALE,
  DEFAULT_SHOW_MATERIAL_TEXT,
  DEFAULT_THEME,
} from '@focusloop/shared-types';
import type {
  AppSettings,
  BridgeInfo,
  Course,
  DashboardSummary,
  DispatchEventResponse,
  FocusLoopApi,
  InsightRange,
  InsightsSummary,
  InterventionDecision,
  LearningEvent,
  LearningState,
  Locale,
  MaterialDocument,
  ResumeCardView,
  RescueView,
  AgentContextReport,
  RuntimeInfo,
  SessionSnapshot,
  ThemePreference,
} from '@focusloop/shared-types';

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

  readonly runtime = signal<RuntimeInfo | null>(null);
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
  readonly rescue = signal<RescueView | null>(null);
  readonly rescuePauseRequest = signal(0);
  readonly rescueContinueRequest = signal(0);
  readonly lastError = signal<string | null>(null);
  readonly busy = signal(false);
  readonly recentEvents = signal<readonly LearningEvent[]>([]);
  /**
   * What the agent would be given about the current moment, and what it would not (AG1).
   *
   * Built in the main process, where the course, the material and the log are. This is a display
   * copy: the developer inspector shows it and nothing here re-derives it, because a debug view that
   * computes its own version eventually shows something the agent never receives.
   */
  readonly agentContext = signal<AgentContextReport | null>(null);
  readonly locale = signal<Locale>(DEFAULT_LOCALE);
  readonly theme = signal<ThemePreference>(DEFAULT_THEME);
  /**
   * Whether a course shows the text it was generated from. The learner's own material is not
   * something to decide for them: the tasks stand on their own, and the full section is there for
   * whoever wants it.
   */
  readonly showMaterialText = signal<boolean>(DEFAULT_SHOW_MATERIAL_TEXT);
  readonly insights = signal<InsightsSummary | null>(null);
  readonly insightRange = signal<InsightRange>(DEFAULT_INSIGHT_RANGE);
  /**
   * The sidebar's ambient summary. Kept apart from `insights` on purpose: that one
   * belongs to whichever window the dashboard has selected, and a sidebar that
   * silently reset it to "today" every time an event arrived would be a bug.
   */
  readonly todayInsights = signal<InsightsSummary | null>(null);

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
      const [runtime, courses, materials, snapshot, dashboard, agentContext] = await Promise.all([
        this.api.getRuntimeInfo(),
        this.api.listCourses(),
        this.api.listMaterials(),
        this.api.getCurrentSession(),
        this.api.getDashboard(),
        this.api.getAgentContext(),
      ]);
      this.runtime.set(runtime);
      this.courses.set(courses);
      this.materials.set(materials);
      this.snapshot.set(snapshot);
      this.dashboard.set(dashboard);
      this.agentContext.set(agentContext);
      this.rescue.set(
        snapshot === null ? null : await this.api.getPendingRescue(snapshot.session.id),
      );
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
      };
    }
  }

  async setLocale(locale: Locale): Promise<void> {
    await this.run(async () => {
      const settings = await this.api.setLocale({ locale });
      // The store is the authority; reflect what it actually kept.
      this.locale.set(settings.locale);
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
      this.rescue.set(null);
      await this.refreshDerived();
    });
  }

  async endSession(reason: 'user' | 'completed' = 'user'): Promise<void> {
    const snapshot = this.snapshot();
    if (snapshot === null) return;
    await this.run(async () => {
      await this.api.endSession({ sessionId: snapshot.session.id, reason });
      await this.reloadSnapshot();
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
      this.rescue.set(response.rescue);
      this.decision.set(null);
      this.interventionId.set(null);
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
  async loadInsights(range: InsightRange): Promise<void> {
    this.insightRange.set(range);
    await this.run(async () => {
      this.insights.set(await this.api.getInsights({ range }));
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

  subscribeToEvents(): () => void {
    return this.api.onEvent(() => {
      void this.reloadSnapshot();
    });
  }

  private applyResponse(response: DispatchEventResponse | null): void {
    if (response === null) return;
    this.decision.set(response.decision);
    this.interventionId.set(response.interventionId);
    this.rescue.set(response.rescue);
    if (response.resumeCard !== null) this.resumeCard.set(response.resumeCard);
  }

  private async reloadSnapshot(): Promise<void> {
    const snapshot = await this.api.getCurrentSession();
    this.snapshot.set(snapshot);
    this.dashboard.set(await this.api.getDashboard());
    /*
     * Rebuilt on every event, not only on refresh: the inspector exists to be watched while a
     * session runs, so a copy that only updated at launch would show the empty state for the whole
     * of the one moment it is useful.
     */
    this.agentContext.set(await this.api.getAgentContext());
    if (snapshot !== null) {
      this.resumeCard.set(await this.api.getResumeCard(snapshot.session.id));
      this.rescue.set(await this.api.getPendingRescue(snapshot.session.id));
      this.recentEvents.set(await this.api.listEvents(snapshot.session.id));
    } else {
      /*
       * Everything derived from the session goes when the session does. The card is the
       * one that bites: it is a modal over the whole app, so a stale one does not just
       * look wrong, it blocks the screen it is covering.
       */
      this.resumeCard.set(null);
      this.rescue.set(null);
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
