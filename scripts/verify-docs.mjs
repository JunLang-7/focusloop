#!/usr/bin/env node
/**
 * Documentation drift gate.
 *
 * The documentation is checked only where a machine can decide the answer, and only inside code
 * spans, because that is where the documentation makes promises about the repository:
 *
 *   - `pnpm <script>` must be a script the root `package.json` defines.
 *   - `pnpm --filter <package> run <script>` must name a package that exists and a script that
 *     package defines.
 *   - `@focusloop/<name>` must be a package in the workspace.
 *   - `node <path>` must be a file that exists.
 *   - a relative link to another Markdown file must resolve.
 *
 * Prose is deliberately out of scope: a sentence that mentions `pnpm` and then an English word is
 * not a command, and a checker that reports those is a checker people turn off.
 *
 * Exit code 1 means a document describes something that is not there.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

/** pnpm's own verbs, which are not workspace scripts. */
const PNPM_VERBS = new Set([
  'add',
  'approve-builds',
  'audit',
  'bin',
  'config',
  'create',
  'dedupe',
  'deploy',
  'dlx',
  'doctor',
  'env',
  'exec',
  'fetch',
  'import',
  'init',
  'install',
  'licenses',
  'link',
  'list',
  'ls',
  'outdated',
  'pack',
  'patch',
  'prune',
  'publish',
  'rebuild',
  'remove',
  'root',
  'run',
  'self-update',
  'setup',
  'store',
  'unlink',
  'update',
  'why',
]);

/** A reference holding `<`, `>`, `{` or `}` is an illustration, not a claim about this repository. */
const ILLUSTRATION = /[<>{}$*]/;

const readJson = (path) => {
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (error) {
    console.error(`Documentation drift: cannot read ${path}: ${String(error)}`);
    process.exit(1);
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    console.error(`Documentation drift: ${path} is not valid JSON: ${String(error)}`);
    process.exit(1);
  }
};

function workspacePackages() {
  const map = new Map();
  const manifests = [join(root, 'package.json')];
  for (const group of ['apps', 'packages']) {
    const directory = join(root, group);
    if (!existsSync(directory)) continue;
    for (const entry of readdirSync(directory)) {
      const manifest = join(directory, entry, 'package.json');
      if (existsSync(manifest)) manifests.push(manifest);
    }
  }
  for (const manifest of manifests) {
    const parsed = readJson(manifest);
    map.set(parsed.name, { scripts: new Set(Object.keys(parsed.scripts ?? {})), path: manifest });
  }
  return map;
}

function markdownFiles() {
  const files = ['README.md', 'CONTRIBUTING.md', 'CHANGELOG.md'].map((name) => join(root, name));
  const docs = join(root, 'docs');
  if (existsSync(docs)) {
    for (const entry of readdirSync(docs)) {
      const path = join(docs, entry);
      if (entry.endsWith('.md') && statSync(path).isFile()) files.push(path);
    }
  }
  for (const entry of readdirSync(join(root, '.github'))) {
    const path = join(root, '.github', entry);
    if (entry.endsWith('.md') && statSync(path).isFile()) files.push(path);
  }
  return files.filter((path) => existsSync(path));
}

/**
 * The lines a checker may look at: fenced blocks and inline spans. A trailing `#` comment is
 * stripped, because a comment describes the command rather than extending it.
 */
