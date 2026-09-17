import { BrowserWindow, app, nativeTheme, shell } from 'electron';
import { join } from 'node:path';

export interface CreateWindowOptions {
  readonly isDev: boolean;
  readonly rendererDirectory: string;
  readonly preloadPath: string;
  readonly devServerUrl?: string | undefined;
}

/**
 * The renderer is fully isolated: no Node integration, context isolation on,
 * sandbox on, and navigation away from the app is blocked.
 */
export async function createMainWindow(options: CreateWindowOptions): Promise<BrowserWindow> {
  const window = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 960,
    minHeight: 640,
    show: false,
    // Follows the OS so the window does not flash the wrong colour before the
    // renderer has painted. An in-app override cannot reach this layer.
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0f1115' : '#f5f6f8',
    title: 'FocusLoop',
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

  window.once('ready-to-show', () => window.show());

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
