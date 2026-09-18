#!/usr/bin/env node
/**
 * Workflow hygiene gate.
 *
 * The pipeline runs third-party code with the repository's contents, so the workflows are source
 * like any other source and the same three rules apply to every one of them:
 *
 *   1. Every action is pinned to a full commit SHA. A major tag is a moving branch: whoever
 *      controls the action repository can point it somewhere else, and the next run picks that up.
 *      The release the SHA came from belongs in a trailing comment, so a human can read the pin and
 *      Dependabot can move it.
 *   2. Every workflow states its `permissions:`. Inheriting the repository default grants whatever
 *      the default happens to be, which is not a decision anyone made in that file.
 *   3. Every job has a `timeout-minutes:`. Without one, a hung step holds a runner for the
 *      repository-wide maximum, which for the private-repository case bills by the minute.
 *
 * Exit code 1 means a workflow is not shippable.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const workflows = join(root, '.github', 'workflows');

/** `uses: owner/repo@<sha> # vX.Y.Z` — a local action or a docker image is not a pin candidate. */
const USES = /^\s*(?:-\s*)?uses:\s*(\S+)(.*)$/;
const FULL_SHA = /^[^@\s]+@[0-9a-f]{40}$/;
const VERSION_COMMENT = /#\s*v?\d+\.\d+\.\d+/;
const TOP_LEVEL_PERMISSIONS = /^permissions:/;
const JOB_HEADER = /^ {2}([A-Za-z0-9_-]+):\s*$/;
const JOB_TIMEOUT = /^ {4}timeout-minutes:\s*\d+\s*$/;
const LOCAL_OR_DOCKER = /^(\.\/|docker:\/\/)/;

const findings = [];

function report(file, line, message) {
  findings.push({ file, line, message });
}

function checkWorkflow(name) {
  const relativePath = relative(root, name).split(sep).join('/');
  const lines = readFileSync(name, 'utf8').split('\n');

  if (!lines.some((line) => TOP_LEVEL_PERMISSIONS.test(line))) {
    report(relativePath, 1, 'no top-level `permissions:` — state them, even as `contents: read`');
  }

  lines.forEach((line, index) => {
    const match = USES.exec(line);
    if (match === null) return;
    const reference = match[1];
    const rest = match[2] ?? '';
    if (LOCAL_OR_DOCKER.test(reference)) return;
    if (!FULL_SHA.test(reference)) {
      report(
        relativePath,
        index + 1,
        `action is not pinned to a commit SHA: ${reference} ` +
          '(use `owner/repo@<40 hex> # vX.Y.Z`)',
      );
      return;
    }
    if (!VERSION_COMMENT.test(rest)) {
      report(relativePath, index + 1, `pinned action has no release comment: ${reference}`);
    }
  });

  // Jobs: a two-space key inside `jobs:` up to the next one. Only the renderer distinguishes a job
  // from a nested mapping, and a job is the only thing this gate needs to find.
  let inJobs = false;
  let job = null;
  let jobLine = 0;
  let hasTimeout = false;
  const closeJob = () => {
    if (job !== null && !hasTimeout) {
      report(relativePath, jobLine, `job \`${job}\` has no \`timeout-minutes:\``);
    }
  };

  lines.forEach((line, index) => {
    if (/^jobs:\s*$/.test(line)) {
      inJobs = true;
      return;
    }
    if (inJobs && /^\S/.test(line)) {
      // A new top-level key ends the jobs block.
      closeJob();
      inJobs = false;
      job = null;
      return;
    }
    if (!inJobs) return;

    const header = JOB_HEADER.exec(line);
    if (header !== null) {
      closeJob();
      job = header[1];
      jobLine = index + 1;
      hasTimeout = false;
      return;
    }
    if (JOB_TIMEOUT.test(line)) hasTimeout = true;
  });
  closeJob();
}

let files = [];
try {
  files = readdirSync(workflows)
    .filter((entry) => /\.ya?ml$/.test(entry))
    .map((entry) => join(workflows, entry))
    .filter((path) => statSync(path).isFile());
} catch {
  console.error('Workflow hygiene: .github/workflows is missing.');
  process.exit(1);
}

if (files.length === 0) {
  console.error('Workflow hygiene: no workflows found.');
  process.exit(1);
}

for (const file of files) checkWorkflow(file);

if (findings.length === 0) {
  // Written to stdout directly rather than with a console.log call, because the release hygiene
  // gate treats that call as a debug leftover — `scripts/verify-no-scaffolding.mjs` is only exempt
  // because the gate skips its own file.
  process.stdout.write(`Workflow hygiene: clean (${files.length} workflows).\n`);
  process.exit(0);
}

console.error(`Workflow hygiene: ${findings.length} problem(s) found.\n`);
for (const finding of findings) {
  console.error(`  ${finding.file}:${finding.line}  ${finding.message}`);
}
console.error('\nFix these before the pipeline runs again.');
process.exit(1);
