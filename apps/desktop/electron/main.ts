import { BrowserWindow, app } from 'electron';
import { join } from 'node:path';
import { broadcastTick, registerIpcHandlers } from './ipc/handlers';
import { createService, startBridge } from './service';
import { createMainWindow, isDevelopment } from './window';
import { surfaceWindow } from './window-focus';

/** Renderer output lives under dist/renderer/browser. */
const RENDERER_DIRECTORY = join(__dirname, '..', 'renderer', 'browser');
/** Compiled preload script, emitted next to main.cjs. */
const PRELOAD_PATH = join(__dirname, 'preload.cjs');

/** Interval for time-based interruption detection. */
const TICK_INTERVAL_MS = 5_000;

async function bootstrap(): Promise<void> {
  const service = createService();
  service.store.setMeta('last_boot_at', new Date().toISOString());

  const disposeIpc = registerIpcHandlers(service);
  await startBridge(service);

  const isDev = isDevelopment();
  const devServerUrl = process.env['FOCUSLOOP_RENDERER_URL'];

  await createMainWindow({
    isDev,
    rendererDirectory: RENDERER_DIRECTORY,
    preloadPath: PRELOAD_PATH,
    devServerUrl,
  });

  const ticker = setInterval(() => {
    broadcastTick(service, BrowserWindow.getAllWindows());
  }, TICK_INTERVAL_MS);
  ticker.unref();

  app.on('window-all-closed', () => {
    clearInterval(ticker);
    disposeIpc();
    service.dispose();
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createMainWindow({
        isDev,
        rendererDirectory: RENDERER_DIRECTORY,
        preloadPath: PRELOAD_PATH,
        devServerUrl,
      });
    }
  });
}

/*
 * Windows/Linux: a single instance keeps the SQLite file single-writer, and a second launch is a
 * request aimed at the first instance rather than a new one (#5).
 *
 * The lock is taken before anything else runs. It used to be checked at the end of `bootstrap`,
 * by which time the second process had already opened the store, registered IPC and started the
 * bridge — so it died on `EADDRINUSE` for the bridge port before it ever reached the check, and
 * the learner saw an error and no window.
 */
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  /*
   * The primary instance's window may not exist yet if the second launch arrives during startup,
   * in which case there is nothing to raise and the first launch is about to show itself anyway.
   */
  app.on('second-instance', () => {
    surfaceWindow(BrowserWindow.getAllWindows());
  });

  app
    .whenReady()
    .then(bootstrap)
    .catch((error: unknown) => {
      console.error('FocusLoop failed to start:', error);
      app.exit(1);
    });
}
