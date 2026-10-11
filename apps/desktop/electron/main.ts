import { BrowserWindow, Menu, app } from 'electron';
import { join } from 'node:path';
import { broadcastTick, registerIpcHandlers } from './ipc/handlers';
import { createEventRouter } from './event-router';
import { createService, startBridge } from './service';
import {
  distractionSensorEnabled,
  startDistractionSensor,
  systemIdleSeconds,
  type DistractionSensor,
} from './distraction-sensor';
import { createMainWindow, isDevelopment } from './window';
import { surfaceWindow } from './window-focus';
import { APP_NAME, configureAppIdentity } from './app-identity';

configureAppIdentity(app);

/** Renderer output lives under dist/renderer/browser. */
const RENDERER_DIRECTORY = join(__dirname, '..', 'renderer', 'browser');
/** Compiled preload script, emitted next to main.cjs. */
const PRELOAD_PATH = join(__dirname, 'preload.cjs');

/** Interval for time-based interruption detection. */
const TICK_INTERVAL_MS = Number(process.env['FOCUSLOOP_TICK_INTERVAL_MS'] ?? 5_000);

async function bootstrap(): Promise<void> {
  app.setAboutPanelOptions({ applicationName: APP_NAME });
  if (process.platform === 'darwin') {
    // The stock development binary still has Electron's bundle name. Use explicit labels
    // for our menu; the Dock/Finder name requires the packaged FocusLoop.app bundle.
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        {
          label: APP_NAME,
          submenu: [
            { role: 'about', label: 'About FocusLoop' },
            { type: 'separator' },
            { role: 'services' },
            { type: 'separator' },
            { role: 'hide', label: 'Hide FocusLoop' },
            { role: 'hideOthers' },
            { role: 'unhide' },
            { type: 'separator' },
            { role: 'quit', label: 'Quit FocusLoop' },
          ],
        },
        { role: 'fileMenu' },
        { role: 'editMenu' },
        { role: 'viewMenu' },
        { role: 'windowMenu' },
      ]),
    );
  }

  const service = createService();
  service.store.setMeta('last_boot_at', new Date().toISOString());

  /*
   * Every window, looked up when an event is delivered rather than captured here: the bridge starts
   * before any window exists, and the tick outlives every window the learner closes.
   */
  const router = createEventRouter(service.engine, () => BrowserWindow.getAllWindows());

  const disposeIpc = registerIpcHandlers(service, router);
  await startBridge(service, router);

  const isDev = isDevelopment();
  const devServerUrl = process.env['FOCUSLOOP_RENDERER_URL'];

  await createMainWindow({
    isDev,
    rendererDirectory: RENDERER_DIRECTORY,
    preloadPath: PRELOAD_PATH,
    devServerUrl,
  });

  /*
   * The app's own source of distraction, on top of the extension's (#254).
   *
   * Started after the first window exists, though it does not need one: the listeners are on `app`,
   * so a window opened later by `activate` is covered by the same subscription.
   */
  const sensor: DistractionSensor = distractionSensorEnabled()
    ? startDistractionSensor(router, {
        now: () => new Date().toISOString(),
        idleSeconds: systemIdleSeconds,
      })
    : { sample: () => undefined, dispose: () => undefined };

  const ticker = setInterval(() => {
    /*
     * Sampled before the tick, and that order is the point: an idle report dispatched here sets
     * `idleSince`, and the tick immediately after is what escalates it against the domain's own
     * threshold. Sampling afterwards would delay the learner's interruption by one whole interval.
     */
    sensor.sample();
    broadcastTick(service, router);
  }, TICK_INTERVAL_MS);
  ticker.unref();

  app.on('window-all-closed', () => {
    clearInterval(ticker);
    sensor.dispose();
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
