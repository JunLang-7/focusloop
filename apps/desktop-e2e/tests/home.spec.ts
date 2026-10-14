import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';
import { hermeticEnv } from '../hermetic-env.mjs';
import { closeElectronApp } from '../support/close-electron-app';

const MAIN = resolve(__dirname, '..', '..', 'desktop', 'dist', 'main', 'main.cjs');
const MB = 1_048_576;

/**
 * The home page as a page: the three things it is for, and every way each of them can go wrong.
 *
 * The golden path reaches this screen only where the loop needs it — a course to start, a file to
 * import — so what was never covered is the page itself: the current-session card and its way back
 * into a session, the getting-started block that stands in for it, what a course card offers, and
 * the four ways the import form refuses a file. Those are the interactive surface a learner meets
 * first, and the refusals are the part of it that is easy to get wrong quietly: a form that takes a
 * name it cannot read, or that reads a file it then throws away, looks like a working form.
 *
 * Its own launch, like `step-answer.spec.ts`: the sections below tell one story — nothing running,
 * then a session, then imports while it runs — and a shared app would make every one of them depend
 * on the tests that ran before.
 */
test('the home page starts a session, browses courses, and takes material in', async () => {
  test.setTimeout(300_000);
  const profile = mkdtempSync(join(tmpdir(), 'focusloop-home-'));
  const launched: ElectronApplication[] = [];

  try {
    const app = await electron.launch({
      args: [MAIN, `--user-data-dir=${profile}`],
      env: hermeticEnv(),
    });
    launched.push(app);
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await page.setViewportSize({ width: 1280, height: 1000 });

    /** Back to the page under test, and only once it has rendered: every section starts from here. */
    const openHome = async (): Promise<void> => {
      await page.evaluate(() => {
        location.hash = '#/home';
      });
      await expect(
        page.getByRole('heading', { name: 'Keep your learning continuous' }),
      ).toBeVisible();
    };
    const cards = page.locator('[data-testid=course-card]');
    const cardTitle = async (index: number): Promise<string> =>
      (await cards.nth(index).locator('h3').innerText()).trim();
    /**
     * What the import that was just sent reported, polled rather than read once.
     *
     * `import-summary` is one element every import fills in, so a read straight after the click can
     * land on the previous import's answer: the macOS runner read the second hand-typed import as the
     * first one's "typed notes: 0 concepts, 0 micro tasks", and the same read taken 400ms early
     * reproduces it here. Polling for the words the new import produces is what binds the assertion to
     * the press it belongs to — no earlier import can have produced them.
     */
    const importAnswer = async (pattern: RegExp): Promise<void> => {
      await expect
        .poll(
          async () => {
            const summary = page.getByTestId('import-summary');
            return (await summary.count()) === 0 ? '' : (await summary.innerText()).trim();
          },
          { timeout: 10_000 },
        )
        .toMatch(pattern);
    };
    const currentCard = page.locator('.card--accent');
    const banner = page.locator('.banner--error');
    const notice = page.getByTestId('import-pick-notice');
    const name = page.getByTestId('import-file-name');
    const submit = page.getByTestId('import-submit');
    const zone = page.getByTestId('import-dropzone');
    const text = page.locator('.paste-fallback textarea');
    const dragOf = (fileName: string, content: string) =>
      page.evaluateHandle(
        ([file, body]) => {
          const transfer = new DataTransfer();
          transfer.items.add(new File([body ?? ''], file ?? '', { type: 'text/plain' }));
          return transfer;
        },
        [fileName, content] as const,
      );

    await openHome();

    // ------------------------------------------------------- nothing running yet
    /*
     * With no session, the page has to say what to do instead of showing an empty current-session
     * card. Both halves matter: the block that explains the three steps, and the absence of a card
     * claiming a session that does not exist — a card reading "0 / 0 micro tasks" would be the page
     * inventing one.
     */
    await expect(page.getByTestId('getting-started')).toBeVisible();
    await expect(page.getByText('No session running. Pick a course below to begin.')).toBeVisible();
    await expect(currentCard).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Continue session' })).toHaveCount(0);

    const courseCount = await cards.count();
    expect(courseCount).toBeGreaterThan(0);
    for (let index = 0; index < courseCount; index += 1) {
      const card = cards.nth(index);
      expect((await card.locator('h3').innerText()).trim().length).toBeGreaterThan(0);
      // `innerText` and a trim rather than `toHaveText`: the pattern is anchored, and the element
      // carries the template's own indentation around its text.
      expect((await card.locator('p.muted.small').nth(1).innerText()).trim()).toMatch(
        /^\d+ concepts? · \d+ micro tasks?$/,
      );
      await expect(card.getByRole('button', { name: 'View course' })).toBeVisible();
      await expect(card.getByRole('button', { name: 'Start session' })).toBeVisible();
    }

    // 1. A card's first offer is the course itself, which is not the same thing as starting it.
    const firstTitle = await cardTitle(0);
    await cards.nth(0).getByRole('button', { name: 'View course' }).click();
    /*
     * Polled, not read once: the router moves the hash a tick after the click, and the assertion
     * below cannot stand in for that wait — the card's own `h3` carries the same title, so it is
     * already visible on the page the click is leaving. Read once, this raced and failed with the
     * URL still on `#/home`.
     */
    await expect.poll(() => page.url()).toContain('#/course/');
    await expect(page.getByRole('heading', { name: firstTitle })).toBeVisible();

    // 2. And its second starts a session: the focus screen, with a step already in front of the
    // learner rather than a screen waiting to be configured.
    await openHome();
    await cards.nth(0).getByRole('button', { name: 'Start session' }).click();
    await expect(page.getByTestId('end-session')).toBeVisible({ timeout: 10_000 });
    expect(page.url()).toContain('#/focus');
    expect((await page.getByTestId('task-title').innerText()).trim().length).toBeGreaterThan(0);

    // 3. Which is what turns the top of the home page into the way back into that session: the
    // course it belongs to, its progress, and one button that lands on the same screen.
    await openHome();
    await expect(page.getByTestId('getting-started')).toHaveCount(0);
    await expect(page.getByText('Current session')).toBeVisible();
    await expect(currentCard.locator('h2')).toHaveText(firstTitle);
    await expect(currentCard.locator('p.muted.small').first()).toBeVisible();
    expect((await currentCard.locator('p.muted.small').first().innerText()).trim()).toMatch(
      /^\d+ \/ \d+ micro tasks · .+ · state \S+$/,
    );
    await page.getByRole('button', { name: 'Continue session' }).click();
    await expect(page.getByTestId('end-session')).toBeVisible({ timeout: 5_000 });
    expect(page.url()).toContain('#/focus');

    // --------------------------------------------------------------- importing
    await openHome();
    const runningTitle = (await currentCard.locator('h2').innerText()).trim();
    const beforeImport = await cards.count();

    /*
     * 4. Choosing a file fills the form *from the file*: the name and the text both, so neither has
     * to be typed. The document opens with an H1, which is the one thing that outranks the name —
     * the hint under the field says so, and this is where the two are told apart.
     */
    const chosen = Buffer.from(
      '# Sweep notes\n\nA short document used by this test.\n\n## Second part\n\nContent.\n',
    );
    await page.getByTestId('import-pick-file').setInputFiles({
      name: 'sweep-notes.md',
      mimeType: 'text/markdown',
      buffer: chosen,
    });
    await expect(name).toHaveValue('sweep-notes.md');
    await expect(page.getByTestId('import-picked')).toContainText('sweep-notes.md');
    await expect(page.getByTestId('import-picked')).toContainText('KB');
    await expect(notice).toBeHidden();
    expect(await text.inputValue()).toContain('Sweep notes');

    // 5. And the import goes through, says what it made, and adds the course it made it into.
    await submit.click();
    await importAnswer(/^Sweep notes: \d+ concepts?, \d+ micro tasks?$/);
    await expect(banner).toHaveCount(0);
    await expect.poll(async () => cards.count(), { timeout: 5_000 }).toBe(beforeImport + 1);

    const imported = cards.last();
    await expect(imported.locator('h3')).toHaveText('Sweep notes');
    await expect(imported.getByRole('button', { name: 'View course' })).toBeVisible();
    await expect(imported.getByRole('button', { name: 'Start session' })).toBeVisible();

    // 6. The new course is a course like any other: it opens, with the concepts read out of the text.
    await imported.getByRole('button', { name: 'View course' }).click();
    await expect(page.getByRole('heading', { name: 'Sweep notes' })).toBeVisible({
      timeout: 5_000,
    });
    expect(await page.locator('.concepts li').count()).toBeGreaterThan(0);
    // The tasks the text became, counted here so the progress below is checked against the app's own
    // number rather than against an assumption about how many tasks a concept generates.
    const importedTaskCount = await page.locator('.table tbody tr').count();
    expect(importedTaskCount).toBeGreaterThan(0);

    /*
     * 7. The import did not cost the learner the session it happened during: the card at the top of
     * the page is still the course they were in the middle of.
     */
    await openHome();
    await expect(currentCard.locator('h2')).toHaveText(runningTitle);

    /*
     * 8. And the imported course is one you can work in, which is the question an import has to
     * answer. The material became concepts and micro tasks, the focus screen runs one of them, and
     * finishing it moves the progress the session reports. A course that opens but cannot be studied
     * is an import that only looks like it worked.
     */
    await cards.last().getByTestId('start-session').click();
    await expect(page.getByTestId('end-session')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('task-title')).toHaveText(/./);
    await expect(page.getByTestId('tasks-completed')).toHaveText(`0 / ${importedTaskCount}`);

    await page.getByTestId('start-task').first().click();
    await expect(page.getByTestId('complete-task')).toBeVisible();
    await page.getByTestId('complete-task').click();
    await expect(page.getByTestId('tasks-completed')).toHaveText(`1 / ${importedTaskCount}`);

    // The session that is now running is the imported course's, because starting one is what the
    // last press did and the engine keeps one at a time.
    await openHome();
    await expect(currentCard.locator('h2')).toHaveText('Sweep notes');
    await expect(page.getByRole('button', { name: 'Continue session' })).toBeVisible();

    /*
     * 9. Typing the material in by hand is the other way in, and it names the course after the name
     * typed — which is what the hint promises, and only true while the text has no heading of its
     * own. Both halves of that sentence, in that order.
     */
    const pasted = await cards.count();
    await page.locator('.paste-fallback summary').click();
    await name.fill('typed-notes.md');
    await text.fill('Plain text with no heading at all.\n');
    await submit.click();
    await expect(page.getByTestId('import-summary')).toBeVisible({ timeout: 10_000 });
    await expect.poll(async () => cards.count(), { timeout: 5_000 }).toBe(pasted + 1);
    await expect(cards.last().locator('h3')).toHaveText('typed notes');
    await expect(banner).toHaveCount(0);

    const withHeading = await cards.count();
    await name.fill('pasted-material.md');
    await text.fill('# Pasted\n\nMaterial typed in by hand.\n');
    await submit.click();
    await importAnswer(/^Pasted: \d+ concepts?, \d+ micro tasks?$/);
    await expect.poll(async () => cards.count(), { timeout: 5_000 }).toBe(withHeading + 1);
    await expect(cards.last().locator('h3')).toHaveText('Pasted');

    // ------------------------------------------------------- refused files
    /*
     * 9. Four files that are refused, each in words, each where it was chosen.
     *
     * The refusals are the reason this spec exists. Every one of them used to be a file the form
     * accepted and the app then rejected — or worse, read and turned into nothing — and the last of
     * them arrived as `Error invoking remote method 'focusloop:material:import': MaterialParseError:
     * Cannot determine a supported format for outline.rst.`, which names a channel and an error
     * class. None of the four may leave a trace: the form is the same form afterwards, so a
     * mis-click is not also a loss.
     */
    await name.fill('notes.md');
    await submit.scrollIntoViewIfNeeded();
    await expect(submit).toBeEnabled();

    await page.getByTestId('import-pick-file').setInputFiles({
      name: 'outline.rst',
      mimeType: 'text/plain',
      buffer: Buffer.from('# Outline\n\nSome text.\n'),
    });
    await expect(notice).toHaveText('That file is not a .txt or .md file.');

    await page.getByTestId('import-pick-file').setInputFiles({
      name: 'huge.md',
      mimeType: 'text/markdown',
      buffer: Buffer.alloc(MB + 1, 0x61),
    });
    await expect(notice).toHaveText('That file is over 1 MB.');

    await page.getByTestId('import-pick-file').setInputFiles({
      name: 'nothing.md',
      mimeType: 'text/markdown',
      buffer: Buffer.from(''),
    });
    await expect(notice).toHaveText('That file has nothing in it.');

    // Binary content behind a name the import does accept: the extension check cannot see this, so
    // the NUL byte is still what turns it away.
    await page.getByTestId('import-pick-file').setInputFiles({
      name: 'archive.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x01]),
    });
    await expect(notice).toHaveText('That file is not plain text.');

    // After all four, the form still holds a name and a text it can import, and the refused files
    // are not in the course list.
    await expect(name).toHaveValue('notes.md');
    await expect(page.getByTestId('import-picked')).toBeHidden();
    await expect(submit).toBeEnabled();
    await expect(banner).toHaveCount(0);

    // A file already imported is not imported twice: same text, same content hash, same course — so
    // the second press reports the course it already had rather than counts of its own, which is the
    // answer this press is waited for before the list is counted.
    await page.getByTestId('import-pick-file').setInputFiles({
      name: 'sweep-notes.md',
      mimeType: 'text/markdown',
      buffer: chosen,
    });
    const beforeRepeat = await cards.count();
    await submit.click();
    await importAnswer(/^Sweep notes: 0 concepts, 0 micro tasks$/);
    expect(await cards.count()).toBe(beforeRepeat);

    /*
     * 10. The form's three rules, stated under the button rather than by the main process.
     *
     * A name of nothing but spaces is nothing; a name the parser cannot place — no extension, or one
     * it does not read — is a refusal both the picker and the field have to agree on; and there has
     * to be something to import. Each of the last two used to be a press that failed on the wire:
     * `typed.rst` beside pasted text answered with the channel, and an empty text imported a course
     * with no concepts in it and called it a success.
     */
    const reason = page.getByTestId('import-needs-name');
    await text.fill('Text that is there while the name is checked.\n');

    await name.fill('');
    await expect(submit).toBeDisabled();
    await expect(reason).toHaveText('Give the file a name first.');
    await name.fill('   ');
    await expect(submit).toBeDisabled();

    const beforeUnsupportedName = await cards.count();
    await name.fill('typed.rst');
    await expect(submit).toBeDisabled();
    await expect(reason).toHaveText('Use a .txt or .md name.');
    // Nothing to press, and so nothing to send: no channel error can reach the banner.
    await page.waitForTimeout(500);
    await expect(banner).toHaveCount(0);
    expect(await cards.count()).toBe(beforeUnsupportedName);

    // The third rule is the text, which is also the answer to "what is the paste box for": without a
    // file, this box is where the material comes from.
    await name.fill('notes.md');
    await text.fill('');
    await expect(submit).toBeDisabled();
    await expect(reason).toHaveText('Drop a file, or paste the text first.');

    await text.fill('# Typed\n\nTyped text.\n');
    await expect(submit).toBeEnabled();
    await expect(reason).toBeHidden();

    // -------------------------------------------------------------- the drop zone
    /*
     * 11. The zone itself: a file dragged over it is the same import as a chosen one, and the zone
     * says so before the drop rather than after it. Reachable from the keyboard as well — the input
     * behind the "choose one" half is a real file input, so both halves of the label are true.
     */
    const focusable = await page.getByTestId('import-pick-file').evaluate((element) => {
      (element as HTMLElement).focus();
      return document.activeElement === element && element.getBoundingClientRect().height > 0;
    });
    expect(focusable).toBe(true);

    const dropped = await dragOf('dropped.md', '# Dropped\n\nDropped text.\n');
    await zone.dispatchEvent('dragover', { dataTransfer: dropped });
    await expect(zone).toHaveClass(/is-dragging/);
    await expect(zone).toContainText('Let go to import it');
    // Leaving takes the invitation back: a zone that stays lit is a zone claiming a drop is coming.
    await zone.dispatchEvent('dragleave', { dataTransfer: dropped, relatedTarget: null });
    await expect(zone).not.toHaveClass(/is-dragging/);

    await zone.dispatchEvent('dragover', { dataTransfer: dropped });
    await zone.dispatchEvent('drop', { dataTransfer: dropped });
    await expect(page.getByTestId('import-picked')).toContainText('dropped.md');
    await expect(name).toHaveValue('dropped.md');
    // A refused drop is refused the same way a refused choice is: on the zone, in words.
    const refusedDrop = await dragOf('outline.rst', '# Outline\n\nSome text.\n');
    await zone.dispatchEvent('dragover', { dataTransfer: refusedDrop });
    await zone.dispatchEvent('drop', { dataTransfer: refusedDrop });
    await expect(notice).toHaveText('That file is not a .txt or .md file.');
    await expect(name).toHaveValue('dropped.md');

    /*
     * 12. Starting a session on a second course while the first runs.
     *
     * One session at a time is the engine's rule, and it ends the running one rather than leaving two
     * current — the page has to follow that: the focus screen is where the press lands, and what the
     * home page calls current afterwards is the course that was just started, not the one before it.
     */
    await openHome();
    await cards.nth(1).getByRole('button', { name: 'Start session' }).click();
    await expect(page.getByTestId('end-session')).toBeVisible({ timeout: 10_000 });
    await expect(banner).toHaveCount(0);
    await openHome();
    const secondTitle = await cardTitle(1);
    await expect(page.getByText('Current session')).toBeVisible();
    await expect(currentCard.locator('h2')).toHaveText(secondTitle);
  } finally {
    for (const app of launched) await closeElectronApp(app);
    rmSync(profile, { recursive: true, force: true });
  }
});
