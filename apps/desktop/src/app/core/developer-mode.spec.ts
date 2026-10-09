import { describe, expect, it } from 'vitest';
import type { RuntimeInfo } from '@focusloop/shared-types';
import { developerModeEnabled } from './developer-mode';

function runtime(simulatorEnabled: boolean): RuntimeInfo {
  return {
    appVersion: '0.1.0-demo',
    electronVersion: '44.0.0',
    chromeVersion: '140.0.0',
    nodeVersion: '24.0.0',
    platform: 'darwin',
    simulatorEnabled,
    providerId: 'mock',
    providerModel: 'mock',
    providerOffline: true,
    providerDegraded: false,
  };
}

describe('developerModeEnabled', () => {
  it('shows the developer surfaces when the main process says so', () => {
    expect(developerModeEnabled(runtime(true))).toBe(true);
  });

  it('hides them in a build whose main process reports no simulator', () => {
    // `service.ts` reports `!app.isPackaged` by default, so a packaged build answers `false` and the
    // simulator bar goes with it.
    expect(developerModeEnabled(runtime(false))).toBe(false);
  });

  it('hides them before the main process has answered', () => {
    // `runtime()` is null until the first IPC round trip, so an unreported answer must not flash a
    // developer surface on a learner's screen.
    expect(developerModeEnabled(null)).toBe(false);
    expect(developerModeEnabled(undefined)).toBe(false);
  });
});
