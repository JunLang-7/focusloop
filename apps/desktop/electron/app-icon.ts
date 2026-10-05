import { join } from 'node:path';

/**
 * Where the application icon lives.
 *
 * Two consumers read the same files: the window asks for its own icon (taskbar and Alt-Tab), and
 * electron-builder embeds the Windows one in the installer and the uninstaller. Neither can read
 * the other's, so both point at the committed files under `resources/`.
 */
export function appIconFile(platform: NodeJS.Platform = process.platform): string {
  // Windows wants the multi-size ICO; an ICO is meaningless elsewhere, and the 512 PNG is what the
  // other platforms can use.
  return platform === 'win32' ? 'icon.ico' : 'icon.png';
}

export interface AppIconLocation {
  readonly isPackaged: boolean;
  /** `process.resourcesPath`: where `extraResources` land in a packaged app. */
  readonly resourcesPath: string;
  /** `app.getAppPath()`: the application directory, which is the project directory in development. */
  readonly appPath: string;
  readonly platform?: NodeJS.Platform;
}

export function appIconPath(location: AppIconLocation): string {
  const file = appIconFile(location.platform ?? process.platform);
  return location.isPackaged
    ? join(location.resourcesPath, file)
    : join(location.appPath, 'resources', file);
}
