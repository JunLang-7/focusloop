import { BrowserWindow, Menu, Notification, app } from 'electron';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { REMINDER_COPY, coerceLocale, detectLocale } from '@focusloop/shared-types';
import { LOCALE_KEY } from '@focusloop/agent-core';
import { broadcastTick, registerIpcHandlers } from './ipc/handlers';
import { createSystemReminder } from './reminders/system-reminder';
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
   * The first run speaks the machine's language.
   *
   * With no locale stored, the default is English — so a Chinese machine would open on an English
   * questionnaire, which is the first thing the learner is asked to read. `app.getLocale()` is the OS
   * answer, and from then on the learner's own choice is what the store holds, because the key is set.
   * A launch that asked not to be detected (the e2e harness) keeps the deterministic default.
   */
  if (
    process.env['FOCUSLOOP_DETECT_LOCALE'] !== '0' &&
    service.store.getMeta(LOCALE_KEY) === null
  ) {
    service.engine.setLocale(detectLocale(app.getLocale()));
  }

  /*
   * The first-run questionnaire is answered for a launch that asks to skip it. Every e2e spec uses a
   * fresh profile, so *every* spec is a first run; the harness sets this and the one spec that exercises
   * the questionnaire clears it. A real launch has no such variable and sees it once, as intended.
   */
  if (process.env['FOCUSLOOP_ONBOARDING'] === '0') {
    service.engine.setOnboarded(true);
  }

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

  /*
   * The reminder that fires when the app is not running at all.
   *
   * The platform's scheduler runs this executable with `--reminder-fire` at the chosen time; this keeps
   * that entry in step with the setting. `FOCUSLOOP_SYSTEM_REMINDER=0` (the e2e harness) means "do not
   * touch this machine's scheduler", not "do not remind" — the window's own timer still runs.
   */
  const systemReminder = createSystemReminder({
    enabled: process.env['FOCUSLOOP_SYSTEM_REMINDER'] !== '0',
    platform: process.platform,
    home: homedir(),
    execPath: process.execPath,
    appArgs: app.isPackaged ? [] : process.argv.slice(1, 2),
    plan: () => {
      const settings = service.engine.getSettings();
      return {
        enabled: settings.reminderEnabled,
        time: settings.reminderTime,
        locale: settings.locale,
      };
    },
  });

  const ticker = setInterval(() => {
    /*
     * Sampled before the tick, and that order is the point: an idle report dispatched here sets
     * `idleSince`, and the tick immediately after is what escalates it against the domain's own
     * threshold. Sampling afterwards would delay the learner's interruption by one whole interval.
     */
    sensor.sample();
    void systemReminder.reconcile();
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
 * A scheduled reminder is a separate launch, not the app.
 *
 * The platform's scheduler runs this executable with `--reminder-fire`, and nothing else is started — no
 * store, no bridge, no window.
 *
 * The lock is what decides whether this launch should speak. If it fails, another instance is already
 * running, and that window's own timer is the reminder for a time it is open to see (#286); notifying here
 * too would put the same sentence on screen twice within the same half minute. If it succeeds, the app is
 * closed, this is the only thing that can remind the learner, and it is exactly why the entry exists.
 */
if (process.argv.includes('--reminder-fire')) {
  if (!app.requestSingleInstanceLock()) {
    app.quit();
  } else {
    const locale = coerceLocale(process.argv[process.argv.indexOf('--reminder-locale') + 1]);
    void app.whenReady().then(() => {
      const copy = REMINDER_COPY[locale];
      try {
        // Electron's `Notification` takes one options object, unlike the renderer's `(title, options)`.
        new Notification({ title: copy.title, body: copy.body }).show();
      } catch {
        // A platform that refuses to show it is not a reason to leave a process behind.
      }
      app.quit();
    });
  }
} else {
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
     *
     * A scheduled reminder also fails the lock — it is the platform delivering a reminder, not a second
     * launch of the app — and raising the window for it would steal focus as a side-effect of a
     * notification the learner has not acted on.
     */
    app.on('second-instance', (_event, argv) => {
      if (argv.includes('--reminder-fire')) return;
      surfaceWindow(BrowserWindow.getAllWindows());
    });

    void app
      .whenReady()
      .then(bootstrap)
      .catch((error: unknown) => {
        console.error('FocusLoop failed to start:', error);
        app.exit(1);
      });
  }
}
