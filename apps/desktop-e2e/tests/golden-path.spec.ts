import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import { hermeticEnv } from '../hermetic-env.mjs';

const DESKTOP_MAIN = resolve(__dirname, '..', '..', 'desktop', 'dist', 'main', 'main.cjs');

let app: ElectronApplication;
let window: Page;
let userDataDir: string;

/**
 * Starts the packaged main process against a given profile directory.
 *
 * Called more than once because "the choice survives a restart" can only be
 * shown by actually restarting. The renderer is served over `file://`, where
 * `page.reload()` fails outright, so a relaunch is also the only option.
 */
async function launch(): Promise<{ app: ElectronApplication; window: Page }> {
  /*
   * A launch against a held lock fails *here*, not at `firstWindow()`. Measured on 2026-09-28 against a
   * profile whose lock was held by a live instance: `electron.launch` rejected after 3.0s with
   * "Target page, context or browser has been closed - [pid=…] <process did exit: exitCode=0,
   * signal=null>". That names a closed page, which sends the reader into the renderer, where nothing is
   * wrong — and the issue that filed this had reconstructed the failure as a hang on `firstWindow()`.
   *
   * `main.ts` quits a second instance on the single-instance lock, and it does so cleanly
   * (`app.quit()`); an app that crashed would not exit 0. So a clean exit is the tell, and anything
   * else keeps Playwright's own words with the place to look attached (#44).
   */
  const launched = await electron
    .launch({
      args: [DESKTOP_MAIN, `--user-data-dir=${userDataDir}`],
      env: hermeticEnv(),
    })
    .catch((cause: unknown) => {
      const detail = String(cause);
      throw new Error(
        detail.includes('exitCode=0')
          ? `the app exited cleanly instead of starting: another instance still holds the single-instance lock for ${userDataDir} (#44): ${detail}`
          : `the app failed to start; a leftover process holding the single-instance lock for ${userDataDir} is the usual cause (#44): ${detail}`,
      );
    });

  /*
   * A launch that resolves and then dies before a window appears. This is *not* the lock path — that one
   * fails inside `electron.launch()` above — and it is not the common path either: measured on
   * 2026-09-28, `windows()` is already 1 at the moment launch resolves, on all three launches of a
   * restarting test, so this catch stays dormant in a healthy run. It exists for the failure `main.ts`
   * records against its own bootstrap — `app.exit(1)` after `whenReady()`, which happened once on
   * EADDRINUSE — where the app is connected, then gone, with no window: the one case left where the error
   * names a closed page rather than saying what happened.
   */
  const firstWindow = await launched.firstWindow().catch((cause: unknown) => {
    throw new Error(
      `the app started but showed no window — it may have failed to bootstrap, so see the main-process output (#44): ${String(
        cause,
      )}`,
    );
  });

  await firstWindow.waitForLoadState('domcontentloaded');
  return { app: launched, window: firstWindow };
}

/** How long a closed app is given to actually leave before the next launch is refused. */
const PROCESS_EXIT_TIMEOUT_MS = 15_000;

/**
 * Closes the app and waits for its process to be gone, not merely asked to go.
 *
 * `app.close()` already carries a process-exit wait — it quits the app and then awaits the spawned child's
 * `close` event — so this is a post-condition rather than a repair. It cannot fire on a machine where that
 * wait works, and the suite passes identically without it. What it buys is the two things the event does
 * not: a *named* failure if the process is somehow still there afterwards (Playwright spawns through a
 * shell, which is the one place the wrapper's exit and Electron's can come apart), and a teardown that
 * cannot leave the lock behind for the next run.
 *
 * It is not the regression test for #44 and does not pretend to be: the launch that dies on the lock is
 * the part that reproduces, and that message is fixed in `launch()` where the failure lands.
 */
async function closeAndWait(application: ElectronApplication): Promise<void> {
  const child = application.process();
  const exited = new Promise<void>((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve();
      return;
    }
    child.once('exit', () => resolve());
  });

  const started = Date.now();
  await application.close();

  let timer: NodeJS.Timeout | undefined;
  const stillAlive = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(true), PROCESS_EXIT_TIMEOUT_MS);
  });
  const left = await Promise.race([exited.then(() => false), stillAlive]);
  clearTimeout(timer);

  if (left) {
    throw new Error(
      /*
       * The number is elapsed since `close()` was *called*, not since it returned: the message has to be
       * true, and `close()` carries Electron's whole shutdown, which has no timeout of its own.
       *
       * The pid is described rather than called "the Electron process": Playwright spawns through
       * `shell: true` on Windows only, so there this pid is the wrapper's — cmd.exe, not electron.exe — and
       * on every other platform it is Electron itself. A reader who pastes it into `tasklist` should not be
       * told the wrong thing on either.
       */
      `the app did not exit: pid ${String(child.pid)} (${
        process.platform === 'win32'
          ? 'the cmd.exe wrapper Playwright spawns through, not electron.exe'
          : 'this is Electron itself'
      }) was still alive ${
        Date.now() - started
      }ms after close() was called; the next launch would die on the single-instance lock (#44)`,
    );
  }
}

/**
 * Closes the app, waits for it to leave, and starts a new one — the sequence #44 is about, in one place so
 * that a bare `app.close()` cannot creep back into the file.
 *
 * The pid check is documentation, not a guard: after a launch that resolved, the application object is a
 * fresh one over a fresh spawn, so the pids differ by construction and this cannot observe the thing its
 * sentence suggests. What carries the weight is `closeAndWait` and the message in `launch()`. It is kept
 * because it states the intent, with the two ways it can lie written down: OS pid reuse between the close
 * and the next spawn (a false failure), and Windows, where the pid is the cmd.exe wrapper's rather than
 * Electron's — so even "a new app" is not quite what it compares.
 */
async function restartApp(): Promise<void> {
  const previous = app.process().pid;
  await closeAndWait(app);
  ({ app, window } = await launch());
  expect(app.process().pid, 'the relaunch is a new app, not the one that just closed').not.toBe(
    previous,
  );
}

test.beforeAll(async () => {
  userDataDir = mkdtempSync(join(tmpdir(), 'focusloop-e2e-'));
  ({ app, window } = await launch());
});

test.afterAll(async () => {
  /*
   * Teardown must not report a second failure when a test has already failed. A locked or
   * half-closed profile directory turns one real defect into two red results, which is how
   * every future failure gets harder to read (#107).
   */
  try {
    /*
     * Waited on rather than fired and forgotten: a process left holding the single-instance lock
     * outlives this run and breaks the *next* one with a message about a closed page, which is the trap
     * #44 describes. Printed rather than thrown, because teardown must not add a second red result
     * (#107) — but not silent either, since a run that ends green with electron processes still alive is
     * the artifact #44 recorded.
     */
    if (app !== undefined) await closeAndWait(app);
  } catch (error) {
    console.error(`e2e teardown did not see the app exit: ${String(error)}`);
  }

  // Its own try, so that failing to close cannot also skip the cleanup: the two risks are independent.
  if (userDataDir !== undefined) {
    try {
      rmSync(userDataDir, { recursive: true, force: true });
    } catch {
      // Leftover temp dir beats a second failure that hides the first.
    }
  }
});

/** The state chip's visible text is translated; the raw state is a data attribute. */
function stateIs(expected: string) {
  return expect(window.getByTestId('state')).toHaveAttribute('data-state', expected);
}

/**
 * The recall gesture, as a person performs it: hovering the floating button peeks the
 * sidebar out, and the press that pins it lands on the peeked panel. The button itself
 * stays under the pointer — it is the anchor the peek hangs off, and hiding it would hand
 * the hover to a different element mid-gesture — but the panel is the target the hover was
 * asking for, and the bigger one to press.
 */
async function pinThroughPeek(): Promise<void> {
  const fab = window.getByTestId('sidebar-expand');
  const sidebar = window.locator('.sidebar');
  await fab.hover();
  await expect(sidebar).toBeVisible();
  await sidebar.click();
  await expect(fab).toBeHidden();
  await expect(sidebar).toBeVisible();

  /*
   * Pinning animates the column back to its 232px (`grid-template-columns`, 180ms), and a
   * control inside a moving column is not where Playwright measured it: "visible" is true
   * from the first frame, so a press aimed at the toggle can land where the toggle was
   * mid-flight — the leading edge of the panel, which is where the folded rail's recall
   * tile then appears. The hover that lands on it peeks the panel straight back out, and
   * the fold the test just asked for looks like it did nothing. Wait for the panel to
   * arrive, so the gesture is over when the test says it is.
   */
  await expect
    .poll(() => sidebar.evaluate((el) => Math.round(el.getBoundingClientRect().width)))
    .toBe(232);
}

/**
 * Clicks a sidebar link, recalling the folded sidebar first.
 *
 * While a task is live the shell hides the sidebar — no icon rail — and the floating button
 * in the top-left corner is the only way back, which is exactly how a learner reaches the
 * navigation mid-focus, so tests that need a link go through the recall.
 *
 * The two steps are retried as a pair rather than assumed. Both the fold and the recall are
 * driven by things that move on their own: a commitment that becomes current folds the
 * sidebar even while a test is looking at it (which is what closing the resume card with
 * Escape invites a moment later), and a recall only holds until the next navigation away
 * from the focus screen hands the choice back to `auto`. "The navigation is reachable" is
 * the property under test, and reaching for it again is what a learner would do.
 */
