import { describe, expect, it } from 'vitest';
import {
  IpcValidationError,
  parseDispatchRequest,
  parseEndSession,
  parseImportMaterial,
  parseNoArgs,
  parseResolveIntervention,
  parseResumeDecision,
  parseSessionId,
  parseSimulatorCommand,
  parseStartSession,
} from './validate';

const CHANNEL = 'focusloop:test';

function expectFailure(fn: () => unknown): IpcValidationError {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(IpcValidationError);
    return error as IpcValidationError;
  }
  throw new Error('expected the validator to reject the payload');
}

describe('parseDispatchRequest', () => {
  const valid = {
    sessionId: 's1',
    type: 'TASK_STARTED',
    source: 'user',
    payload: { taskId: 't1' },
  };

  it('accepts a well formed event', () => {
    expect(parseDispatchRequest(CHANNEL, valid)).toMatchObject(valid);
  });

  it('rejects a non-object payload', () => {
    expectFailure(() => parseDispatchRequest(CHANNEL, 'nope'));
    expectFailure(() => parseDispatchRequest(CHANNEL, null));
    expectFailure(() => parseDispatchRequest(CHANNEL, []));
  });

  it('rejects a missing session id', () => {
    expectFailure(() => parseDispatchRequest(CHANNEL, { ...valid, sessionId: '' }));
  });

  it('rejects an unknown event type', () => {
    const error = expectFailure(() =>
      parseDispatchRequest(CHANNEL, { ...valid, type: 'ROOT_ACCESS' }),
    );
    expect(error.message).toContain('unknown learning event type');
  });

  it('rejects an unknown source', () => {
    expectFailure(() => parseDispatchRequest(CHANNEL, { ...valid, source: 'malware' }));
  });

  it('rejects a non-object payload field', () => {
    expectFailure(() => parseDispatchRequest(CHANNEL, { ...valid, payload: 'x' }));
    expectFailure(() => parseDispatchRequest(CHANNEL, { ...valid, payload: [] }));
    expectFailure(() => parseDispatchRequest(CHANNEL, { ...valid, payload: null }));
  });

  it('rejects an oversized payload', () => {
    const huge = { blob: 'x'.repeat(8 * 1024) };
    expectFailure(() => parseDispatchRequest(CHANNEL, { ...valid, payload: huge }));
  });

  it('passes through optional at and eventId', () => {
    const parsed = parseDispatchRequest(CHANNEL, {
      ...valid,
      at: '2026-01-01T00:00:00.000Z',
      eventId: 'ext-1',
    });
    expect(parsed.at).toBe('2026-01-01T00:00:00.000Z');
    expect(parsed.eventId).toBe('ext-1');
  });
});

describe('parseStartSession', () => {
  it('requires a course id', () => {
    expect(parseStartSession(CHANNEL, { courseId: 'c1' })).toEqual({ courseId: 'c1' });
    expectFailure(() => parseStartSession(CHANNEL, {}));
    expectFailure(() => parseStartSession(CHANNEL, { courseId: 42 }));
  });
});

describe('parseEndSession', () => {
  it('accepts every documented reason', () => {
    for (const reason of ['user', 'completed', 'timeout', 'crashed']) {
      expect(parseEndSession(CHANNEL, { sessionId: 's1', reason })).toEqual({
        sessionId: 's1',
        reason,
      });
    }
  });

  it('rejects an unknown reason', () => {
    expectFailure(() => parseEndSession(CHANNEL, { sessionId: 's1', reason: 'whatever' }));
  });
});

describe('parseImportMaterial', () => {
  it('accepts a file name and content', () => {
    expect(parseImportMaterial(CHANNEL, { fileName: 'a.md', content: 'body' })).toEqual({
      fileName: 'a.md',
      content: 'body',
    });
  });

  it('rejects a non-string content', () => {
    expectFailure(() => parseImportMaterial(CHANNEL, { fileName: 'a.md', content: 1 }));
  });
});

describe('parseResumeDecision', () => {
  it('requires a checkpoint id', () => {
    expect(parseResumeDecision(CHANNEL, { checkpointId: 'cp1' })).toEqual({ checkpointId: 'cp1' });
    expectFailure(() => parseResumeDecision(CHANNEL, {}));
  });
});

describe('parseResolveIntervention', () => {
  const valid = {
    interventionId: 'i1',
    accepted: true,
    dismissed: false,
    taskCompleted: false,
  };

  it('accepts booleans and no quiz outcome', () => {
    expect(parseResolveIntervention(CHANNEL, valid)).toMatchObject(valid);
  });

  it('normalises a missing quiz outcome to null', () => {
    expect(parseResolveIntervention(CHANNEL, valid).quizOutcome).toBeNull();
  });

  it('accepts a valid quiz outcome', () => {
    expect(
      parseResolveIntervention(CHANNEL, { ...valid, quizOutcome: 'correct' }).quizOutcome,
    ).toBe('correct');
  });

  it('rejects non-boolean flags', () => {
    expectFailure(() => parseResolveIntervention(CHANNEL, { ...valid, accepted: 'yes' }));
  });

  it('rejects an unknown quiz outcome', () => {
    expectFailure(() => parseResolveIntervention(CHANNEL, { ...valid, quizOutcome: 'maybe' }));
  });
});

describe('parseSimulatorCommand', () => {
  it('accepts the documented commands', () => {
    for (const command of ['distraction', 'return', 'confusion', 'overload', 'success']) {
      expect(parseSimulatorCommand(CHANNEL, { command, sessionId: 's1' })).toEqual({
        command,
        sessionId: 's1',
      });
    }
  });

  it('rejects an unknown command', () => {
    expectFailure(() => parseSimulatorCommand(CHANNEL, { command: 'exec', sessionId: 's1' }));
  });
});

describe('parseSessionId', () => {
  it('requires a value', () => {
    expect(parseSessionId(CHANNEL, { sessionId: 's1' })).toBe('s1');
    expectFailure(() => parseSessionId(CHANNEL, {}));
  });
});

describe('parseNoArgs', () => {
  it('accepts nothing', () => {
    expect(() => parseNoArgs(CHANNEL, undefined)).not.toThrow();
    expect(() => parseNoArgs(CHANNEL, null)).not.toThrow();
  });

  it('rejects any argument — these channels take none', () => {
    expectFailure(() => parseNoArgs(CHANNEL, { anything: true }));
  });
});
