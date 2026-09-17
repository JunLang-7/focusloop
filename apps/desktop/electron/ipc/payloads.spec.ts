import { describe, expect, it } from 'vitest';
import { IPC_CHANNELS, SUPPORTED_LOCALES } from '@focusloop/shared-types';
import { payload } from './payloads';
import {
  parseCourseId,
  parseDispatchRequest,
  parseEndSession,
  parseImportMaterial,
  parseNoArgs,
  parseResolveIntervention,
  parseResumeDecision,
  parseSessionId,
  parseSetLocale,
  parseSimulatorCommand,
  parseStartSession,
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
  });
});
