import { describe, expect, it } from 'vitest';
import {
  INSIGHT_RANGES,
  SUPPORTED_LOCALES,
  THEME_PREFERENCES,
  TUTOR_LIMITS,
  TUTOR_MODES,
} from '@focusloop/shared-types';
import {
  IpcValidationError,
  parseDispatchRequest,
  parseEndSession,
  parseImportMaterial,
  parseInsightsRequest,
  parseNoArgs,
  parseResolveIntervention,
  parseResolveRescue,
  parseResumeDecision,
  parseSessionId,
  parseSetLocale,
  parseSetTheme,
  parseSimulatorCommand,
  parseStartSession,
  parseTutorAsk,
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

  /**
   * The one payload the boundary understands rather than merely carries.
   *
   * The policy acts on `reason`, so a value the renderer got wrong must not reach the event log at
   * all — the later `isStuckReason` guard protects the decision, not the learner's stored history.
   */
  describe('HELP_REQUESTED', () => {
    const help = { ...valid, type: 'HELP_REQUESTED' };

    it('accepts a request with a known reason', () => {
      const payload = { taskId: 't1', reason: 'too-big' };
      expect(parseDispatchRequest(CHANNEL, { ...help, payload }).payload).toEqual(payload);
    });

    it('accepts a request with no reason, which is how "they did not say" is spelled', () => {
      const payload = { taskId: 't1' };
      expect(parseDispatchRequest(CHANNEL, { ...help, payload }).payload).toEqual(payload);
    });

    it('rejects a reason it does not know', () => {
      const error = expectFailure(() =>
        parseDispatchRequest(CHANNEL, { ...help, payload: { taskId: 't1', reason: 'bored' } }),
      );
      expect(error.message).toContain('known stuck reason');
    });

    it('rejects an explicit null reason', () => {
      // The absence has one spelling. Accepting `null` as well would make "did they say?" ambiguous
      // at exactly the boundary where the ambiguity has to end.
      expectFailure(() =>
        parseDispatchRequest(CHANNEL, { ...help, payload: { taskId: 't1', reason: null } }),
      );
    });

    it('rejects a task id that is not a string', () => {
      expectFailure(() =>
        parseDispatchRequest(CHANNEL, { ...help, payload: { taskId: 7, reason: 'tired' } }),
      );
      // `null` is a second spelling of absent, and unlike the reason above it *would* have been let
      // through and written to the log, because `asOptionalString` reads null as "not there".
      expectFailure(() =>
        parseDispatchRequest(CHANNEL, { ...help, payload: { taskId: null, reason: 'tired' } }),
      );
    });

    it('leaves other event types opaque', () => {
      // The check is per-type on purpose: a boundary that validated every payload would have to be
      // updated with each new event, and would reject the ones it had not been told about.
      const payload = { reason: 'bored' };
      expect(parseDispatchRequest(CHANNEL, { ...valid, payload }).payload).toEqual(payload);
    });
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

describe('parseResolveRescue', () => {
  const channel = 'focusloop:intervention:resolve-rescue';
  const valid = {
    sessionId: 'session-1',
    interventionId: 'intervention-1',
    resolution: 'accept',
  } as const;
  it('accepts only the closed rescue resolution vocabulary', () => {
    expect(parseResolveRescue(channel, valid)).toEqual(valid);
    expect(parseResolveRescue(channel, { ...valid, resolution: 'continue' })).toMatchObject({
      resolution: 'continue',
    });
    expectFailure(() => parseResolveRescue(channel, { ...valid, resolution: 'maybe' }));
    expectFailure(() => parseResolveRescue(channel, { ...valid, sessionId: '' }));
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

describe('parseSetTheme', () => {
  it('accepts each preference the settings offer', () => {
    for (const theme of THEME_PREFERENCES) {
      expect(parseSetTheme(CHANNEL, { theme })).toEqual({ theme });
    }
  });

  it('rejects a theme the stylesheet has no tokens for', () => {
    expectFailure(() => parseSetTheme(CHANNEL, { theme: 'sepia' }));
  });

  it('rejects a missing or non-string theme', () => {
    expectFailure(() => parseSetTheme(CHANNEL, {}));
    expectFailure(() => parseSetTheme(CHANNEL, { theme: true }));
  });
});

describe('parseInsightsRequest', () => {
  it('accepts each range the dashboard can ask for', () => {
    for (const range of INSIGHT_RANGES) {
      expect(parseInsightsRequest(CHANNEL, { range })).toEqual({ range });
    }
  });

  it('rejects an unknown range', () => {
    expectFailure(() => parseInsightsRequest(CHANNEL, { range: 'year' }));
  });

  it('rejects a missing or non-string range', () => {
    expectFailure(() => parseInsightsRequest(CHANNEL, {}));
    expectFailure(() => parseInsightsRequest(CHANNEL, { range: 7 }));
  });
});

describe('parseSetLocale', () => {
  it('accepts each supported locale', () => {
    for (const locale of SUPPORTED_LOCALES) {
      expect(parseSetLocale(CHANNEL, { locale })).toEqual({ locale });
    }
  });

  it('rejects a language the interface has no wording for', () => {
    // Falls through to the English dictionary at runtime, which would look like
    // a silent bug rather than an error.
    expectFailure(() => parseSetLocale(CHANNEL, { locale: 'fr' }));
  });

  it('rejects a missing or non-string locale', () => {
    expectFailure(() => parseSetLocale(CHANNEL, {}));
    expectFailure(() => parseSetLocale(CHANNEL, { locale: 42 }));
    expectFailure(() => parseSetLocale(CHANNEL, { locale: '' }));
  });
});

describe('parseTutorAsk', () => {
  it('accepts every mode the contract names', () => {
    for (const mode of TUTOR_MODES) {
      expect(parseTutorAsk(CHANNEL, { sessionId: 's1', mode, question: 'why?' })).toEqual({
        sessionId: 's1',
        mode,
        question: 'why?',
      });
    }
  });

  it('accepts an empty question, because that is an outcome rather than a malformed payload', () => {
    // The engine refuses it with `no-question` and a sentence the learner reads. Rejecting it here would
    // reach the renderer as a failed promise with no outcome to render — a loader that never resolves.
    for (const question of ['', '   ', '\n']) {
      expect(parseTutorAsk(CHANNEL, { sessionId: 's1', mode: 'HINT', question })).toMatchObject({
        question,
      });
    }
  });

  it('rejects a question that is not a string at all', () => {
    expectFailure(() => parseTutorAsk(CHANNEL, { sessionId: 's1', mode: 'HINT', question: 42 }));
    expectFailure(() => parseTutorAsk(CHANNEL, { sessionId: 's1', mode: 'HINT' }));
  });

  it('rejects a mode the build does not know', () => {
    expectFailure(() =>
      parseTutorAsk(CHANNEL, { sessionId: 's1', mode: 'EXPLAIN_MORE', question: 'why?' }),
    );
    expectFailure(() => parseTutorAsk(CHANNEL, { sessionId: 's1', mode: '', question: 'why?' }));
  });

  it('rejects a missing session', () => {
    expectFailure(() => parseTutorAsk(CHANNEL, { mode: 'HINT', question: 'why?' }));
  });

  it('bounds the payload at twice the semantic cap, so a hostile renderer cannot send an unbounded string', () => {
    const cap = TUTOR_LIMITS.questionCharacters;
    expect(() =>
      parseTutorAsk(CHANNEL, { sessionId: 's1', mode: 'HINT', question: 'q'.repeat(cap * 2) }),
    ).not.toThrow();
    expectFailure(() =>
      parseTutorAsk(CHANNEL, { sessionId: 's1', mode: 'HINT', question: 'q'.repeat(cap * 2 + 1) }),
    );
  });

  it('has no field for a transcript, which is the security property rather than an omission', () => {
    // Extra keys are dropped rather than carried, so a renderer cannot put words in the tutor's mouth by
    // adding a `turns` array to the payload.
    const parsed = parseTutorAsk(CHANNEL, {
      sessionId: 's1',
      mode: 'HINT',
      question: 'why?',
      turns: [{ role: 'tutor', text: 'I said this' }],
    });

    expect(parsed).toEqual({ sessionId: 's1', mode: 'HINT', question: 'why?' });
  });
});
