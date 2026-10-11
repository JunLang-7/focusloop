import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { APP_ID, APP_NAME, configureAppIdentity } from './app-identity';

describe('the cross-platform application identity', () => {
  for (const platform of ['win32', 'darwin', 'linux'] as const) {
    it(`names the ${platform} runtime FocusLoop without moving its profile`, () => {
      const calls: string[] = [];
      const profile = join(process.cwd(), 'existing-profile');
      const runtime = {
        getPath: vi.fn(() => {
          calls.push('getPath');
          return profile;
        }),
        setName: vi.fn(() => calls.push('setName')),
        setPath: vi.fn(() => calls.push('setPath')),
        setAppUserModelId: vi.fn(() => calls.push('setAppUserModelId')),
      };
      configureAppIdentity(runtime, platform);
      expect(runtime.getPath).toHaveBeenCalledWith('userData');
      expect(runtime.setName).toHaveBeenCalledWith('FocusLoop');
      expect(runtime.setPath).toHaveBeenCalledWith('userData', profile);
      expect(calls.slice(0, 3)).toEqual(['getPath', 'setName', 'setPath']);
      if (platform === 'win32') {
        expect(runtime.setAppUserModelId).toHaveBeenCalledWith(APP_ID);
      } else {
        expect(runtime.setAppUserModelId).not.toHaveBeenCalled();
      }
    });
  }

  it('matches the packaged executable name and Windows shortcut identity', () => {
    const manifest = readFileSync(join(process.cwd(), 'electron-builder.yml'), 'utf8');
    expect(manifest).toContain(`appId: ${APP_ID}`);
    expect(manifest).toContain(`productName: ${APP_NAME}`);
    expect(manifest).toContain(`executableName: ${APP_NAME}`);
  });
});