async function clickSidebarLink(name: string): Promise<void> {
  const sidebar = window.locator('.sidebar');
  await expect(async () => {
    /*
     * Folded either way — the learner's collapse or the focus phase — the sidebar is
     * `visibility: hidden`, and that takes its links out of the accessibility tree: a role
     * query cannot even find them, let alone click them, so the recall has to come first.
     * A peek, by contrast, is merely out of the grid, and pinning it is harmless.
     */
    const folded = await sidebar.evaluate((el) => {
      const style = getComputedStyle(el);
      return style.visibility === 'hidden' || style.position === 'fixed';
    });
    if (folded) await pinThroughPeek();
    await sidebar.getByRole('link', { name }).click({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
}

/**
 * The content column's box, rounded. A peek must leave it untouched, so the assertion is
 * an equality on the whole box rather than on one edge: a column that kept its `left` and
 * lost its width is still a broken screen.
 */
async function contentBox(): Promise<{ left: number; width: number }> {
  return window.locator('.content').evaluate((el) => {
    const rect = el.getBoundingClientRect();
    return { left: Math.round(rect.left), width: Math.round(rect.width) };
  });
}

/*
 * The plan is closed until a press opens it, and the toggle is a toggle: pressing it while the
 * panel is open closes the very thing the caller is about to look at. Every entry point that needs
 * the plan goes through this, so "is it already open" is asked in one place.
 */
async function openPlan(): Promise<void> {
  const toggle = window.getByTestId('focus-plan-toggle');
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
  await expect(window.locator('.plan')).toBeVisible();
}

/** The plan's rows, by title, in the order they are rendered. */
async function planTitles(): Promise<string[]> {
  return window.locator('[data-testid=plan-block] .plan__title').allInnerTexts();
}

/**
 * Drags a row by its grip onto the slot another row occupies (#23).
 *
 * The pointer path as a person performs it: press the grip, move, release. Two details are
 * load-bearing rather than decoration. The move is issued in steps, because the drop target is read
 * from the pointer's position and a single jump is one sample; and the drop marker is asserted
 * *before* the release, because a release that commits an order the learner was never shown is the
 * defect the marker exists to prevent.
 */
async function dragPlanRow(fromRow: number, toRow: number): Promise<void> {
  const grip = window.getByTestId('plan-grip').nth(fromRow);
  const target = window.locator('[data-testid=plan-block]').nth(toRow);
  const gripBox = await grip.boundingBox();
  const targetBox = await target.boundingBox();
  if (gripBox === null || targetBox === null) throw new Error('the plan has no rows to drag');

  await window.mouse.move(gripBox.x + gripBox.width / 2, gripBox.y + gripBox.height / 2);
  await window.mouse.down();
  // Four pixels into the target row: inside it, and clear of the seam with the row above.
  await window.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + 4, { steps: 4 });
  await expect(target).toHaveAttribute('data-drop', '');
  await window.mouse.up();
}

/** The keyboard path: put the keyboard on a row's grip and press a key (or an `A+B` combination). */
async function pressOnGrip(fromRow: number, key: string, times = 1): Promise<void> {
  await window.getByTestId('plan-grip').nth(fromRow).focus();
  for (let press = 0; press < times; press += 1) await window.keyboard.press(key);
}

/*
 * First on purpose: everything below claims to exercise the offline path, and that claim is only
 * true when no provider credential reached the child process. The run-mode indicator is the
 * product's own answer to "which model is speaking" — without `hermeticEnv()` clearing the key,
 * a developer machine that exports `FOCUSLOOP_DEEPSEEK_API_KEY` would show network mode and this
 * test would fail rather than silently spend their key.
 */
test('the suite exercises the offline mock, never a real provider', async () => {
  const footer = window.locator('.footer__meta');
  await expect(footer).toBeVisible();
  // The model name is locale-independent; the mode label is the English default of a fresh profile.
  await expect(footer).toContainText('focusloop-mock-v1');
  await expect(footer).toContainText('offline mode');
});

/*
 * Second on purpose: the app boots with nothing running, which is the only state this block appears in.
 * Waiting until later in the file would mean ending a session to get back to it, and the golden path
 * below starts one.
 */
test('the app explains itself while nothing is running', async () => {
  const gettingStarted = window.getByTestId('getting-started');
  await expect(gettingStarted).toBeVisible();

  /*
   * The path, in the order it happens. It is asserted as a list *of* items, not just as text: `li` keeps
   * its `listitem` role inside anything, so counting items alone would still pass if the container had
   * been changed to a `div` - which is what the `list` assertion below is for. (It pins the element,
   * which is the markup the markers come from; it does not claim anything about a browser's own
   * accessibility tree, which no test here can see.)
   */
  await expect(gettingStarted.getByRole('list')).toHaveCount(1);
  await expect(gettingStarted.getByRole('listitem')).toHaveCount(3);

  const steps = gettingStarted.getByRole('listitem');
  await expect(steps.first()).toContainText('Pick a course');
  await expect(steps.last()).toContainText('focus screen');
  await expect(steps.last()).toContainText('small step');

  /*
   * And the second step names the control it sends the learner to. This is the assertion that would have
   * caught the first version of this copy, which said "start one micro task from the plan" - the plan is
   * a panel that starts closed and is not on the path at all, so a learner following the block in order
   * would have arrived on the focus screen and found nothing called the plan. Reading the label off the
   * button rather than writing it here is what keeps this step's wording and that control together - and
   * it is this step only: the other two are prose, and no assertion ties them to a label.
   */
  const startLabel = await window.getByTestId('start-session').first().innerText();
  await expect(steps.nth(1)).toContainText(startLabel);

  // And it ends on the product's premise rather than on the learner's homework.
  await expect(gettingStarted).toContainText('Stop whenever you like');
  await expect(gettingStarted).toContainText('Coming back later is the point');

  // The status line it sits above is still there and still says the other thing: one line reports what
  // is happening, the other says what to do about it.
  await expect(gettingStarted).toContainText('No session running');

  await expect(window.locator('.banner--error')).toHaveCount(0);
});

test('golden path: learn, get interrupted, resume, see the outcome', async () => {
  // 1. The app boots into Home with the built-in demo course.
  await expect(
    window.getByRole('heading', { name: 'Keep your learning continuous' }),
  ).toBeVisible();
  const courseCard = window.getByTestId('course-card').first();
  await expect(courseCard).toContainText('Red-black trees');

  // 2. Start a session from the demo course.
  await courseCard.getByTestId('start-session').click();
  await stateIs('READY');

  // 3. Begin the first micro task.
  await window.getByTestId('start-task').first().click();
  await stateIs('FOCUSED');
  const firstTaskTitle = await window.getByTestId('task-title').innerText();

  // 4. Complete it.
  await window.getByTestId('complete-task').click();
  await expect(window.getByTestId('tasks-completed')).toBeVisible();

  // 5. Simulate a distraction.
  await window.getByTestId('sim-distraction').click();
  await stateIs('DISTRACTED');

  // 6. ...and a late return: the state engine must mark the interruption.
  await window.getByTestId('sim-return').click();
  await stateIs('INTERRUPTED');

  // 7. The resume card appears and restores the cognitive position.
  const resume = window.getByRole('region', { name: 'Resume where you left off', exact: true });
  await expect(resume).toBeVisible();
  await expect(resume).toContainText('Continue');
  await expect(resume).toContainText('Next step:');

  // No IPC call may have failed while the card came up.
  await expect(window.locator('.banner--error')).toHaveCount(0);

  // 8. Continue.
  await window.getByTestId('resume-continue').click();
  await expect(resume).toBeHidden();
  await stateIs('RESUMING');

  // 9. The dashboard reflects the interruption and a measured resume latency.
  await clickSidebarLink('Dashboard');
  await expect(window.getByTestId('interruptions')).toHaveText('1');
  await expect(window.getByTestId('tasks')).toContainText('/ 5');
  await expect(window.getByTestId('latency')).not.toHaveText('—');
  await expect(window.getByTestId('duration')).toBeVisible();

  // The task the learner was on is still the task they resume into.
  await clickSidebarLink('Focus Session');
  expect(firstTaskTitle.length).toBeGreaterThan(0);

  // Every screen the learner visited was rendered without an IPC failure.
  await expect(window.locator('.banner--error')).toHaveCount(0);
});

test('the remaining work is shown as a proportional plan', async () => {
  await clickSidebarLink('Focus Session');
  await window.getByTestId('focus-plan-toggle').click();
  await expect(window.locator('.plan')).toBeVisible();

  // One block per remaining micro task. The demo course has five; the golden path finished one.
  const blocks = window.locator('[data-testid=plan-block]');
  await expect(blocks).toHaveCount(4);

  const boxes = await blocks.evaluateAll((nodes) =>
    nodes.map((node) => {
      const box = node.getBoundingClientRect();
      return { top: box.top, height: box.height };
    }),
  );

  // The geometry is the information: the longest task must occupy more of the column than the
  // shortest one, or the plan is just a list with extra spacing.
  const heights = boxes.map((box) => box.height);
  expect(Math.max(...heights)).toBeGreaterThan(Math.min(...heights));

  // And the blocks tile the column, so the plan reads as one continuous stretch of time.
  for (let index = 1; index < boxes.length; index += 1) {
    const previous = boxes[index - 1]!;
    const current = boxes[index]!;
    expect(Math.abs(previous.top + previous.height - current.top)).toBeLessThan(1);
  }

  // The total is stated, so it does not have to be added up from the blocks.
  await expect(window.getByTestId('plan-remaining')).toContainText('left');

  // Every block is still startable, which is the whole point of showing it.
  await expect(window.locator('.plan').getByTestId('start-task')).toHaveCount(4);

  await expect(window.locator('.banner--error')).toHaveCount(0);
});

test('the app keeps working when the agent has nothing to say', async () => {
  await clickSidebarLink('Home');
  await expect(
    window.getByRole('heading', { name: 'Keep your learning continuous' }),
  ).toBeVisible();

  /*
   * A session is running, so the getting-started block is gone - with nothing dismissed and nothing
   * stored, which is what makes it contextual rather than a nag (#21). The course cards are asserted in
   * the same breath so that "not there" cannot be "the page is somewhere else".
   */
  await expect(window.getByTestId('course-card').first()).toBeVisible();
  await expect(window.getByTestId('getting-started')).toHaveCount(0);

  // Overload: the policy must offer a break, and the learner can decline it.
  await clickSidebarLink('Focus Session');
  await window.getByTestId('sim-overload').click();
  const agent = window.locator('.agent');
  await expect(agent).toBeVisible();
  await expect(agent).toHaveAttribute('data-action', 'BREAK');
  await agent.getByRole('button', { name: 'Not now' }).click();
  await expect(agent).toBeHidden();

  await expect(window.locator('.banner--error')).toHaveCount(0);
});

test('resume is offered once, by the resume card alone', async () => {
  await clickSidebarLink('Home');
  await window.getByTestId('course-card').first().getByTestId('start-session').click();
  await window.getByTestId('start-task').first().click();

  await window.getByTestId('sim-distraction').click();
  await window.getByTestId('sim-return').click();

  // The card is the surface for RESUME; the agent panel must not repeat it.
  await expect(
    window.getByRole('region', { name: 'Resume where you left off', exact: true }),
  ).toBeVisible();
  await expect(window.locator('.agent')).toBeHidden();

  await window.getByTestId('resume-continue').click();
  await expect(
    window.getByRole('region', { name: 'Resume where you left off', exact: true }),
  ).toBeHidden();
  await expect(window.locator('.banner--error')).toHaveCount(0);
});

test('the dashboard re-aggregates when the window changes', async () => {
  // The previous test left a commitment running, so the sidebar starts folded away.
  await clickSidebarLink('Dashboard');
  await expect(window.getByTestId('insights-total')).toBeVisible();

  // The 7-day window always renders exactly one cell per calendar day.
  await window.getByTestId('range-week').click();
  await expect(window.locator('.heat__day')).toHaveCount(7);

  // Today, and "this session", are both a single day.
  await window.getByTestId('range-today').click();
  await expect(window.locator('.heat__day')).toHaveCount(1);
  await window.getByTestId('range-session').click();
  await expect(window.locator('.heat__day')).toHaveCount(1);

  // The window was not empty: the donut drew something and the ring has a centre.
  await window.getByTestId('range-all').click();
  await expect(window.locator('.donut svg circle').first()).toBeVisible();
  await expect(window.getByTestId('focus-ratio')).toContainText('%');

  // The footnote belongs below the row it annotates, and the ring and its legend belong on that same
  // row. Both are layout facts, so they are measured rather than read off the template — the revision
  // of this note that was written into the template instead of measured is the one that pushed the
  // legend off the ring's row and took a whole review round to notice.
  const ring = await window.locator('.donut').boundingBox();
  const legend = await window.locator('.legend').boundingBox();
  const rowBox = await window.locator('.donut-row').boundingBox();
  const hint = await window.getByTestId('focus-ratio-hint').boundingBox();
  if (ring === null || legend === null || rowBox === null || hint === null) {
    throw new Error('the ring, its legend, their row and the hint must all be laid out');
  }

  const overlap =
    Math.min(ring.y + ring.height, legend.y + legend.height) - Math.max(ring.y, legend.y);
  /*
   * Side by side when the row is wide enough for both, wrapped when it is not. The wrap is a responsive
   * decision, not the defect: the Windows runner measures a row that cannot hold both and wraps, where
   * `overlap` is -20 there and +132 here. Asserting the overlap unconditionally asserted this machine's
   * window width — the same mistake the tutor test made with `'above'`, caught the same way, by CI. The
   * width is measured, so the expectation follows the layout instead of assuming it; a legend that wraps
   * while the row *does* have room for it is still caught, because then `sideBySide` is true.
   */
  if (rowBox.width >= ring.width + legend.width) {
    expect(overlap, "the legend shares the ring's row instead of sitting under it").toBeGreaterThan(
      Math.min(ring.height, legend.height) / 2,
    );
  }
  expect(hint.y, 'the hint sits below the row').toBeGreaterThanOrEqual(
    rowBox.y + rowBox.height - 1,
  );
  // The row, not the ring: a hint boxed into the ring's column is exactly the ring's width, so comparing
  // against the ring would pass for the one layout this line exists to catch. The hint and the row are
  // both block children of the same panel, so they are equally wide when the hint is a footnote to both.
  expect(hint.width, 'the hint spans the row, not one column of it').toBeGreaterThanOrEqual(
    rowBox.width - 1,
  );

  await expect(window.locator('.banner--error')).toHaveCount(0);
});

test('the sidebar summary refreshes without hijacking the dashboard window', async () => {
  await clickSidebarLink('Dashboard');
  await window.getByTestId('range-week').click();
  await expect(window.getByTestId('range-week')).toHaveAttribute('aria-pressed', 'true');

  // The sidebar is always the "today" window, whatever the dashboard is showing, and
  // it is populated from its own request rather than from the dashboard's summary.
  await expect(window.getByTestId('today-total')).not.toHaveText('—');

  // An event refreshes the ambient summary...
  await window.getByTestId('sim-confusion').click();
  await expect(window.getByTestId('today-meta')).toBeVisible();

  // ...and must not drag the dashboard's window back to "today". One cell per calendar
  // day is the proof: the sidebar asking for "today" would leave exactly one.
  await expect(window.getByTestId('range-week')).toHaveAttribute('aria-pressed', 'true');
  await expect(window.locator('.heat__day')).toHaveCount(7);

  await expect(window.locator('.banner--error')).toHaveCount(0);
});

test('the theme can be switched and the choice survives a restart', async () => {
  // Restarting the app mid-test takes longer than a normal assertion sequence.
  test.setTimeout(90_000);

  await clickSidebarLink('Dashboard');

  await window.getByTestId('theme-light').click();
  await expect(window.locator('html')).toHaveAttribute('data-theme', 'light');
  await window.getByTestId('theme-dark').click();
  await expect(window.locator('html')).toHaveAttribute('data-theme', 'dark');

  // The preference, not the resolved theme, is what gets stored.
  await restartApp();
  await expect(window.locator('html')).toHaveAttribute('data-theme', 'dark');

  /*
   * And a second restart in a row. One restart succeeding is what hid this in the first place (#44):
   * the relaunch that arrives while the previous process is still leaving is the one that cannot
   * start, and a single restart never produces that launch.
   */
  await restartApp();
  await expect(window.locator('html')).toHaveAttribute('data-theme', 'dark');

  // `Auto` resolves against the OS rather than pinning a theme.
  await window.getByTestId('theme-system').click();
  await expect(window.locator('html')).toHaveAttribute('data-theme', /^(light|dark)$/);

  await expect(window.locator('.banner--error')).toHaveCount(0);
});

test('the interface can be switched to Chinese, and the choice survives a restart', async () => {
  // Restarting the app mid-test takes longer than a normal assertion sequence.
  test.setTimeout(90_000);

  await clickSidebarLink('Home');
  await expect(
    window.getByRole('heading', { name: 'Keep your learning continuous' }),
  ).toBeVisible();

  // 1. Switch to Chinese.
  await window.getByTestId('locale-zh').click();
  await expect(window.getByRole('heading', { name: '让你的学习一直连得上' })).toBeVisible();
  await expect(window.getByRole('link', { name: '首页' })).toBeVisible();
  await expect(window.getByRole('link', { name: '专注会话' })).toBeVisible();

  // The document language follows the interface. `<html lang>` is what a screen reader
  // uses to choose a voice, and Chinese read by an English voice is not usable.
  await expect(window.locator('html')).toHaveAttribute('lang', 'zh');

  // The whole screen must move, not just the navigation.
  await expect(window.getByRole('button', { name: '开始会话' }).first()).toBeVisible();
  await expect(window.getByRole('button', { name: '继续会话' })).toBeVisible();

  // 2. The wording the domain emits is translated too — the learner must never
  //    see an English sentence in the middle of a Chinese screen.
  await clickSidebarLink('专注会话');
  await window.getByTestId('sim-overload').click();
  const agent = window.locator('.agent');
  await expect(agent).toBeVisible();
  await expect(agent).toContainText('一次塞进来的东西太多了');

  /*
   * 2b. Tutor fallbacks are closed codes, not sentences (#108): the Chinese interface
   * must show the Chinese no-model wording. The entry only appears on a running step,
   * so one has to be under way — start it if it can be started, then assert.
   *
   * The assertion below is deliberately unconditional. Guarding the whole block with
   * `if (await startTask.isVisible())` reads as a check but is skippable: on the path
   * where the button is absent the tutor wording is never verified and the test still
   * passes, which is worse than failing.
   */
  const startTask = window.getByTestId('start-task').first();
  if (await startTask.isVisible().catch(() => false)) {
    await startTask.click();
  }
  await stateIs('FOCUSED');
  await expect(window.getByTestId('tutor-entry')).toBeVisible();
  await window.getByTestId('tutor-entry').click();
  await expect(window.getByTestId('tutor-panel')).toBeVisible();
  await window.getByTestId('tutor-mode-HINT').click();
  await window.getByTestId('tutor-question').fill('为什么颜色会变？');
  await expect(window.getByTestId('tutor-ask')).toBeEnabled();
  await window.getByTestId('tutor-ask').click();
  const tutorResult = window.getByTestId('tutor-result');
  await expect(tutorResult).toBeVisible();
  await expect(tutorResult).toContainText('当前没有连接模型');
  await expect(tutorResult).not.toContainText('No model is connected');
  await window.getByTestId('tutor-close').click();
  await expect(window.getByTestId('tutor-panel')).toBeHidden();

  // 3. A restart keeps the language: the store owns it, not the renderer.
  await restartApp();
  await expect(window.getByRole('heading', { name: '让你的学习一直连得上' })).toBeVisible();

  // No IPC call may have failed in either language.
  await expect(window.locator('.banner--error')).toHaveCount(0);

  // 4. And back, so the next run starts from a known state.
  await window.getByTestId('locale-en').click();
  await expect(
    window.getByRole('heading', { name: 'Keep your learning continuous' }),
  ).toBeVisible();
  await expect(window.locator('html')).toHaveAttribute('lang', 'en');
  await expect(window.locator('.banner--error')).toHaveCount(0);
});

/*
 * Last on purpose. The "overload" command raises a suggestion, and declining it spends
 * part of the intervention policy's session budget — enough of it that running this
 * earlier left the Chinese test above with nothing to show. Ordering is load-bearing
 * here, so this test runs once nothing else still needs the budget.
 */
test('a run of identical events is folded into one row', async () => {
  await clickSidebarLink('Dashboard');

  /*
   * The previous test restarted the app, so this also pins that the log is restored from
   * the store on launch rather than only built up from events seen in this renderer.
   *
   * Against `.timeline li` on purpose: the empty history renders its own row inside the same list, so this
   * is the assertion that would fail if the history were empty. Everything below counts *event* rows, which
   * carry their own test id - the empty-state row would otherwise be counted as one.
   */
  await expect(window.locator('.timeline li').first()).not.toContainText('No events recorded');
  const rows = window.locator('[data-testid="timeline-row"]');

  // Break any run that is still open, so the row arithmetic below does not depend on what
  // the previous test happened to leave behind.
  await window.getByTestId('sim-success').click();
  /*
   * #8: the row's text is the learner's wording; the enum member is the row's `title`, the way the state
   * chip's raw value is a data attribute. `toContainText` never consults attributes, so it cannot see it.
   */
  await expect(rows.first().locator('strong')).toHaveAttribute('title', 'QUIZ_CORRECT');
  /*
   * And the wording beside it, because nothing else asserts it: the unit spec exercises the maps, the
   * monitor only proves the *absence* of raw vocabulary, and the attribute above would still pass if the
   * row rendered the wrong key's words.
   */
  await expect(rows.first()).toContainText('Answer was right');
  const rowsBefore = await rows.count();

  // A single "overload" fires three HELP_REQUESTED events back to back. That is how one
  // click used to add three identical cards to the log.
  await window.getByTestId('sim-overload').click();

  await expect(rows).toHaveCount(rowsBefore + 1);

  const newest = rows.first();
  await expect(newest.locator('strong')).toHaveAttribute('title', 'HELP_REQUESTED');
  await expect(newest).toContainText('You asked for help');
  await expect(newest.locator('.timeline__count')).toHaveText('×3');
  // The shorthand is not the accessible name.
  await expect(newest.locator('.timeline__count')).toHaveAttribute('aria-label', '3 times');

  await expect(window.locator('.banner--error')).toHaveCount(0);
});

/*
 * #22: the intervention outcomes are rows with a share bar, not a five-column table.
 *
 * Its own test rather than a block inside the folding one, which would report a broken share bar under a
 * test named for the event log. It is placed here because outcomes are session-scoped and the session is
 * ended a few tests further on - starting one here would spend intervention budget this file rations, and
 * after the session ends there is nothing left to show.
 *
 * Nothing is hard-coded about *how many* rows there are: that depends on what those earlier tests
 * resolved. The assertions are the properties the markup promises.
 */
test('the intervention outcomes read as rows with a share and a sample size', async () => {
  await clickSidebarLink('Dashboard');

  const outcomes = window.locator('[data-testid="outcome-row"]');
  /*
   * Named rather than counted, because this is the one failure here that is not about the markup: with no
   * outcomes resolved by the earlier tests there is nothing to walk, and `not.toHaveCount(0)` would say
   * that in the least useful way possible.
   */
  await expect(
    outcomes,
    'no outcome rows: this test reads the interventions the earlier tests in this file resolved, so run the file rather than this test alone',
  ).not.toHaveCount(0);

  /*
   * Walked rather than sampled: a row whose bar was missing its value would pass every assertion here if
   * only the first row were checked, and "the first row happens to be fine" is not the claim.
   */
  for (const outcome of await outcomes.all()) {
    await expect(outcome.locator('[data-testid="outcome-share"]')).toContainText('%');
    await expect(outcome.locator('[data-testid="outcome-counts"]')).toContainText('N = ');

    const bar = outcome.getByRole('progressbar');
    await expect(bar).toHaveAttribute('aria-valuemin', '0');
    await expect(bar).toHaveAttribute('aria-valuemax', '100');
    await expect(bar).toHaveAttribute('aria-valuenow', /^\d+$/);

    /*
     * The bar, its accessible value and the visible percentage are all one number. Reading the attribute
     * as a number rather than matching text is what makes the comparison meaningful - and `Number(null)`
     * being `0` is why the attribute's presence is asserted above rather than assumed.
     *
     * The width is read twice on purpose: `toHaveAttribute` proves the binding wrote a style attribute at
     * all (a missing one and a `0%` both used to satisfy the arithmetic, and neither is a width), and
     * `style.width` reads that same inline value back to tie it to `aria-valuenow` exactly. The second
     * read is what the first one gave up when it stopped matching the digits.
     */
    const shown = Number(await bar.getAttribute('aria-valuenow'));
    await expect(bar.locator('.bar__fill')).toHaveAttribute('style', /width: \d+%/);
    const width = await bar.locator('.bar__fill').evaluate((fill) => fill.style.width);
    expect(width).toBe(`${shown}%`);
    await expect(outcome.locator('[data-testid="outcome-share"]')).toHaveText(`${shown}% accepted`);
    // The sample size reaches the accessible value too, not only the sighted reader - and so does the
    // share, which `aria-valuetext` would otherwise replace in the announcement.
    await expect(bar).toHaveAttribute('aria-valuetext', /%/);
    await expect(bar).toHaveAttribute('aria-valuetext', /N = \d+/);
  }

  await expect(window.locator('.banner--error')).toHaveCount(0);
});

test('the non-modal resume notice is keyboard reachable and folds without dismissing', async () => {
  await clickSidebarLink('Focus Session');
  await window.getByTestId('sim-distraction').click();
  await window.getByTestId('sim-return').click();

  const resume = window.getByRole('region', { name: 'Resume where you left off', exact: true });
  await expect(resume).toBeVisible();
  await expect(window.getByRole('dialog')).toHaveCount(0);

  const toggle = window.getByTestId('focus-notice-toggle');
  await toggle.focus();
  await window.keyboard.press('Tab');
  await expect(window.getByTestId('resume-continue')).toBeFocused();
  await window.keyboard.press('Escape');
  await expect(resume).toBeHidden();
  await expect(toggle).toBeFocused();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');

  // Reopening still presents the same unresolved choice, rather than recording a dismissal.
  await window.keyboard.press('Enter');
  await expect(resume).toBeVisible();
  await window.getByTestId('resume-continue').click();
  await expect(resume).toBeHidden();
  await expect(window.locator('.banner--error')).toHaveCount(0);
});

/*
 * #23, and placed here for the same reason the outcomes test is: it needs the remaining tasks the
 * earlier tests in this shared instance left behind, and everything after the session-ending test
 * below has none at all.
 *
 * It restores the order before it finishes. Nothing after it depends on the order, but a test that
 * leaves the app in a state it did not find it in is a test whose next failure has two possible
 * causes, and the one that is not in the failing test is the expensive one.
 */
test('the remaining tasks can be reordered by pointer and by keyboard, and the order survives a restart', async () => {
  // A restart mid-test takes longer than an ordinary assertion sequence.
  test.setTimeout(90_000);

  await clickSidebarLink('Focus Session');
  await openPlan();

  const original = await planTitles();
  expect(
    original.length,
    'the drag and the restart below need three rows to move between, so run the whole file rather than this test alone',
  ).toBeGreaterThan(2);

  const moved = original[0]!;

  /*
   * What the learner is doing, before anything is moved. Reordering is how they decide what comes
   * *next*; if it also started or switched a task, asking for an order would be a way to change step
   * by accident. The pair is recorded rather than asserted once, because the claim is that these two
   * are what the moves below did not touch.
   */
  const taskBefore = await window.getByTestId('task-title').innerText();
  const stateBefore = await window.getByTestId('state').getAttribute('data-state');

  // 1. The pointer: the first row is dragged onto the third row's slot.
  await dragPlanRow(0, 2);
  await expect.poll(planTitles).toEqual([original[1], original[2], moved, ...original.slice(3)]);

  // The step is still the step, and the learner is still in it.
  await expect(window.getByTestId('task-title')).toHaveText(taskBefore);
  await expect(window.getByTestId('state')).toHaveAttribute('data-state', stateBefore ?? '');
  // And the session is still running: moving a row is not a way to leave what they are in the middle of.
  await expect(window.getByTestId('end-session')).toBeVisible();

  // 2. The keyboard: the same row, one place up, from its own grip.
  await pressOnGrip(2, 'ArrowUp');
  await expect.poll(planTitles).toEqual([original[1], moved, original[2], ...original.slice(3)]);

  // Still the same step, still the same session, still running.
  await expect(window.getByTestId('task-title')).toHaveText(taskBefore);
  await expect(window.getByTestId('state')).toHaveAttribute('data-state', stateBefore ?? '');
  await expect(window.getByTestId('end-session')).toBeVisible();
  // And the move is said out loud, because nothing else on the screen reports it.
  await expect(window.getByTestId('reorder-status')).toContainText(moved);
  await expect(window.getByTestId('reorder-status')).toContainText('position 2');
  // The keyboard is left on the row it just moved, not on whatever the re-render put in that slot.
  await expect(window.getByTestId('plan-grip').nth(1)).toBeFocused();

  /*
   * 3. The activation a button advertises, which is the only path for an interface that is Tab and
   *    press. Both directions are asserted, because one of them alone would leave the other as the
   *    direction such a learner cannot reach at all - and this leaves the order where step 2 left it.
   */
  await pressOnGrip(1, 'Enter');
  await expect.poll(planTitles).toEqual([original[1], original[2], moved, ...original.slice(3)]);
  await pressOnGrip(2, 'Shift+Enter');
  await expect.poll(planTitles).toEqual([original[1], moved, original[2], ...original.slice(3)]);
  await expect(window.getByTestId('plan-grip').nth(1)).toBeFocused();

  // 4. A restart keeps it. The order belongs to the session, and the session is a row in a database
  //    rather than anything the renderer is holding.
  const afterMoves = await planTitles();
  await restartApp();
  await clickSidebarLink('Focus Session');
  await openPlan();
  await expect.poll(planTitles).toEqual(afterMoves);

  // 5. Back to the order it started in, so the run continues from the state it found.
  await pressOnGrip(1, 'ArrowUp');
  await expect.poll(planTitles).toEqual(original);

  await expect(window.locator('.banner--error')).toHaveCount(0);
});

/*
 * Also last: it ends the only running session, so anything after it would have nothing to
 * work with.
 */
test('ending a session leaves nothing current', async () => {
  // The previous test left a commitment running, so the sidebar starts folded away.
  await clickSidebarLink('Focus Session');
  await expect(window.getByTestId('end-session')).toBeVisible();

  await window.getByTestId('end-session').click();

  /*
   * This assertion is only reachable now that starting a session ends the running one.
   * Before that, an older session was still active underneath, so the app silently handed
   * itself back to it and "no session running" never appeared.
   */
  await expect(window.getByRole('heading', { name: 'No session running' })).toBeVisible();

  await clickSidebarLink('Home');
  await expect(window.getByText('No session running. Pick a course below to begin.')).toBeVisible();
  // And it comes back on its own, which is the other half of "contextual rather than remembered".
  await expect(window.getByTestId('getting-started')).toBeVisible();

  await expect(window.locator('.banner--error')).toHaveCount(0);
});

/*
 * Last: it runs its own session from start to finish, so the "nothing to work with" left
 * by the test above is a state it brings itself out of. It never touches the simulator,
 * so the intervention budget the folding test above relies on is not disturbed.
 */
test('the sidebar folds on click, and focus folds it fully, with a floating recall', async () => {
  // 1. A running commitment folds the whole sidebar away — no icon rail. The floating
  //    button is the only control left, so the fold cannot strand the navigation.
  await window.getByTestId('course-card').first().getByTestId('start-session').click();
  await window.getByTestId('start-task').first().click();
  await stateIs('FOCUSED');
  await expect(window.locator('.sidebar')).toBeHidden();
  await expect(window.getByTestId('sidebar-expand')).toBeVisible();

  // Hidden is not the same as gone: the fold only pays off if the sidebar's column
  // actually closes and the content takes the space.
  const contentLeft = await window
    .locator('.content')
    .evaluate((el) => el.getBoundingClientRect().left);
  expect(contentLeft).toBeLessThan(2);

  // But on focus the fold hides the chrome, not the layout: the workspace keeps the
  // column the open sidebar occupied, so the countdown never reflows to where the
  // peeked panel will appear.
  const workspaceLeft = await window
    .locator('.focus-workspace')
    .evaluate((el) => el.getBoundingClientRect().left);
  expect(workspaceLeft).toBeGreaterThanOrEqual(232);

  // 1b. Finishing the step is a shell-narrowing phase too — `keepsRail` in
  //     `core/focus-phase.ts`, which the canvas publishes as `data-rail` — so the fold must
  //     not hand the chrome back at the moment the next action is the only useful thing on
  //     screen. The rail used to come back here, and so would a fold keyed on the phase names
  //     by hand; this assertion is what keeps the two policies on one switch.
  await window.getByTestId('complete-task').click();
  await expect(window.locator('.sidebar')).toBeHidden();
  await expect(window.getByTestId('sidebar-expand')).toBeVisible();
  // The following step is offered in the confirmation itself, not in the (closed) plan.
  await window.locator('.focus-task--complete').getByTestId('start-task').click();
  await stateIs('FOCUSED');
  await expect(window.locator('.sidebar')).toBeHidden();

  // 2. Hovering the button peeks the sidebar out as an overlay — visible, but the
  //    content column must not move: a peek is a look, not a reflow.
  const contentBeforePeek = await contentBox();
  await window.getByTestId('sidebar-expand').hover();
  await expect(window.locator('.sidebar')).toBeVisible();

  //    Not "the left edge is still where it was" but "the box is the same box": the
  //    peeked sidebar leaves the grid, and a content column placed by document order
  //    would be handed the folded 0px track instead of its own — the page squeezed into
  //    the padding it still carried, which is how a peek came out as a broken layout or
  //    a screen with nothing on it at all.
  expect(await contentBox()).toEqual(contentBeforePeek);

  //    The peek is a cover, not a swap: the panel is the docked sidebar's own opaque surface,
  //    lifted off the page with a shadow, so what it slides over is covered rather than
  //    half-visible through it. Chromium may serialize the colour as rgb(), rgba() or
  //    color(srgb ... / a), so the alpha is read from the shape of the value.
  const panel = await window.locator('.sidebar').evaluate((el) => {
    const style = getComputedStyle(el);
    const color = style.backgroundColor;
    const alphaOf = (value: string): number => {
      const srgb = value.match(/\/\s*([\d.]+)\s*\)$/);
      if (srgb) return Number(srgb[1]);
      const components = (value.match(/rgba?\(([^)]+)\)/)?.[1] ?? '').split(/[,/]\s*/);
      return components.length === 4 ? Number(components[3]) : 1;
    };
    return {
      backgroundAlpha: alphaOf(color),
      backdropFilter: style.backdropFilter,
      boxShadow: style.boxShadow,
    };
  });
  expect(panel.backgroundAlpha).toBe(1);
  expect(panel.backdropFilter).toBe('none');
  expect(panel.boxShadow).not.toBe('none');

  //    And the workspace itself stays where the fold left it: the panel slides over
  //    the gutter it vacated, never over the countdown.
  const workspaceLeftDuringPeek = await window
    .locator('.focus-workspace')
    .evaluate((el) => el.getBoundingClientRect().left);
  expect(workspaceLeftDuringPeek).toBeGreaterThanOrEqual(232);

  // 3. Moving the pointer away folds it straight back.
  await window.mouse.move(640, 400);
  await expect(window.locator('.sidebar')).toBeHidden();

  // 4. A click, by contrast, pins it open for as long as the learner wants it — the
  //    press lands on the peeked panel, which is what the hover was asking for.
  await pinThroughPeek();
  await expect(window.locator('.sidebar')).toBeVisible();

  // 5. ...and its own toggle folds it away again for the rest of the commitment.
  await window.getByTestId('sidebar-toggle').click();
  await expect(window.locator('.sidebar')).toBeHidden();

  // 6. Focus over. The fold was deliberate, so it survives the session ending.
  await window.getByTestId('end-session').click();
  await expect(window.getByRole('heading', { name: 'No session running' })).toBeVisible();
  await expect(window.locator('.sidebar')).toBeHidden();

  // 7. On a quiet screen, the same pair of controls folds and recalls at will.
  await pinThroughPeek();
  await window.getByTestId('sidebar-toggle').click();
  await expect(window.locator('.sidebar')).toBeHidden();

  //    Folded, the panel's own toggle is the pin, not a second collapse that does
  //    nothing: it says so, and the press does what it says.
  await window.getByTestId('sidebar-expand').hover();
  await expect(window.getByTestId('sidebar-toggle')).toHaveAttribute('aria-label', 'Show sidebar');
  await window.getByTestId('sidebar-toggle').click();
  await expect(window.getByTestId('sidebar-expand')).toBeHidden();
  await expect(window.locator('.sidebar')).toBeVisible();

  await expect(window.locator('.banner--error')).toHaveCount(0);
});

/*
 * Last, and it brings its own session, because it finishes by starting a step: any test after it
 * would inherit a different current task than the one it was written against.
 */
test('the plan closes the way a panel closes, and never covers the step it started', async () => {
  await clickSidebarLink('Home');
  await window.getByTestId('course-card').first().getByTestId('start-session').click();
  await window.getByTestId('start-task').first().click();
  await stateIs('FOCUSED');

  const toggle = window.getByTestId('focus-plan-toggle');
  const plan = window.locator('.plan');

  // Closed until it is asked for. While a step runs, nothing is laid over the task.
  await expect(plan).toBeHidden();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');

  // The trigger raises it.
  await toggle.click();
  await expect(plan).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');

  /*
   * It arrives as a sheet anchored to the bottom edge rather than to a corner, and it is centred.
   * "Closer to the bottom than to the top" is the property, not "entirely below the middle": a
   * sheet with four blocks and a timeline is tall enough to cross the middle on purpose. The exact
   * offset is not asserted, because the simulator bar is present in this run and the sheet starts
   * above it.
   */
  const sheet = await window.locator('.focus-plan[data-open]').evaluate((el) => {
    const box = el.getBoundingClientRect();
    return {
      top: box.top,
      bottom: box.bottom,
      left: box.left,
      right: box.right,
      // `document.documentElement`, not `window`: this module declares its own `window` for the
      // page handle, and it shadows the global even inside an `evaluate` callback.
      viewportHeight: document.documentElement.clientHeight,
      viewportWidth: document.documentElement.clientWidth,
    };
  });
  expect(sheet.viewportHeight - sheet.bottom).toBeLessThan(100);
  expect(sheet.viewportHeight - sheet.bottom).toBeLessThan(sheet.top);
  expect(Math.abs(sheet.left - (sheet.viewportWidth - sheet.right))).toBeLessThan(2);

  // And it rises into place: that motion is what makes it a card that arrives rather than a jump.
  await expect
    .poll(() =>
      window.locator('.focus-plan[data-open]').evaluate((el) => getComputedStyle(el).animationName),
    )
    .toBe('plan-rise');

  // Escape lowers it and hands focus back to the control that raised it. A panel that can be
  // opened from the keyboard and not closed from it is the trap this replaces: while it was a
  // `<details>`, the summary was the only affordance that could close it.
  await window.keyboard.press('Escape');
  await expect(plan).toBeHidden();
  await expect(toggle).toBeFocused();

  // A click anywhere else lowers it too.
  await toggle.click();
  await expect(plan).toBeVisible();
  await window.getByTestId('tasks-completed').click();
  await expect(plan).toBeHidden();

  // And starting a step lowers it without being asked, so the step it just started is not behind
  // the card — the reason the plan was unusable during a step.
  await toggle.click();
  await expect(plan).toBeVisible();
  await window.locator('.plan').getByTestId('start-task').first().click();
  await expect(plan).toBeHidden();
  await expect(window.getByTestId('task-title')).toBeVisible();

  await expect(window.locator('.banner--error')).toHaveCount(0);
});

/*
 * Last as well: it finishes by completing a step, which leaves a different current task and a
 * different count behind than the tests above were written against.
 */
test('finishing a step arrives once, and says nothing that accumulates', async () => {
  await clickSidebarLink('Home');
  await window.getByTestId('course-card').first().getByTestId('start-session').click();
  await window.getByTestId('start-task').first().click();
  await stateIs('FOCUSED');

  await window.getByTestId('complete-task').click();

  const confirmation = window.locator('.focus-task--complete');
  await expect(confirmation).toBeVisible();

  /*
   * It arrives rather than swapping in — asserted on the computed animation, because a screenshot
   * cannot tell "animated" from "instant", and this motion is the whole of what #73 asks for.
   */
  await expect
    .poll(() => confirmation.evaluate((el) => getComputedStyle(el).animationName))
    .toBe('step-done-in');
  await expect
    .poll(() =>
      confirmation.locator('.eyebrow').evaluate((el) => getComputedStyle(el).animationName),
    )
    .toBe('step-done-mark');

  /*
   * The next step is usable from the first frame: the motion is decoration, not a gate.
   */
  const next = confirmation.getByTestId('start-task');
  await expect(next).toBeEnabled();

  /*
   * And a digit anywhere in here would be a count. Counting, streaks and anything else that
   * accumulates are what `docs/focus-redesign-research.md` rules out, so the confirmation is
   * checked for saying one thing and offering the next instead.
   */
  expect(await confirmation.innerText()).not.toMatch(/\d/);

  await next.click();
  await stateIs('FOCUSED');

  // Reduced motion: the same confirmation, arriving at once instead of rising.
  await window.emulateMedia({ reducedMotion: 'reduce' });
  await window.getByTestId('complete-task').click();
  await expect(confirmation).toBeVisible();
  await expect
    .poll(() => confirmation.evaluate((el) => getComputedStyle(el).animationName))
    .toBe('none');
  await expect(window.getByTestId('task-title')).toBeVisible();
  await window.emulateMedia({ reducedMotion: 'no-preference' });

  await expect(window.locator('.banner--error')).toHaveCount(0);
});

/*
 * Last, and it needs nothing that came before it: the import form lives on Home and the check is
 * about a control's state rather than a session.
 */
test('the import form asks for a file name instead of failing on the channel', async () => {
  await clickSidebarLink('Home');

  const name = window.getByTestId('import-file-name');
  const submit = window.getByTestId('import-submit');
  const reason = window.getByTestId('import-needs-name');

  /*
   * Wait for the form to finish binding, not merely for the button to look enabled.
   *
   * An unbound `<button>` is enabled by default, so `toBeEnabled` can pass before Angular
   * has applied `[value]`, `[disabled]`, or `(input)`. Filling in that window writes into
   * a control nothing is listening to: the signal keeps `notes.md`, the first change
   * detection restores the value, and the button never disables. That race is why this
   * test went red locally while CI stayed green — the test before it leaves the renderer
   * busy enough that a machine-dependent amount of work lands between navigation and
   * fill. Waiting for the value and the label is the precondition this test always
   * assumed ("the field arrives holding one"), not a widened timeout.
   */
  await expect(name).toHaveValue('notes.md');
  await expect(submit).toHaveText('Import');
  await expect(submit).toBeEnabled();

  // Clearing it disables the button and states why, rather than letting an empty name travel to
  // the main process and come back as a validation error naming the IPC channel.
  await name.fill('');
  await expect(submit).toBeDisabled();
  await expect(reason).toBeVisible();

  // Whitespace is not a name either.
  await name.fill('   ');
  await expect(submit).toBeDisabled();

  await name.fill('notes.md');
  await expect(submit).toBeEnabled();
  await expect(reason).toBeHidden();

  /*
   * The developer inspector is laid over this corner of the screen, and over this button in
   * particular once a running session has pushed the form down. A press has to land on the button:
   * `elementFromPoint` asks the document what is actually at that pixel, which no z-order or
   * `pointer-events` mistake can talk its way out of.
   */
  await submit.scrollIntoViewIfNeeded();
  await expect
    .poll(() =>
      submit.evaluate((el) => {
        const box = el.getBoundingClientRect();
        const under = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
        return under === el || el.contains(under);
      }),
    )
    .toBe(true);

  // And the import it guards actually goes through: no channel error, and a result to show.
  await submit.click();
  await expect(window.locator('.banner--error')).toHaveCount(0);
  await expect(window.getByTestId('import-summary')).toBeVisible();

  await expect(window.locator('.banner--error')).toHaveCount(0);
});

test('a file on the machine can be imported without typing any of it out', async () => {
  await clickSidebarLink('Home');

  const picker = window.getByTestId('import-pick-file');
  const name = window.getByTestId('import-file-name');
  const notice = window.getByTestId('import-pick-notice');
  const submit = window.getByTestId('import-submit');

  /*
   * The file chooser itself cannot be driven from here — it belongs to the operating system — but the
   * input it hangs off can be, and that input is the part the app is responsible for. This is the
   * journey that did not exist before: there was no way to bring a file in short of opening it
   * elsewhere, selecting all of it, and pasting it back into the textarea.
   */
  await picker.setInputFiles({
    name: 'rotations.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from(
      '# Rotations\n\nA rotation restructures three nodes while preserving the in-order sequence.\n\n## Left rotation\n\nA left rotation moves the pivot down and to the right.\n',
    ),
  });

  // Both the name and the text came out of the file, so neither had to be typed.
  await expect(name).toHaveValue('rotations.md');
  await expect(notice).toBeHidden();

  await submit.click();
  await expect(window.locator('.banner--error')).toHaveCount(0);
  await expect(window.getByTestId('import-summary')).toBeVisible();

  /*
   * A file that is not text is turned away where it was chosen, in words, and changes nothing: the
   * course that was just imported is still the one waiting to be imported. Left to the parser this
   * would have become a course with no concepts in it, which reads as success.
   */
  await picker.setInputFiles({
    name: 'archive.zip',
    mimeType: 'application/zip',
    buffer: Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x01]),
  });

  await expect(notice).toBeVisible();
  await expect(name).toHaveValue('rotations.md');
  await expect(window.getByTestId('import-summary')).toBeVisible();
});

