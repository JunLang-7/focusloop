import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';
import { hermeticEnv } from '../hermetic-env.mjs';
import { closeElectronApp } from '../support/close-electron-app';

const MAIN = resolve(__dirname, '..', '..', 'desktop', 'dist', 'main', 'main.cjs');

/**
 * The half of the loop that answers back: what the learner produces, and whether it was right.
 *
 * Before this there was nothing to produce. A step was marked done by pressing a button, the quiz
 * events the state machine listens for had no producer inside the app at all once the simulator bar
 * was removed, and nothing a learner wrote ever reached a model — so "did they finish it" and "did
 * they understand it" were the same record. The suite is where that is pinned, because the wiring
 * spans four processes: the textarea, the IPC boundary, the engine's grading and the event log.
 *
 * Its own launch, like `model-settings.spec.ts`: the assertions below are about a session's first
 * steps, and a shared app would make them depend on every test that ran before.
 */
test('a step records what the learner wrote, and answers a quiz it asks', async () => {
  const profile = mkdtempSync(join(tmpdir(), 'focusloop-step-answer-'));
  const launched: ElectronApplication[] = [];

  try {
    const app = await electron.launch({
      args: [MAIN, `--user-data-dir=${profile}`],
      env: hermeticEnv(),
    });
    launched.push(app);
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await page.setViewportSize({ width: 1280, height: 900 });

    // The demo course, in the language a fresh profile starts in.
    await page.getByTestId('course-card').first().getByTestId('start-session').click();
    await page.getByTestId('start-task').first().click();

    /*
     * 1. A read step asks for the learner's own words, and hands them to the tutor.
     *
     * The box is the whole point: without it the completion carries a task id and nothing else, which
     * is what the checkpoint's "mastered" list and every prompt the agent builds were resting on.
     */
    const box = page.getByTestId('step-answer-input');
    await expect(box).toBeVisible();
    await expect(page.getByTestId('answer-check')).toBeDisabled();
    await expect(page.getByTestId('quiz-question')).toHaveCount(0);

    /*
     * Beside it, the way in for words the learner already has somewhere else. Only that it is there and
     * pressable: pressing it opens the operating system's file dialog, which a test cannot drive — the
     * reading behind it is proven through the channel below and in `electron/answer-source.spec.ts`.
     */
    await expect(page.getByTestId('answer-attach')).toBeVisible();
    await expect(page.getByTestId('answer-attach')).toBeEnabled();
    await expect(page.getByTestId('answer-source-note')).toHaveCount(0);

    await box.fill('Every left descendant is smaller, every right one larger.');
    await expect(page.getByTestId('answer-check')).toBeEnabled();

    /*
     * The tutor is asked about *this* text, in the mode that quotes the learner back at themselves —
     * filled in and opened, not sent: a model call nobody pressed for would spend a request on words
     * the learner can no longer correct.
     */
    await page.getByTestId('answer-check').click();
    await expect(page.getByTestId('tutor-panel')).toBeVisible();
    await expect(page.getByTestId('tutor-mode-CHECK_MY_ANSWER')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.getByTestId('tutor-question')).toHaveValue(
      'Every left descendant is smaller, every right one larger.',
    );
    await page.getByTestId('tutor-close').click();
    await expect(page.getByTestId('tutor-panel')).toBeHidden();

    // 2. And the answer travels with the completion, all the way into the event log.
    await page.getByTestId('complete-task').click();
    const completed = await latestEvent(page, 'TASK_COMPLETED');
    expect(completed.payload).toEqual({
      taskId: 'rbt-t1',
      answer: 'Every left descendant is smaller, every right one larger.',
    });

    /*
     * 3. The quiz step. Reached through the plan rather than by finishing three steps first, so this
     * test stays about the quiz.
     */
    await page.getByTestId('focus-plan-toggle').click();
    await page
      .getByTestId('plan-block')
      .filter({ hasText: 'Check the colour invariant' })
      .getByTestId('start-task')
      .click();

    await expect(page.getByTestId('quiz-question')).toHaveText('Can a red node have a red child?');
    await expect(page.getByTestId('step-answer-input')).toHaveCount(0);
    // Nothing chosen yet, so there is nothing to check.
    await expect(page.getByTestId('quiz-check')).toBeDisabled();

    /*
     * The wrong option first, which is the case the screen has to be honest about: it says so, marks
     * the option that was right, and explains. The grading is the main process's — the screen sends an
     * index and is told the verdict, so the key to the answer is never what decides it.
     */
    await page.getByTestId('quiz-option-0').click();
    await expect(page.getByTestId('quiz-check')).toBeEnabled();
    await page.getByTestId('quiz-check').click();
    await expect(page.getByTestId('quiz-verdict')).toHaveAttribute('data-correct', 'false');
    await expect(page.getByTestId('quiz-option-1')).toHaveAttribute('data-mark', 'right');
    await expect(page.getByTestId('quiz-option-0')).toHaveAttribute('data-mark', 'wrong');
    await expect(page.getByTestId('quiz-explanation')).toContainText(
      'The red-red rule is one of the five invariants',
    );

    // Then the right one: the verdict follows the answer on screen, not the last one given.
    await page.getByTestId('quiz-option-1').click();
    await expect(page.getByTestId('quiz-verdict')).toHaveCount(0);
    await page.getByTestId('quiz-check').click();
    await expect(page.getByTestId('quiz-verdict')).toHaveAttribute('data-correct', 'true');
    await expect(page.getByTestId('quiz-option-1')).toHaveAttribute('data-mark', 'right');

    /*
     * 4. Both answers are in the log, in the order they were given.
     *
     * This is the record everything else reads: the state machine's CONFUSED branch (two wrong answers
     * in a row), the dashboard's "progressed" count, and the events an agent is shown. A verdict that
     * only reached the screen would leave all three with nothing to go on.
     */
    expect((await allEvents(page, 'QUIZ_INCORRECT')).length).toBe(1);
    expect((await allEvents(page, 'QUIZ_CORRECT')).length).toBe(1);

    /*
     * 5. And an answer can arrive as a file instead of as typing.
     *
     * The claim is that the window can hand the main process a path and get text back. Each of the three
     * readers that load a library is exercised here rather than only in the unit spec, because the main
     * process is a bundle and the library is `require`d from `node_modules` beside it at runtime: that
     * resolution, and the OCR engine's worker under Electron, is something only the running app can show.
     *
     * The picker itself is not exercised: it is a native dialog, and the operating system's file picker is
     * not something a test can click through. That is why the path-taking channel exists and why this goes
     * through it.
     */
    const readFrom = async (path: string) =>
      page.evaluate(
        async (target) => globalThis.focusloop.extractAnswerSource({ path: target }),
        path,
      );

    const written = join(profile, 'answer.txt');
    writeFileSync(written, 'The invariant is that every path has the same black height.\n', 'utf8');
    const read = await readFrom(written);
    expect(read.refusal).toBeNull();
    expect(read.source).toMatchObject({
      name: 'answer.txt',
      method: 'text',
      text: 'The invariant is that every path has the same black height.',
    });

    const fixtures = resolve(__dirname, '..', '..', 'desktop', 'electron', 'fixtures');
    const pdf = await readFrom(join(fixtures, 'notes.pdf'));
    expect(pdf.source?.method).toBe('pdf');
    expect(pdf.source?.text).toContain('FocusLoop reads this PDF sentence.');

    const docx = await readFrom(join(fixtures, 'notes.docx'));
    expect(docx.source?.method).toBe('docx');
    expect(docx.source?.text).toContain('FocusLoop docx fixture sentence.');

    const image = await readFrom(join(fixtures, 'whiteboard.png'));
    expect(image.source?.method).toBe('ocr');
    expect(image.source?.text.toLowerCase()).toContain('focusloop');

    const unsupported = join(profile, 'answer.xlsx');
    writeFileSync(unsupported, 'not a document this reads', 'utf8');
    const refused = await readFrom(unsupported);
    expect(refused.source).toBeNull();
    expect(refused.refusal).toEqual({ reason: 'unsupported', name: 'answer.xlsx' });

    await expect(page.locator('.banner--error')).toHaveCount(0);
  } finally {
    for (const app of launched) {
      await closeElectronApp(app);
    }
    rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
  }
});

/** The session's whole event log, read through the bridge the renderer uses. */
async function sessionEvents(page: {
  evaluate: <T>(fn: () => Promise<T>) => Promise<T>;
}): Promise<readonly { readonly type: string; readonly payload: Record<string, unknown> }[]> {
  return page.evaluate(async () => {
    const snapshot = await globalThis.focusloop.getCurrentSession();
    if (snapshot === null) return [];
    return globalThis.focusloop.listEvents(snapshot.session.id);
  });
}

async function allEvents(page: Parameters<typeof sessionEvents>[0], type: string) {
  const events = await sessionEvents(page);
  return events.filter((event) => event.type === type);
}

async function latestEvent(page: Parameters<typeof sessionEvents>[0], type: string) {
  const events = await allEvents(page, type);
  const last = events[events.length - 1];
  if (last === undefined) throw new Error(`no ${type} in the session log`);
  return last;
}
