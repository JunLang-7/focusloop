import type { ElectronApplication } from '@playwright/test';
import { execFile } from 'node:child_process';
import process from 'node:process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

async function raceTimeout<T>(task: Promise<T>, milliseconds: number): Promise<T | undefined> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      task,
      new Promise<undefined>((resolve) => {
        timer = setTimeout(() => resolve(undefined), milliseconds);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * Close a test-owned Electron app even when the product's close-to-tray behavior keeps its window alive.
 * Quit through Electron first, then stop only that app's own spawned child if close-to-tray keeps it alive.
 */
export async function closeElectronApp(app: ElectronApplication): Promise<void> {
  const electronPid = await raceTimeout(
    /*
     * `globalThis.process`, not `process`. The callback is serialized with `Function.prototype.toString`
     * and evaluated in the app's main process, so whatever it says is what runs there — and a bare
     * `process` in *this* module is not the global: it is the `node:process` import above, which the
     * CommonJS transform renames (`_nodeProcess`) at the reference, including this one. The rename then
     * travels inside the serialized source into a process that has no such name, and the call fails with
     * `ReferenceError: _nodeProcess is not defined` before the app is even asked to quit.
     */
    app.evaluate(() => globalThis.process.pid),
    1_000,
  );
  const pidExists = (pid: number) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };
  const waitForElectronExit = async (milliseconds: number) => {
    const deadline = Date.now() + milliseconds;
    while (electronPid !== undefined && pidExists(electronPid) && Date.now() < deadline) {
      await new Promise<void>((resolve) => setTimeout(resolve, 100));
    }
    return electronPid === undefined || !pidExists(electronPid);
  };

  await raceTimeout(
    app.evaluate(({ app: electronApp }) => electronApp.quit()).catch(() => undefined),
    1_000,
  );

  if (!(await waitForElectronExit(1_500)) && electronPid !== undefined) {
    if (process.platform === 'win32') {
      await raceTimeout(
        execFileAsync('taskkill.exe', ['/PID', String(electronPid), '/T', '/F']).catch(
          () => undefined,
        ),
        2_000,
      );
    } else {
      try {
        process.kill(electronPid, 'SIGKILL');
      } catch {
        // The Electron process may have exited between the liveness check and signal.
      }
    }
  }
  await waitForElectronExit(2_000);
  await raceTimeout(
    app.close().catch(() => undefined),
    1_500,
  );
}