/*
 * Last, and for a different reason than the fold test above: this one starts a session of its own and
 * finishes by ending it, so it has to run after everything that needs a session. It cannot disturb the
 * Chinese test's intervention budget — that budget is counted per session, and this test begins a new
 * one — but it does leave no session running, which is the state this file has to end in.
 */
test('the reason the learner gives is answered according to which kind of stuck it is', async () => {
  /*
   * The one producer of the reason this whole slice acts on.
   *
   * The policy's own tests prove the *rule* by handing it an event they wrote themselves, which is how
   * a rule can be right while the app can never reach it: the reason has to be produced by something a
   * learner can press. Deleting the six reason buttons leaves every unit suite green, so the button is
   * pressed here, in the built app, and the answer is read back off the panel.
   */
  await clickSidebarLink('Home');
  await window.getByTestId('course-card').first().getByTestId('start-session').click();
  await window.getByTestId('start-task').first().click();

  /*
   * The keyboard has to be able to get in as well as out. Opening the chooser replaces the trigger with
   * the group, so the focused element is destroyed; without moving focus, the learner is left on the
   * body and has to tab from the top of the document to reach the six reasons. Focus goes to the group,
   * which is what carries the question.
   */
  await window.getByTestId('focus-stuck').click();
  await expect(window.getByTestId('stuck-reasons')).toBeFocused();
  await expect(window.getByTestId('stuck-tired')).toBeVisible();
  await window.keyboard.press('Escape');
  await expect(window.getByTestId('stuck-tired')).toBeHidden();
  await expect(window.getByTestId('focus-stuck')).toBeFocused();

  // "Tired" is answered with a rest, and with the learner's own words in the second person — not the
  // first-person label of the button that was pressed.
  await window.getByTestId('focus-stuck').click();
  await window.getByTestId('stuck-tired').click();
  await expect(window.getByTestId('stuck-tired')).toBeHidden();

  /*
   * Answering destroys the button that was pressed, so the focus has to land somewhere here too. Without
   * this the keyboard is on the body, and the learner who needs the suggestion is the one who has to tab
   * past the whole page to reach "Show me".
   */
  await expect(window.getByTestId('focus-stuck')).toBeFocused();

  const agent = window.locator('.agent');
  await expect(agent).toBeVisible();
  await expect(agent).toHaveAttribute('data-action', 'BREAK');
  await expect(agent).toContainText('You said you had not got the energy for it.');
  await expect(agent).not.toContainText("I haven't got the energy for it");

  // Accepting a BREAK reveals its bounded local plan and pauses the live focus timer.
  const timer = window.locator('.focus-clock__value');
  const beforeBreak = await timer.innerText();
  await expect(timer).not.toHaveText(beforeBreak, { timeout: 2_000 });
  await window.getByTestId('notice-break').click();
  const activeRescue = window.getByTestId('agent-accepted');
  await expect(activeRescue).toBeVisible();
  await expect(activeRescue.locator('.agent__plan li')).toHaveCount(2);
  await expect(window.locator('.focus-workspace')).toHaveAttribute('data-phase', 'paused');
  const duringBreak = await timer.innerText();
  await new Promise((resolveWait) => setTimeout(resolveWait, 1_100));
  await expect(timer).toHaveText(duringBreak);
  await activeRescue.getByRole('button', { name: 'Continue' }).click();
  await expect(activeRescue).toBeHidden();
  await expect(window.locator('.focus-workspace')).toHaveAttribute('data-phase', 'active');

  // A different kind of stuck is answered differently, which is the premise of asking at all.
  await window.getByTestId('focus-stuck').click();
  await window.getByTestId('stuck-do-not-understand').click();
  await expect(agent).toBeVisible();
  await expect(agent).toHaveAttribute('data-action', 'EXAMPLE');
  await expect(agent).toContainText('You said reading it was not making sense.');

  // The other accepted route uses the same offered → plan → continue lifecycle.
  await agent.getByRole('button', { name: 'Try this' }).click();
  await expect(window.getByTestId('agent-accepted').locator('.agent__plan li')).toHaveCount(2);
  await window.getByTestId('agent-accepted').getByRole('button', { name: 'Continue' }).click();
  await expect(agent).toBeHidden();

  await expect(window.locator('.banner--error')).toHaveCount(0);

  // The chooser does not come back on its own: it was answered, and the answer is a thing that has
  // happened rather than a mode the control stays in.
  await expect(window.getByTestId('stuck-tired')).toBeHidden();
  await expect(window.getByTestId('focus-stuck')).toBeVisible();

  /*
   * And it does not outlive the step it is about. The chooser is drawn inside the running-task branch
   * with the step's own controls, so leaving it open across a task change used to put the question on
   * screen over the *next* step — with the trigger for asking about that step hidden behind it.
   *
   * The assertion is after the next step starts, and not after the button that finishes the current
   * one: finishing a step leaves the running-task branch altogether, so the chooser is unmounted by the
   * phase change there whether or not anything closed it, and a check made at that point passes for the
   * wrong reason. Starting the next step is where the branch comes back.
   */
  await window.getByTestId('focus-stuck').click();
  await expect(window.getByTestId('stuck-reasons')).toBeVisible();
  await window.getByTestId('complete-task').click();
  await window.getByTestId('start-task').first().click();
  await expect(window.getByTestId('stuck-reasons')).toBeHidden();
  await expect(window.getByTestId('focus-stuck')).toBeVisible();

  // Left as it was found, so a re-run of this file does not start from a session.
  await window.getByTestId('end-session').click();
  await expect(window.getByRole('heading', { name: 'No session running' })).toBeVisible();
});

