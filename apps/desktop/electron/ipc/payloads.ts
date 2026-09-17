import type {
  DispatchEventRequest,
  EndSessionRequest,
  ImportMaterialRequest,
  InsightRange,
  InsightsRequest,
  Locale,
  ResumeDecisionRequest,
  ResolveInterventionRequest,
  SetLocaleRequest,
  SetThemeRequest,
  SimulatorCommand,
  StartSessionRequest,
  ThemePreference,
} from '@focusloop/shared-types';

/**
 * Payload builders shared by the preload script and the main-process validators.
 *
 * The renderer must never invent a payload shape: the same builder that the
 * preload sends with is the one the validator is tested against, so the two
 * sides of the bridge cannot drift apart.
 */
export const payload = {
  none: (): undefined => undefined,
  courseId: (courseId: string): { courseId: string } => ({ courseId }),
  sessionId: (sessionId: string): { sessionId: string } => ({ sessionId }),
  startSession: (courseId: string): StartSessionRequest => ({ courseId }),
  endSession: (sessionId: string, reason: EndSessionRequest['reason']): EndSessionRequest => ({
    sessionId,
    reason,
  }),
  importMaterial: (fileName: string, content: string): ImportMaterialRequest => ({
    fileName,
    content,
  }),
  resumeDecision: (checkpointId: string): ResumeDecisionRequest => ({ checkpointId }),
  resolveIntervention: (request: ResolveInterventionRequest): ResolveInterventionRequest => request,
  simulatorCommand: (
    command: SimulatorCommand['command'],
    sessionId: string,
  ): SimulatorCommand => ({
    command,
    sessionId,
  }),
  setLocale: (locale: Locale): SetLocaleRequest => ({ locale }),
  setTheme: (theme: ThemePreference): SetThemeRequest => ({ theme }),
  insights: (range: InsightRange): InsightsRequest => ({ range }),
  dispatchEvent: (request: DispatchEventRequest): DispatchEventRequest => request,
} as const;

export type PayloadBuilder = typeof payload;
