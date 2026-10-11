import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DispatchEventRequest, DispatchEventResponse } from '@focusloop/shared-types';

/*
 * `electron` is mocked for the same reason `service.spec.ts` mocks it: this module is main-process
 * code and there is no Electron runtime under vitest. `app` is an emitter the spec drives by hand —
 * which is exactly what the sensor subscribes to, so the spec presses the same buttons Electron
 * would, and `powerMonitor` is a number the spec decides.
 */
const handlers = new Map<string, () => void>();
let idleSeconds = 0;

vi.mock('electron', () => ({
  app: {
    on: (event: string, handler: () => void) => {
      handlers.set(event, handler);
    },
    off: (event: string) => {
      handlers.delete(event);
    },
  },
  powerMonitor: {
    getSystemIdleTime: () => idleSeconds,
  },
}));

const { distractionSensorEnabled, startDistractionSensor, systemIdleSeconds } =
  await import('./distraction-sensor');

const IDLE_THRESHOLD = 120_000;

/**
 * What a fake engine hands back.
 *
 * The sensor reads nothing from the response — the router is what publishes it — so the fields are
 * irrelevant to what is under test. Built once rather than cast at each double, so the one place
 * that pretends is one place to look.
 */
function ignoredResponse(): DispatchEventResponse {
  return {
    event: null,
    state: 'FOCUSED',
    checkpoint: null,
    resumeCard: null,
    decision: null,
    interventionId: null,
    rescue: null,
  } as unknown as DispatchEventResponse;
}

interface Dispatched extends DispatchEventRequest {
  readonly at?: string;
}

function harness(options: { sessionId?: string | null; now?: string } = {}) {
  const dispatched: Dispatched[] = [];
  const engine = {
    dispatch: (request: DispatchEventRequest) => {
      dispatched.push(request as Dispatched);
      return ignoredResponse();
    },
    getCurrentSession: () =>
      options.sessionId === null ? null : { session: { id: options.sessionId ?? 'session-1' } },
  };
  const clock = { value: options.now ?? '2026-01-01T00:00:00.000Z' };
  const sensor = startDistractionSensor(engine, {
    now: () => clock.value,
    idleSeconds: () => idleSeconds,
    idleThresholdMs: IDLE_THRESHOLD,
  });
  return { dispatched, sensor, clock, engine };
}

function isoPlus(ms: number): string {
  return new Date(Date.parse('2026-01-01T00:00:00.000Z') + ms).toISOString();
}

function blur(): void {
  handlers.get('browser-window-blur')?.();
}

function focus(): void {
  handlers.get('browser-window-focus')?.();
}