/*
 * MICRO_START is the one action that changes the task rather than adding words to it (#171), and the
 * change is worth nothing unless it reaches the card the learner is reading: the assertion is on the
 * rendered task, not on the engine that computed it.
 */
test('accepting MICRO_START narrows the task to its first step, for two minutes', async () => {
  await clickSidebarLink('Home');
  await window.getByTestId('course-card').first().getByTestId('start-session').click();
  await window.getByTestId('start-task').first().click();

  const title = await window.getByTestId('task-title').innerText();
  const instructions = window.locator('.focus-task__instructions');
  const wholeTask = await instructions.innerText();
  expect(wholeTask.length).toBeGreaterThan(0);

  await window.getByTestId('focus-stuck').click();
  await window.getByTestId('stuck-cannot-start').click();
  await expect(window.locator('.agent')).toHaveAttribute('data-action', 'MICRO_START');
  await window.getByTestId('notice-continue').click();
  await expect(window.getByTestId('agent-accepted')).toBeVisible();

  // The same task, presented as the one step its own concept starts with — and its own two minutes.
  await expect(window.getByTestId('task-title')).toHaveText(title);
  await expect(instructions).toHaveText('in-order traversal is sorted');
  await expect(instructions).not.toHaveText(wholeTask);
  await expect(window.locator('.focus-task__meta')).toContainText('about 2 min');

  // The step is what the learner finishes, so the task after it must be its own self again.
  await window.getByTestId('complete-task').click();
  await window.getByTestId('start-task').first().click();
  await expect(instructions).not.toHaveText('in-order traversal is sorted');

  await window.getByTestId('end-session').click();
  await expect(window.getByRole('heading', { name: 'No session running' })).toBeVisible();
});

