import { describe, expect, it, vi } from 'vitest';
import {
  createSystemReminder,
  launchAgentPlist,
  reminderClock,
  reminderFireArgs,
  systemdServiceUnit,
  systemdTimerUnit,
  windowsCreateArgs,
  windowsTaskCommand,
} from './system-reminder';

describe('reminderClock', () => {
  it('reads HH:MM', () => {
    expect(reminderClock('00:00')).toEqual({ hour: 0, minute: 0 });
    expect(reminderClock('09:30')).toEqual({ hour: 9, minute: 30 });
    expect(reminderClock('23:59')).toEqual({ hour: 23, minute: 59 });
  });

  it('refuses anything else', () => {
    expect(reminderClock('9:30')).toBeNull();
    expect(reminderClock('24:00')).toBeNull();
    expect(reminderClock('09:60')).toBeNull();
    expect(reminderClock('')).toBeNull();
  });
});

describe('the fire arguments', () => {
  it('name the action and the language the sentence should be written in', () => {
    expect(reminderFireArgs('zh')).toEqual(['--reminder-fire', '--reminder-locale', 'zh']);
  });
});

describe('the Windows task', () => {
  it('quotes every part of the command, because a path has spaces', () => {
    const command = windowsTaskCommand('C:\\Program Files\\FocusLoop\\FocusLoop.exe', [], 'en');
    expect(command).toBe(
      '"C:\\Program Files\\FocusLoop\\FocusLoop.exe" "--reminder-fire" "--reminder-locale" "en"',
    );
  });

  /*
   * The parser this has to survive reads a backslash before a quote as an escape for that quote, so a
   * path that ends in one would swallow the closing quote and merge the arguments after it.
   */
  it('doubles a trailing backslash rather than letting it escape the closing quote', () => {
    expect(windowsTaskCommand('C:\\Program Files\\FocusLoop\\', [], 'en')).toBe(
      '"C:\\Program Files\\FocusLoop\\\\" "--reminder-fire" "--reminder-locale" "en"',
    );
  });

  it('escapes a quote inside an argument', () => {
    expect(windowsTaskCommand('C:\\a b\\FocusLoop.exe', ['a"b'], 'en')).toBe(
      '"C:\\a b\\FocusLoop.exe" "a\\"b" "--reminder-fire" "--reminder-locale" "en"',
    );
  });

  it('is a daily task at the chosen time, replaced if it exists', () => {
    expect(windowsCreateArgs('08:15', 'cmd')).toEqual([
      '/Create',
      '/SC',
      'DAILY',
      '/ST',
      '08:15',
      '/TN',
      'FocusLoop Study Reminder',
      '/TR',
      'cmd',
      '/F',
    ]);
  });
});

describe('the macOS agent', () => {
  it('schedules the daily fire with the app and its locale', () => {
    const plist = launchAgentPlist(
      '/Applications/FocusLoop.app/Contents/MacOS/FocusLoop',
      [],
      'zh',
      '07:05',
    );
    expect(plist).toContain('<key>Hour</key>');
    expect(plist).toContain('<integer>7</integer>');
    expect(plist).toContain('<integer>5</integer>');
    expect(plist).toContain('<string>--reminder-fire</string>');
    expect(plist).toContain('<string>--reminder-locale</string>');
    expect(plist).toContain('<string>zh</string>');
  });

  it('is null when the time cannot be read, so the caller removes rather than writes', () => {
    expect(launchAgentPlist('/FocusLoop', [], 'en', 'nope')).toBeNull();
  });
});

describe('the Linux units', () => {
  it('fires the app once a day with a persistent timer', () => {
    expect(systemdTimerUnit('09:30')).toContain('OnCalendar=*-*-* 09:30:00');
    expect(systemdTimerUnit('bad')).toBeNull();
    expect(systemdServiceUnit('/opt/focusloop/focusloop', [], 'en')).toContain(
      'ExecStart="/opt/focusloop/focusloop" "--reminder-fire" "--reminder-locale" "en"',
    );
  });
});

describe('createSystemReminder', () => {
  const options = (over: Partial<Parameters<typeof createSystemReminder>[0]> = {}) => {
    const run = vi.fn(async (_file: string, _args: readonly string[]) => undefined);
    const write = vi.fn(async (_path: string, _content: string) => undefined);
    const remove = vi.fn(async (_path: string) => undefined);
    const reminder = createSystemReminder({
      enabled: true,
      platform: 'win32',
      home: 'C:\\Users\\learner',
      execPath: 'C:\\FocusLoop.exe',
      appArgs: [],
      plan: () => ({ enabled: true, time: '09:00', locale: 'en' }),
      run,
      write,
      remove,
      ...over,
    });
    return { reminder, run, write, remove };
  };

  it('registers once and does not touch the machine again while the plan is unchanged', async () => {
    const { reminder, run } = options();
    await reminder.reconcile();
    await reminder.reconcile();
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0]?.[0]).toBe('schtasks');
    expect(run.mock.calls[0]?.[1]).toContain('/Create');
  });

  it('re-registers when the time changes', async () => {
    let time = '09:00';
    const { reminder, run } = options({ plan: () => ({ enabled: true, time, locale: 'en' }) });
    await reminder.reconcile();
    time = '18:30';
    await reminder.reconcile();
    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls[1]?.[1]).toContain('18:30');
  });

  it('removes the entry when the reminder is turned off', async () => {
    const { reminder, run } = options({
      plan: () => ({ enabled: false, time: '09:00', locale: 'en' }),
    });
    await reminder.reconcile();
    expect(run.mock.calls[0]?.[1]).toContain('/Delete');
  });

  it('does nothing at all when the launch asked it not to', async () => {
    const { reminder, run } = options({ enabled: false });
    await reminder.reconcile();
    expect(run).not.toHaveBeenCalled();
  });

  it('does not throw when the platform refuses', async () => {
    const { reminder } = options({
      run: vi.fn(async (_file: string, _args: readonly string[]) => {
        throw new Error('refused');
      }),
    });
    await expect(reminder.reconcile()).resolves.toBeUndefined();
  });
});
