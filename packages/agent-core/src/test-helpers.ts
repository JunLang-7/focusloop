import { openDatabase, FocusLoopStore } from '@focusloop/persistence';
import { createProviderSelection, type ProviderSelection } from '@focusloop/llm-provider';
import { FocusLoopEngine, type FocusLoopEngineOptions } from './engine';

export interface TestClock {
  now(): string;
  advance(ms: number): string;
  set(iso: string): void;
}

export function createTestClock(startIso = '2026-01-01T00:00:00.000Z'): TestClock {
  let current = Date.parse(startIso);
  return {
    now: () => new Date(current).toISOString(),
    advance: (ms: number) => {
      current += ms;
      return new Date(current).toISOString();
    },
    set: (iso: string) => {
      current = Date.parse(iso);
    },
  };
}

export interface TestEngine {
  readonly engine: FocusLoopEngine;
  readonly store: FocusLoopStore;
  readonly clock: TestClock;
  readonly providers: ProviderSelection;
  close(): void;
}

export function createTestEngine(
  options: {
    clock?: TestClock;
    providers?: ProviderSelection;
    stateConfig?: FocusLoopEngineOptions['stateConfig'];
    policyConfig?: FocusLoopEngineOptions['policyConfig'];
    simulatorEnabled?: boolean;
  } = {},
): TestEngine {
  const db = openDatabase(':memory:');
  const store = new FocusLoopStore(db);
  const clock = options.clock ?? createTestClock();
  const providers = options.providers ?? createProviderSelection(null);

  let counter = 0;
  const engine = new FocusLoopEngine({
    store,
    providers,
    clock: () => clock.now(),
    idFactory: () => `id-${(counter += 1)}`,
    ...(options.stateConfig === undefined ? {} : { stateConfig: options.stateConfig }),
    ...(options.policyConfig === undefined ? {} : { policyConfig: options.policyConfig }),
    ...(options.simulatorEnabled === undefined
      ? {}
      : { simulatorEnabled: options.simulatorEnabled }),
  });

  engine.initialize();
  engine.seedBuiltInCourses();

  return { engine, store, clock, providers, close: () => store.close() };
}