test('the tutor asks the main process, and says so when no model is connected', async () => {
  // The previous test leaves the app on the focus screen with no session — "No session running" and no
  // course list — so the session has to be started from the home screen, as the other tests do.
  await clickSidebarLink('Home');
  await window.getByTestId('course-card').first().getByTestId('start-session').click();
  await window.getByTestId('start-task').first().click();

  // Read off the screen rather than written here: the assertion below is that the fallback names the step
  // the question was about, and a title typed into the test would be a second copy of the demo course.
  const stepTitle = (await window.getByTestId('task-title').innerText()).trim();

  await window.getByTestId('tutor-entry').click();
  await expect(window.getByTestId('tutor-panel')).toBeVisible();

  /*
   * The panel stays inside the window, and it opens on the side where it fits. That is the whole of the fix
   * — it used to be pinned below, where this control sits near the bottom edge, so it hung off the window
   * with its question box half outside — and until this line nothing checked it: the placement was measured,
   * applied as a class, and never read back, so the suite passed whether the component measured the right
   * element, the wrong one, or never measured at all.
   *
   * Which side is expected is derived from the geometry measured here, not written into the test. Writing
   * `'above'` is what this test did first, and the Windows runner answered `'below'`: the panel's height
   * follows the length of its text, the two runners lay that text out at different sizes, and the side
   * flips with it. An assertion that only holds on the machine it was written on tests that machine.
   */
  const panel = window.getByTestId('tutor-panel');
  const panelBox = await panel.boundingBox();
  const anchorBox = await window.getByTestId('tutor-entry').boundingBox();
  /*
   * Asked of the page rather than the test: an Electron window has no viewport for `viewportSize()` to
   * report, and it returns null there. `globalThis` rather than `window` because this file's Playwright
   * page is called `window` and shadows the DOM global inside this callback — which the typecheck caught
   * after the runtime did not, since Playwright runs these files without checking them.
   */
  const viewportHeight = await window.evaluate(() => globalThis.innerHeight);
  if (panelBox === null || anchorBox === null) {
    throw new Error('the panel and the control it hangs from must both be laid out');
  }

  // Inside the window: the property a learner notices, and the one the pinned-below panel broke.
  expect(panelBox.y, 'the panel starts inside the window').toBeGreaterThanOrEqual(0);
  expect(panelBox.y + panelBox.height, 'the panel ends inside the window').toBeLessThanOrEqual(
    viewportHeight + 1,
  );

  // Beside its control, not over it: a panel overlapping the control it belongs to would mean the component
  // measured something that is not the control.
  const placement = await panel.getAttribute('data-placement');
  if (placement === 'above') {
    expect(panelBox.y + panelBox.height, 'an above panel ends at its control').toBeLessThanOrEqual(
      anchorBox.y + 1,
    );
  } else {
    expect(placement, 'below is the only other side').toBe('below');
    expect(panelBox.y, 'a below panel starts at its control').toBeGreaterThanOrEqual(
      anchorBox.y + anchorBox.height - 1,
    );
  }

  /*
   * And the side the geometry asked for. The stylesheet's gap between panel and control is the only number
   * restated here; the branches are the rule's two unambiguous halves, and the cramped tie-break — neither
   * side fits — is posed directly in `panel-placement.spec.ts`, which needs no window. Exactly one branch
   * runs: the panel is never short enough for both sides.
   */
  const gap = 8;
  const roomBelow = viewportHeight - (anchorBox.y + anchorBox.height) - gap;
  const roomAbove = anchorBox.y - gap;
  if (roomBelow >= panelBox.height) {
    expect(placement, 'a panel with room below opens below').toBe('below');
  } else if (roomAbove >= panelBox.height) {
    expect(placement, 'a panel without room below opens above').toBe('above');
  }

  /*
   * Ask is disabled until a mode is chosen *and* something is written. The engine refuses an empty question
   * with `no-question` and a sentence, which is right for a caller that sends one — and the wrong thing to
   * let a learner do, because a button that can only ever produce a refusal should not be pressable.
   */
  await expect(window.getByTestId('tutor-ask')).toBeDisabled();
  await window.getByTestId('tutor-mode-HINT').click();
  await expect(window.getByTestId('tutor-ask')).toBeDisabled();
  await window.getByTestId('tutor-question').fill('why does the colour change?');
  await expect(window.getByTestId('tutor-ask')).toBeEnabled();

  await window.getByTestId('tutor-ask').click();

  /*
   * This build has no model, so the whole chain really runs and ends in the fallback: the renderer sent
   * the question and nothing else, the engine built a prompt, refused to call the offline provider rather
   * than paying for two calls and getting no answer, and returned `no-model` with a sentence and the step
   * the question was about.
   */
  const result = window.getByTestId('tutor-result');
  await expect(result).toBeVisible();
  await expect(result).toContainText('No answer this time');
  await expect(result).toContainText('No model is connected');
  await expect(result).toContainText(stepTitle);

  // A fallback is not a dead end: the step it was asked about is still on the screen behind it.
  await expect(window.getByTestId('task-title')).toBeVisible();
  await expect(window.locator('.banner--error')).toHaveCount(0);

  /*
   * Outbound Request Inspector (the second view, #112). This build is offline, so the engine refused
   * to call a provider — nothing left the process, and the Outbound tab must say so rather than
   * re-render the context. Count-equals-string-length is asserted in engine.spec, where a scripted
   * provider actually receives the prompt.
   */
  await window.getByTestId('agent-context-toggle').click();
  await expect(window.getByTestId('agent-context-panel')).toHaveAttribute('open', '');
  await window.getByTestId('inspector-tab-outbound').click();
  await expect(window.getByTestId('outbound-privacy')).toBeVisible();
  await expect(window.getByTestId('outbound-empty')).toContainText('No request has been sent yet');
  await window.getByTestId('inspector-tab-context').click();
  await expect(window.getByTestId('agent-context-state')).toBeVisible();
  await window.getByTestId('agent-context-toggle').click();

  /*
   * Escape closes the panel, from inside it — which is where the binding is and where the learner is when
   * they want it. Both halves are asserted, because the comment on `onEscape` says the key reaches the panel
   * only from within it, and a comment that describes the boundary is only worth writing if something fails
   * when the boundary moves: the second press is made with focus on the page, and the panel stays up.
   *
   * What is *not* asserted here is the plan card behind the panel, because the plan is drawn over the button
   * that opens the panel and the panel is drawn over the plan's toggle: the two cannot both be open through
   * clicks, so "Escape did not close the plan as well" has no state to be asserted in. The handler still
   * stops the event for the case where they could.
   */
  await window.getByTestId('tutor-question').press('Escape');
  await expect(window.getByTestId('tutor-panel')).toBeHidden();
  await window.getByTestId('tutor-entry').click();
  await expect(window.getByTestId('tutor-panel')).toBeVisible();
  /*
   * Focus is moved off the panel without pressing anything on the page. The panel opens above the control
   * row once there is no room below it, and what it then sits over is the step's own title — so a click
   * aimed at that title tests the layout rather than the thing being asserted, which is where focus is.
   */
  await window.getByTestId('tutor-question').evaluate((element) => element.blur());
  await window.keyboard.press('Escape');
  await expect(window.getByTestId('tutor-panel')).toBeVisible();

  // Closed again before the plan is opened: the panel covers the plan's toggle, so the click that opens the
  // plan has to happen while the panel is down.
  await window.getByTestId('tutor-close').click();
  await expect(window.getByTestId('tutor-panel')).toBeHidden();
  await window.getByTestId('focus-plan-toggle').click();
  await expect(window.getByTestId('plan-remaining')).toBeVisible();
  await window.getByTestId('focus-plan-toggle').click();

  // Re-opening on the same step shows the same answer: it is about *this* step, so it is still true.
  await window.getByTestId('tutor-entry').click();
  await expect(window.getByTestId('tutor-result')).toBeVisible();

  /*
   * And it does not outlive the step it is about. The panel is destroyed and re-created when the step
   * changes, so this is not about the component's own state — it is about the answer the *service* is
   * holding, which used to be cleared only when the whole session ended. The check is after the next step
   * starts, because finishing one leaves the running-task branch altogether.
   */
  await window.getByTestId('tutor-close').click();
  await window.getByTestId('complete-task').click();
  await window.getByTestId('start-task').first().click();
  await window.getByTestId('tutor-entry').click();
  await expect(window.getByTestId('tutor-panel')).toBeVisible();
  await expect(window.getByTestId('tutor-result')).toBeHidden();

  await window.getByTestId('tutor-close').click();
  await expect(window.getByTestId('tutor-panel')).toBeHidden();
  await expect(window.getByTestId('tutor-entry')).toBeVisible();

  await window.getByTestId('end-session').click();
  await expect(window.getByRole('heading', { name: 'No session running' })).toBeVisible();
});

test('an active focus commitment survives leaving and returning to the route', async () => {
  await clickSidebarLink('Home');
  await window.getByTestId('course-card').first().getByTestId('start-session').click();
  await window.getByTestId('start-task').first().click();

  // Leaving the lazy focus component must not reset the renderer-local commitment.
  await clickSidebarLink('Home');
  await clickSidebarLink('Focus Session');

  await expect(window.getByRole('button', { name: 'Pause' })).toBeVisible();
  const value = window.locator('.focus-clock__value');
  const afterReturn = await value.innerText();
  await expect.poll(() => value.innerText(), { timeout: 5_000 }).not.toBe(afterReturn);
  await window.getByTestId('end-session').click();
  await expect(window.getByRole('heading', { name: 'No session running' })).toBeVisible();
});