describe('the distraction sensor', () => {
  beforeEach(() => {
    handlers.clear();
    idleSeconds = 0;
    vi.restoreAllMocks();
  });

  it('treats a blur that arrives before the window was ever focused as nothing', () => {
    /*
     * The one failure this design is built around. A launch that opens behind another window is not
     * the learner leaving, and a runner where focus never arrives must not have every assertion about
     * a focused session invalidated by a `TAB_LEFT` nobody caused.
     */
    const { dispatched } = harness();
    blur();
    expect(dispatched).toEqual([]);
  });

  it('reports leaving on a real blur, and returning with how long it lasted', () => {
    const { dispatched, clock } = harness();
    focus();
    blur();
    clock.value = isoPlus(30_000);
    focus();

    expect(dispatched.map((event) => event.type)).toEqual(['TAB_LEFT', 'TAB_RETURNED']);
    expect(dispatched[0]?.source).toBe('system');
    expect(dispatched[1]?.payload).toEqual({ awayMs: 30_000 });
  });

  it('measures the absence from the blur, not from the last focus it happened to see', () => {
    const { dispatched, clock } = harness();
    focus();
    clock.value = isoPlus(5_000);
    blur();
    clock.value = isoPlus(65_000);
    focus();
    expect(dispatched[1]?.payload).toEqual({ awayMs: 60_000 });
  });

  it('reports nothing while there is no session to report against', () => {
    const { dispatched } = harness({ sessionId: null });
    focus();
    blur();
    focus();
    expect(dispatched).toEqual([]);
  });

  it('says nothing about idle time below the domain threshold', () => {
    const { dispatched, sensor } = harness();
    idleSeconds = (IDLE_THRESHOLD - 1_000) / 1000;
    sensor.sample();
    expect(dispatched).toEqual([]);
  });

  it('dates the idle report when the silence began, so the rule is not waited out twice', () => {
    const { dispatched, clock, sensor } = harness();
    clock.value = isoPlus(IDLE_THRESHOLD + 4_000);
    idleSeconds = (IDLE_THRESHOLD + 4_000) / 1000;
    sensor.sample();

    expect(dispatched).toHaveLength(1);
    expect(dispatched[0]?.type).toBe('IDLE_STARTED');
    // The start of the silence, not the moment it was noticed: `idleSince` is what the domain counts from.
    expect(dispatched[0]?.at).toBe(isoPlus(0));
  });

  it('reports idle once, however many times it is sampled', () => {
    const { dispatched, clock, sensor } = harness();
    clock.value = isoPlus(IDLE_THRESHOLD + 4_000);
    idleSeconds = (IDLE_THRESHOLD + 4_000) / 1000;
    sensor.sample();
    sensor.sample();
    sensor.sample();
    expect(dispatched).toHaveLength(1);
  });

  it('reports the return with the measured idle span, and can report a second idle after it', () => {
    const { dispatched, clock, sensor } = harness();
    clock.value = isoPlus(IDLE_THRESHOLD + 4_000);
    idleSeconds = (IDLE_THRESHOLD + 4_000) / 1000;
    sensor.sample();

    idleSeconds = 0;
    clock.value = isoPlus(IDLE_THRESHOLD + 10_000);
    sensor.sample();

    expect(dispatched.map((event) => event.type)).toEqual(['IDLE_STARTED', 'IDLE_ENDED']);
    // The whole silence, counted from where it began rather than from where it was noticed.
    expect(dispatched[1]?.payload).toEqual({ idleMs: IDLE_THRESHOLD + 10_000 });

    clock.value = isoPlus(IDLE_THRESHOLD + 200_000);
    idleSeconds = (IDLE_THRESHOLD + 100_000) / 1000;
    sensor.sample();
    expect(dispatched.map((event) => event.type)).toEqual([
      'IDLE_STARTED',
      'IDLE_ENDED',
      'IDLE_STARTED',
    ]);
  });

  it('forgets a pending idle when the session goes away, rather than resuming into a new one', () => {
    let sessionId: string | null = 'session-1';
    const dispatched: Dispatched[] = [];
    const engine = {
      dispatch: (request: DispatchEventRequest) => {
        dispatched.push(request as Dispatched);
        return ignoredResponse();
      },
      getCurrentSession: () => (sessionId === null ? null : { session: { id: sessionId } }),
    };
    const sensor = startDistractionSensor(engine, {
      now: () => isoPlus(500_000),
      idleSeconds: () => idleSeconds,
      idleThresholdMs: IDLE_THRESHOLD,
    });

    idleSeconds = (IDLE_THRESHOLD + 4_000) / 1000;
    sensor.sample();
    expect(dispatched).toHaveLength(1);

    // The session ended while the learner was away. The next idle stretch is a new observation.
    sessionId = null;
    idleSeconds = 0;
    sensor.sample();
    sessionId = 'session-2';
    idleSeconds = (IDLE_THRESHOLD + 4_000) / 1000;
    sensor.sample();

    expect(dispatched.map((event) => event.type)).toEqual(['IDLE_STARTED', 'IDLE_STARTED']);
    expect(dispatched[1]?.sessionId).toBe('session-2');
  });

  it('stops reporting once disposed — a torn-down service must not be written to', () => {
    const { dispatched, sensor } = harness();
    focus();
    sensor.dispose();
    // Both entry points: the window listeners are gone, and the ticker still holds this handle.
    blur();
    idleSeconds = (IDLE_THRESHOLD + 4_000) / 1000;
    sensor.sample();
    expect(dispatched).toEqual([]);
  });

  it('reports a failure to record rather than throwing out of a timer callback', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    handlers.clear();
    idleSeconds = 0;
    let failNext = false;
    const engine = {
      dispatch: () => {
        if (failNext) throw new Error('the store is closed');
        return ignoredResponse();
      },
      getCurrentSession: () => ({ session: { id: 'session-1' } }),
    };
    const sensor = startDistractionSensor(engine, {
      now: () => isoPlus(0),
      idleSeconds: () => idleSeconds,
      idleThresholdMs: IDLE_THRESHOLD,
    });
    // Focus first: a blur before any focus is deliberately ignored, so it would prove nothing here.
    focus();
    failNext = true;
    expect(() => blur()).not.toThrow();
    idleSeconds = (IDLE_THRESHOLD + 4_000) / 1000;
    expect(() => sensor.sample()).not.toThrow();
    expect(consoleError).toHaveBeenCalledTimes(2);
    sensor.dispose();
  });
});

describe('the sensor switch', () => {
  it('is on unless the environment says otherwise', () => {
    // Same shape as the tick interval: one variable, read once, defaulting to the product's behaviour.
    expect(distractionSensorEnabled(undefined)).toBe(true);
    expect(distractionSensorEnabled('1')).toBe(true);
    expect(distractionSensorEnabled('0')).toBe(false);
  });

  it('asks the system for its idle time', () => {
    idleSeconds = 42;
    expect(systemIdleSeconds()).toBe(42);
  });
});
