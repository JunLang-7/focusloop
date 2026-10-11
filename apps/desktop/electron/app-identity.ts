import type { App } from 'electron';

export const APP_NAME = 'FocusLoop';
/** Must match electron-builder.yml and the AppUserModelID on installed Windows shortcuts. */
export const APP_ID = 'dev.focusloop.desktop';

type IdentityRuntime = Pick<App, 'getPath' | 'setPath' | 'setName' | 'setAppUserModelId'>;

/** Set our runtime identity without changing the learner's existing profile or CLI override. */
export function configureAppIdentity(
  runtime: IdentityRuntime,
  platform: NodeJS.Platform = process.platform,
): void {
  // Direct launches of main.cjs have no package metadata and otherwise default to "Electron".
  const userDataPath = runtime.getPath('userData');
  runtime.setName(APP_NAME);
  runtime.setPath('userData', userDataPath);
  // Windows uses this identity to associate windows/notifications with installed shortcuts.
  if (platform === 'win32') runtime.setAppUserModelId(APP_ID);
}
