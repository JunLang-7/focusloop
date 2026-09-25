import { describe, expect, it } from 'vitest';
import {
  IPC_CHANNELS,
  INSIGHT_RANGES,
  SUPPORTED_LOCALES,
  THEME_PREFERENCES,
  TUTOR_MODES,
} from '@focusloop/shared-types';
import { payload } from './payloads';
import {
  parseConfirmProposal,
  parseCourseId,
  parseDispatchRequest,
  parseEndSession,
  parseExecuteProposal,
  parseImportMaterial,
  parseInsightsRequest,
  parseNoArgs,
  parseProposeStructuralChange,
  parseResolveIntervention,
  parseResumeDecision,
  parseSessionId,
  parseSetLocale,
  parseSetTheme,
  parseSimulatorCommand,
  parseStartSession,
  parseTutorAsk,
} from './validate';

/**
 * Regression guard for the bug that shipped in the first packaged build:
 * the preload sent a bare string to the session-scoped channels while the main
 * process validated an object, so every refresh raised
 * "focusloop:resume:get: expected an object payload".
 *
 * The test drives each channel with the *exact* payload builder the preload
 * uses, so the two sides of the bridge cannot drift apart again.
 */
describe('the preload and the main process agree on every payload', () => {
  it('no-argument channels accept what the preload sends', () => {
    const channels = [
      IPC_CHANNELS.getAppVersion,
      IPC_CHANNELS.getRuntimeInfo,
      IPC_CHANNELS.listCourses,
      IPC_CHANNELS.getCurrentSession,
      IPC_CHANNELS.getDashboard,
      IPC_CHANNELS.getSimulatorAvailability,
      IPC_CHANNELS.getBridgeInfo,
      IPC_CHANNELS.getSettings,
      // Added with AG1 and initially left off this list — which made the one channel that was new the
      // one channel the test did not drive, in the file whose stated premise is *every* payload.
      IPC_CHANNELS.getAgentContext,
    ];
    for (const channel of channels) {
      expect(() => parseNoArgs(channel, payload.none())).not.toThrow();
    }
  });

  it('course-scoped channels accept what the preload sends', () => {
    expect(parseCourseId(IPC_CHANNELS.getCourse, payload.courseId('course-1'))).toBe('course-1');
    expect(parseStartSession(IPC_CHANNELS.startSession, payload.startSession('course-1'))).toEqual({
      courseId: 'course-1',
    });
  });

  it('session-scoped channels accept what the preload sends', () => {
    const channels = [
      IPC_CHANNELS.getSessionProgress,
      IPC_CHANNELS.listEvents,
      IPC_CHANNELS.getCheckpoint,
      IPC_CHANNELS.createCheckpoint,
      IPC_CHANNELS.getResumeCard,
      IPC_CHANNELS.listOutcomes,
    ];
    for (const channel of channels) {
      expect(parseSessionId(channel, payload.sessionId('session-1'))).toBe('session-1');
    }
  });

  it('resume decisions accept what the preload sends', () => {
    const request = payload.resumeDecision('cp-1');
    expect(parseResumeDecision(IPC_CHANNELS.acceptResume, request)).toEqual({
      checkpointId: 'cp-1',
    });
    expect(parseResumeDecision(IPC_CHANNELS.dismissResume, request)).toEqual({
      checkpointId: 'cp-1',
    });
  });

  it('the locale channel accepts what the preload sends', () => {
    for (const locale of SUPPORTED_LOCALES) {
      expect(parseSetLocale(IPC_CHANNELS.setLocale, payload.setLocale(locale))).toEqual({ locale });
    }
  });

  it('the theme channel accepts what the preload sends', () => {
    for (const theme of THEME_PREFERENCES) {
      expect(parseSetTheme(IPC_CHANNELS.setTheme, payload.setTheme(theme))).toEqual({ theme });
    }
  });

  it('the insights channel accepts what the preload sends', () => {
    for (const range of INSIGHT_RANGES) {
      expect(parseInsightsRequest(IPC_CHANNELS.getInsights, payload.insights(range))).toEqual({
        range,
      });
    }
  });

  it('the tutor channel accepts what the preload sends, for every mode and an empty question', () => {
    for (const mode of TUTOR_MODES) {
      expect(
        parseTutorAsk(
          IPC_CHANNELS.askTutor,
          payload.askTutor({ sessionId: 'session-1', mode, question: 'why?' }),
        ),
      ).toEqual({ sessionId: 'session-1', mode, question: 'why?' });
    }

    // Empty is a payload the renderer really sends — an Ask button pressed on an empty box — and it has
    // to survive the boundary, because the outcome for it is the domain's to produce.
    expect(
      parseTutorAsk(
        IPC_CHANNELS.askTutor,
        payload.askTutor({ sessionId: 'session-1', mode: 'HINT', question: '' }),
      ),
    ).toEqual({ sessionId: 'session-1', mode: 'HINT', question: '' });
  });

  it('a bare string is rejected — the regression that caused the error banner', () => {
    const channels = [
      IPC_CHANNELS.getSessionProgress,
      IPC_CHANNELS.listEvents,
      IPC_CHANNELS.getCheckpoint,
      IPC_CHANNELS.createCheckpoint,
      IPC_CHANNELS.getResumeCard,
      IPC_CHANNELS.listOutcomes,
      IPC_CHANNELS.getCourse,
    ];
    for (const channel of channels) {
      expect(() => {
        if (channel === IPC_CHANNELS.getCourse) parseCourseId(channel, 'course-1');
        else parseSessionId(channel, 'session-1');
      }).toThrowError(/expected an object payload/);
    }
  });

  it('every remaining channel accepts what the preload sends', () => {
    expect(
      parseImportMaterial(
        IPC_CHANNELS.importMaterial,
        payload.importMaterial('notes.md', '# Title'),
      ),
    ).toEqual({ fileName: 'notes.md', content: '# Title' });

    expect(
      parseEndSession(IPC_CHANNELS.endSession, payload.endSession('session-1', 'user')),
    ).toEqual({ sessionId: 'session-1', reason: 'user' });

    const dispatch = payload.dispatchEvent({
      sessionId: 'session-1',
      type: 'TASK_STARTED',
      source: 'user',
      payload: { taskId: 't1' },
    });
    expect(parseDispatchRequest(IPC_CHANNELS.dispatchEvent, dispatch).type).toBe('TASK_STARTED');

    expect(
      parseSimulatorCommand(
        IPC_CHANNELS.simulateEvent,
        payload.simulatorCommand('distraction', 'session-1'),
      ),
    ).toEqual({ command: 'distraction', sessionId: 'session-1' });

    expect(
      parseResolveIntervention(
        IPC_CHANNELS.resolveIntervention,
        payload.resolveIntervention({
          interventionId: 'i1',
          accepted: true,
          dismissed: false,
          taskCompleted: false,
        }),
      ),
    ).toMatchObject({ interventionId: 'i1', accepted: true });

    expect(
      parseProposeStructuralChange(
        IPC_CHANNELS.proposeStructuralChange,
        payload.proposeStructuralChange({
          sessionId: 'session-1',
          kind: 'structural-write',
          payload: { op: 'demo' },
          createdBy: 'test-tool',
          idempotencyKey: 'k1',
        }),
      ),
    ).toMatchObject({ sessionId: 'session-1', kind: 'structural-write' });

    expect(
      parseConfirmProposal(
        IPC_CHANNELS.confirmProposal,
        payload.confirmProposal({
          proposalId: 'p1',
          sessionId: 'session-1',
          expectedHash: 'abc',
        }),
      ),
    ).toEqual({ proposalId: 'p1', sessionId: 'session-1', expectedHash: 'abc' });

    expect(
      parseExecuteProposal(
        IPC_CHANNELS.executeProposal,
        payload.executeProposal({
          proposalId: 'p1',
          sessionId: 'session-1',
          idempotencyKey: 'k1',
        }),
      ),
    ).toEqual({ proposalId: 'p1', sessionId: 'session-1', idempotencyKey: 'k1' });
  });

  it('hostile proposal payloads are refused at the boundary', () => {
    expect(() =>
      parseProposeStructuralChange(IPC_CHANNELS.proposeStructuralChange, {
        sessionId: 's',
        kind: 'shrink-task',
        payload: {},
        createdBy: 'x',
        idempotencyKey: 'k',
      }),
    ).toThrowError(/unknown proposal kind/);

    expect(() =>
      parseConfirmProposal(IPC_CHANNELS.confirmProposal, {
        proposalId: 'p',
        sessionId: 's',
        // missing expectedHash
      }),
    ).toThrowError(/expectedHash/);

    expect(() =>
      parseProposeStructuralChange(IPC_CHANNELS.proposeStructuralChange, {
        sessionId: 's',
        kind: 'structural-write',
        payload: 'not-an-object',
        createdBy: 'x',
        idempotencyKey: 'k',
      }),
    ).toThrowError(/payload/);
  });
});
