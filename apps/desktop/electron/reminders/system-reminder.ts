import { execFile } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import type { Locale } from '@focusloop/shared-types';

const execFileAsync = promisify(execFile);

/** The names the platform's scheduler knows this entry by. One per platform, stated once. */
export const WINDOWS_TASK_NAME = 'FocusLoop Study Reminder';
export const LAUNCH_AGENT_LABEL = 'com.focusloop.study-reminder';
export const SYSTEMD_UNIT = 'focusloop-study-reminder';

export interface ReminderPlan {
  readonly enabled: boolean;
  /** `HH:MM`, 24-hour. */
  readonly time: string;
  readonly locale: Locale;
}

/**
 * The arguments that make a launch *fire the reminder and exit*, handled before the single-instance
 * lock in `main.ts`.
 *
 * The locale is carried in the argument rather than read from the store, because the scheduled process
 * must not open the database while the learner's own instance has it open — and because the two
 * sentences are the only thing it needs.
 */
export function reminderFireArgs(locale: Locale): string[] {
  return ['--reminder-fire', '--reminder-locale', locale];
}

/** `HH:MM` to an hour and minute, or `null` when it is not a readable time. */
export function reminderClock(
  time: string,
): { readonly hour: number; readonly minute: number } | null {
  const match = /^(\d{2}):(\d{2})$/.exec(time);
  if (match === null) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

/**
 * Windows command-line quoting, per the rule `CommandLineToArgvW` itself applies.
 *
 * Wrapping in quotes is not enough: a backslash *before* a quote is an escape for that quote, so a path
 * that ends in one — `C:\Program Files\` — would swallow the closing quote and merge the arguments that
 * follow. Every run of backslashes is therefore doubled where it precedes a quote, and a quote is escaped
 * with an odd count, which is the only shape the parser reads back as the original string.
 */
function quote(value: string): string {
  let quoted = '"';
  let backslashes = 0;
  for (const character of value) {
    if (character === '\\') {
      backslashes += 1;
      continue;
    }
    if (character === '"') {
      quoted += `${'\\'.repeat(backslashes * 2 + 1)}"`;
    } else {
      quoted += `${'\\'.repeat(backslashes)}${character}`;
    }
    backslashes = 0;
  }
  return `${quoted}${'\\'.repeat(backslashes * 2)}"`;
}

/** The command line Windows Task Scheduler runs, with every part quoted because a path has spaces. */
export function windowsTaskCommand(
  execPath: string,
  appArgs: readonly string[],
  locale: Locale,
): string {
  return [execPath, ...appArgs, ...reminderFireArgs(locale)].map(quote).join(' ');
}

export function windowsCreateArgs(time: string, command: string): string[] {
  return ['/Create', '/SC', 'DAILY', '/ST', time, '/TN', WINDOWS_TASK_NAME, '/TR', command, '/F'];
}

export function windowsDeleteArgs(): string[] {
  return ['/Delete', '/TN', WINDOWS_TASK_NAME, '/F'];
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * The macOS LaunchAgent. `StartCalendarInterval` is the platform's own daily schedule, so the app does
 * not have to be running and does not have to stay running for the reminder to arrive.
 */
export function launchAgentPlist(
  execPath: string,
  appArgs: readonly string[],
  locale: Locale,
  time: string,
): string | null {
  const clock = reminderClock(time);
  if (clock === null) return null;
  const args = [execPath, ...appArgs, ...reminderFireArgs(locale)]
    .map((arg) => `<string>${escapeXml(arg)}</string>`)
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LAUNCH_AGENT_LABEL}</string>
  <key>ProgramArguments</key>
  <array>${args}</array>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key>
    <integer>${clock.hour}</integer>
    <key>Minute</key>
    <integer>${clock.minute}</integer>
  </dict>
  <key>RunAtLoad</key>
  <false/>
</dict>
</plist>
`;
}

export function systemdServiceUnit(
  execPath: string,
  appArgs: readonly string[],
  locale: Locale,
): string {
  const command = [execPath, ...appArgs, ...reminderFireArgs(locale)].map(quote).join(' ');
  return `[Unit]
Description=FocusLoop study reminder

[Service]
Type=oneshot
ExecStart=${command}
`;
}

export function systemdTimerUnit(time: string): string | null {
  const clock = reminderClock(time);
  if (clock === null) return null;
  return `[Unit]
Description=FocusLoop study reminder

[Timer]
OnCalendar=*-*-* ${String(clock.hour).padStart(2, '0')}:${String(clock.minute).padStart(2, '0')}:00
Persistent=true

[Install]
WantedBy=timers.target
`;
}

/** The same plan, so a reconcile with nothing changed touches nothing. */
function planKey(plan: ReminderPlan): string {
  return `${plan.enabled ? 'on' : 'off'}:${plan.time}:${plan.locale}`;
}

export interface SystemReminderOptions {
  /** `false` in tests and for a launch that asked not to touch the machine. */
  readonly enabled: boolean;
  readonly platform: NodeJS.Platform;
  readonly home: string;
  readonly execPath: string;
  /** The app path in development; empty for a packaged build. */
  readonly appArgs: readonly string[];
  readonly plan: () => ReminderPlan;
  /** Injected so a test can drive the whole reconcile without running `schtasks`. */
  readonly run?: (file: string, args: readonly string[]) => Promise<void>;
  readonly write?: (path: string, content: string) => Promise<void>;
  readonly remove?: (path: string) => Promise<void>;
}

export interface SystemReminder {
  /** Applies the current plan to the OS if it differs from what was applied last. Never throws. */
  reconcile(): Promise<void>;
}

const defaultRun = async (file: string, args: readonly string[]): Promise<void> => {
  await execFileAsync(file, [...args]);
};

const defaultWrite = async (path: string, content: string): Promise<void> => {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, 'utf8');
};

const defaultRemove = async (path: string): Promise<void> => {
  await rm(path, { force: true });
};

/**
 * Keeps the platform's own scheduler in step with the reminder setting.
 *
 * The in-app timer still exists and is what fires while the app is open; this is what fires when it is
 * not. Every step is best-effort: a platform that refuses to register a task is reported in the main
 * process's log and the in-app reminder keeps working, because a reminder that only works while the
 * window is open is still better than an app that refuses to start over one.
 */
export function createSystemReminder(options: SystemReminderOptions): SystemReminder {
  const run = options.run ?? defaultRun;
  const write = options.write ?? defaultWrite;
  const remove = options.remove ?? defaultRemove;
  let applied: string | null = null;
  let busy = false;

  const attempt = async (file: string, args: readonly string[]): Promise<void> => {
    try {
      await run(file, args);
    } catch (error) {
      // Removing an entry that was never created is the common case and is not worth a line; a
      // registration that failed is worth one, because the reminder will not arrive without it.
      const message = error instanceof Error ? error.message : String(error);
      if (/cannot find|not exist|no such|not loaded|unknown/i.test(message)) return;
      console.error(`FocusLoop could not run ${file}:`, message);
    }
  };

  const applyWindows = async (plan: ReminderPlan): Promise<void> => {
    if (plan.enabled && reminderClock(plan.time) !== null) {
      const command = windowsTaskCommand(options.execPath, options.appArgs, plan.locale);
      await attempt('schtasks', windowsCreateArgs(plan.time, command));
    } else {
      await attempt('schtasks', windowsDeleteArgs());
    }
  };

  const launchAgentPath = join(
    options.home,
    'Library',
    'LaunchAgents',
    `${LAUNCH_AGENT_LABEL}.plist`,
  );

  const applyMac = async (plan: ReminderPlan): Promise<void> => {
    const plist = plan.enabled
      ? launchAgentPlist(options.execPath, options.appArgs, plan.locale, plan.time)
      : null;
    if (plist === null) {
      await attempt('launchctl', ['unload', launchAgentPath]);
      try {
        await remove(launchAgentPath);
      } catch (error) {
        console.error('FocusLoop could not remove its reminder agent:', error);
      }
      return;
    }
    try {
      await write(launchAgentPath, plist);
    } catch (error) {
      console.error('FocusLoop could not write its reminder agent:', error);
      return;
    }
    // Unload first so a changed time replaces the schedule rather than stacking a second one.
    await attempt('launchctl', ['unload', launchAgentPath]);
    await attempt('launchctl', ['load', launchAgentPath]);
  };

  const unitDirectory = join(options.home, '.config', 'systemd', 'user');

  const applyLinux = async (plan: ReminderPlan): Promise<void> => {
    const timer = plan.enabled ? systemdTimerUnit(plan.time) : null;
    if (timer === null) {
      await attempt('systemctl', ['--user', 'disable', '--now', `${SYSTEMD_UNIT}.timer`]);
      for (const name of [`${SYSTEMD_UNIT}.service`, `${SYSTEMD_UNIT}.timer`]) {
        try {
          await remove(join(unitDirectory, name));
        } catch (error) {
          console.error('FocusLoop could not remove its reminder unit:', error);
        }
      }
      return;
    }
    try {
      await write(
        join(unitDirectory, `${SYSTEMD_UNIT}.service`),
        systemdServiceUnit(options.execPath, options.appArgs, plan.locale),
      );
      await write(join(unitDirectory, `${SYSTEMD_UNIT}.timer`), timer);
    } catch (error) {
      console.error('FocusLoop could not write its reminder unit:', error);
      return;
    }
    await attempt('systemctl', ['--user', 'daemon-reload']);
    await attempt('systemctl', ['--user', 'enable', '--now', `${SYSTEMD_UNIT}.timer`]);
  };

  return {
    async reconcile(): Promise<void> {
      if (!options.enabled) return;
      const plan = options.plan();
      const key = planKey(plan);
      if (busy || key === applied) return;
      busy = true;
      try {
        if (options.platform === 'win32') await applyWindows(plan);
        else if (options.platform === 'darwin') await applyMac(plan);
        else if (options.platform === 'linux') await applyLinux(plan);
        // Marked applied only after the platform accepts it, so a failure retries on the next tick.
        applied = key;
      } catch (error) {
        console.error('FocusLoop could not reconcile the system reminder:', error);
      } finally {
        busy = false;
      }
    },
  };
}
