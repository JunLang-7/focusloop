import { Injectable, signal, computed } from '@angular/core';
import type {
  BridgeInfo,
  Course,
  DashboardSummary,
  DispatchEventResponse,
  FocusLoopApi,
  InterventionDecision,
  LearningEvent,
  LearningState,
  ResumeCardView,
  RuntimeInfo,
  SessionSnapshot,
} from '@focusloop/shared-types';

declare global {
  interface Window {
    focusloop: FocusLoopApi;
  }
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
  readonly snapshot = signal<SessionSnapshot | null>(null);
  readonly resumeCard = signal<ResumeCardView | null>(null);
  readonly dashboard = signal<DashboardSummary | null>(null);
  readonly decision = signal<InterventionDecision | null>(null);
  readonly interventionId = signal<string | null>(null);
  readonly lastError = signal<string | null>(null);
  readonly busy = signal(false);
  readonly recentEvents = signal<readonly LearningEvent[]>([]);

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
      const [runtime, courses, snapshot, dashboard] = await Promise.all([
        this.api.getRuntimeInfo(),
        this.api.listCourses(),
        this.api.getCurrentSession(),
        this.api.getDashboard(),
      ]);
      this.runtime.set(runtime);
      this.courses.set(courses);
      this.snapshot.set(snapshot);
      this.dashboard.set(dashboard);
      this.resumeCard.set(
        snapshot === null ? null : await this.api.getResumeCard(snapshot.session.id),
      );
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

  async importMaterial(fileName: string, content: string): Promise<string | null> {
    let summary: string | null = null;
    await this.run(async () => {
      const result = await this.api.importMaterial({ fileName, content });
      summary = `${result.title}: ${result.conceptsCreated} concepts, ${result.microTasksCreated} micro tasks`;
      this.courses.set(await this.api.listCourses());
    });
    return summary;
  }

  /** Bridge status and pairing token, shown to the user so they can pair the extension. */
  async loadBridgeInfo(): Promise<BridgeInfo | null> {
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
    if (response.resumeCard !== null) this.resumeCard.set(response.resumeCard);
  }

  private async reloadSnapshot(): Promise<void> {
    const snapshot = await this.api.getCurrentSession();
    this.snapshot.set(snapshot);
    this.dashboard.set(await this.api.getDashboard());
    if (snapshot !== null) {
      this.resumeCard.set(await this.api.getResumeCard(snapshot.session.id));
      this.recentEvents.set(await this.api.listEvents(snapshot.session.id));
    }
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
