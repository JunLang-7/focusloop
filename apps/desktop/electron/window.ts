import { BrowserWindow, app, nativeTheme, screen, shell } from 'electron';
import { join } from 'node:path';
import { appIconPath } from './app-icon';
import {
  WINDOW_MINIMUM,
  readWindowState,
  restoreWindowBounds,
  writeWindowState,
} from './window-bounds';

export interface CreateWindowOptions {
  readonly isDev: boolean;
  readonly rendererDirectory: string;
  readonly preloadPath: string;
  readonly devServerUrl?: string | undefined;
}

const DEFAULT_WINDOW = { width: 1280, height: 840 } as const;

/** Where the window's own geometry is remembered, beside the database it lives with. */
function windowStatePath(): string {
  return join(app.getPath('userData'), 'window-state.json');
}

/**
 * The renderer is fully isolated: no Node integration, context isolation on,
 * sandbox on, and navigation away from the app is blocked.
 */
export async function createMainWindow(options: CreateWindowOptions): Promise<BrowserWindow> {
  /*
   * Restored before the window exists, not moved afterwards: the geometry has to be right in the first
   * frame, or every launch shows the default size for a moment before jumping. A window with no x/y
   * opens where Electron centres it, which is what an unusable stored position falls back to.
   */
  const statePath = windowStatePath();
  const restored = restoreWindowBounds(
    readWindowState(statePath),
    screen.getAllDisplays().map((display) => display.workArea),
    DEFAULT_WINDOW,
  );

  const window = new BrowserWindow({
    width: restored.width,
    height: restored.height,
    ...(restored.x === undefined || restored.y === undefined
      ? {}
      : { x: restored.x, y: restored.y }),
    minWidth: WINDOW_MINIMUM.width,
    minHeight: WINDOW_MINIMUM.height,
    show: false,
    // Follows the OS so the window does not flash the wrong colour before the
    // renderer has painted. An in-app override cannot reach this layer.
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0f1115' : '#f5f6f8',
    title: 'FocusLoop',
    // The taskbar entry and the Alt-Tab thumbnail, since Windows uses the window's icon when it has
    // one rather than the executable's.
    icon: appIconPath({
      isPackaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
      appPath: app.getAppPath(),
    }),
    autoHideMenuBar: true,
    webPreferences: {
      preload: options.preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
    },
  });

  /*
   * Maximising happens here, not straight after construction: `maximize()` *shows* the window if it is
   * not already displayed (Electron's own documentation), which would defeat `show: false` and put a
   * contentless window on screen for the whole renderer load - the flash that `backgroundColor` and
   * this handler exist to prevent.
   */
  window.once('ready-to-show', () => {
    window.show();
    if (restored.maximized) window.maximize();
  });

  /*
   * `getNormalBounds` returns the normal-state rectangle whatever the window's current state - maximised,
   * minimised or fullscreen - and equals `getBounds` in normal state. Recording that unconditionally
   * keeps the stored size independent of what the platform reports for a minimised window, which the
   * `getBounds` documentation does not describe.
   */
  window.once('close', () => {
    writeWindowState(statePath, { ...window.getNormalBounds(), maximized: window.isMaximized() });
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });

  window.webContents.on('will-navigate', (event, url) => {
    const allowed = options.devServerUrl;
    const isDevServer = allowed !== undefined && url.startsWith(allowed);
    if (!isDevServer && !url.startsWith('file://')) {
      event.preventDefault();
    }
  });

  if (options.isDev && options.devServerUrl !== undefined) {
    await window.loadURL(options.devServerUrl);
  } else {
    await window.loadFile(join(options.rendererDirectory, 'index.html'));
  }

  return window;
}

export function isDevelopment(): boolean {
  return !app.isPackaged || process.env['FOCUSLOOP_DEV'] === '1';
}