function codeRegions(text) {
  const regions = [];
  let inFence = false;
  text.split('\n').forEach((raw, index) => {
    if (/^\s*```/.test(raw)) {
      inFence = !inFence;
      return;
    }
    if (inFence) {
      const code = raw.split('#')[0];
      if (code.trim() !== '') regions.push({ line: index + 1, code });
      return;
    }
    for (const match of raw.matchAll(/`([^`]+)`/g)) {
      regions.push({ line: index + 1, code: match[1] });
    }
  });
  return regions;
}

const packages = workspacePackages();
const rootScripts = packages.get(readJson(join(root, 'package.json')).name).scripts;
const findings = [];

const report = (file, line, message) => findings.push({ file, line, message });

/**
 * A command only counts when it starts a line (or follows a shell prompt). Some fenced blocks are
 * prose — a technology list, for instance — and `Electron · pnpm · Nx` is not an invocation.
 */
function startsCommand(code, position) {
  const before = code.slice(0, position);
  return /^(?:\s|\$|>)*$/.test(before);
}

function checkPnpm(file, line, code) {
  const invocation = /\bpnpm\s+((?:--filter\s+\S+\s+)?)(?:run\s+)?([^\s#]+)/.exec(code);
  if (invocation === null || !startsCommand(code, invocation.index)) return;

  const filter = /--filter\s+(\S+)/.exec(invocation[1])?.[1];
  const command = invocation[2];
  if (command === undefined || ILLUSTRATION.test(command)) return;
  if (filter !== undefined && ILLUSTRATION.test(filter)) return;

  if (filter === undefined) {
    // `pnpm install/lint/test/build` lists several scripts; each part has to be one.
    for (const part of command.split(/[/,]/)) {
      if (part === '' || PNPM_VERBS.has(part) || ILLUSTRATION.test(part)) continue;
      if (!rootScripts.has(part)) {
        report(file, line, `\`pnpm ${part}\` is not a script in package.json`);
      }
    }
    return;
  }

  const target = packages.get(filter);
  if (target === undefined) {
    report(file, line, `\`${filter}\` is not a package in the workspace`);
    return;
  }
  if (!PNPM_VERBS.has(command) && !target.scripts.has(command)) {
    report(
      file,
      line,
      `\`pnpm --filter ${filter} run ${command}\`: no \`${command}\` script there`,
    );
  }
}

function checkNodeCommand(file, line, code, base) {
  for (const match of code.matchAll(/\bnode\s+(\S+\.m?js)/g)) {
    const script = match[1];
    if (ILLUSTRATION.test(script) || !startsCommand(code, match.index)) continue;
    // Documentation names script paths from the repository root, whichever directory it lives in.
    if (!existsSync(resolve(root, script)) && !existsSync(resolve(base, script))) {
      report(file, line, `\`node ${script}\`: no such file`);
    }
  }
}

function checkPackages(file, line, code) {
  for (const match of code.matchAll(/@focusloop\/[a-z0-9-]+/g)) {
    // A `--filter` argument is the pnpm check's business; reporting it twice reads like a bug.
    if (/--filter\s+$/.test(code.slice(0, match.index))) continue;
    if (!packages.has(match[0])) {
      report(file, line, `\`${match[0]}\` is not a package in the workspace`);
    }
  }
}

function checkLinks(file) {
  const base = dirname(file);
  const text = readFileSync(file, 'utf8');
  text.split('\n').forEach((line, index) => {
    for (const match of line.matchAll(/\]\((\.[^)\s]+\.md)(#[^)\s]*)?\)/g)) {
      const target = resolve(base, match[1]);
      if (!existsSync(target)) {
        report(relative(root, file), index + 1, `link target does not exist: ${match[1]}`);
      }
    }
  });
}

const files = markdownFiles();
for (const file of files) {
  const relativePath = relative(root, file).split(sep).join('/');
  const base = dirname(file);
  for (const region of codeRegions(readFileSync(file, 'utf8'))) {
    checkPnpm(relativePath, region.line, region.code);
    checkNodeCommand(relativePath, region.line, region.code, base);
    checkPackages(relativePath, region.line, region.code);
  }
  checkLinks(file);
}

if (findings.length === 0) {
  // Written to stdout rather than with a console.log call: the release hygiene gate treats that
  // call as a debug leftover in a committed file.
  process.stdout.write(`Documentation drift: clean (${files.length} documents).\n`);
  process.exit(0);
}

console.error(`Documentation drift: ${findings.length} problem(s) found.\n`);
for (const finding of findings) {
  console.error(`  ${finding.file}:${finding.line}  ${finding.message}`);
}
console.error('\nFix the document, or the thing it describes.');
process.exit(1);
