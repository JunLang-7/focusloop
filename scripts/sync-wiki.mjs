#!/usr/bin/env node
/**
 * Publishes `docs/wiki/` into a GitHub Wiki checkout.
 *
 * The repository copy is the single editable source. The GitHub Wiki is generated from it, because
 * two hand-editable copies of the same status page drift — and the drift is invisible until someone
 * quotes the wrong one, which is exactly what happened to this repository: one page grew a section
 * the other never received, and another page only ever existed on the wiki.
 *
 * The mapping is explicit because wiki page names are Title-Case with dashes and ours are not; there
 * is no rule that derives one from the other, and a guess would silently publish to a new page that
 * nobody navigates to.
 *
 * Usage:
 *   git clone https://github.com/<owner>/<repo>.wiki.git ../focusloop-wiki
 *   node scripts/sync-wiki.mjs --target ../focusloop-wiki [--prune] [--repo <url>]
 *
 * `--prune` deletes wiki pages that no longer exist here. It is opt-in: deleting a page somebody
 * wrote by hand is not a decision a formatter should make on its own.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const source = join(root, 'docs', 'wiki');

/** `docs/wiki/<file>` → `<wiki>/<page>`. Order is the sidebar's reading order. */
const PAGES = new Map([
  ['README.md', 'Home.md'],
  ['_sidebar.md', '_Sidebar.md'],
  ['project-features.md', 'Project-Features.md'],
  ['agent-feature-completion-plan.md', 'Agent-Feature-Completion-Plan.md'],
  ['delivery-roadmap.md', 'Delivery-Roadmap.md'],
  ['implementation-progress.md', 'Implementation-Progress.md'],
  ['resume-policy-and-success.md', 'Resume-Policy-and-Success.md'],
  ['adr/0001-agent-memory-deletion.md', 'Adr-0001-Agent-Memory-Deletion.md'],
]);

/**
 * Which repository this is, read from the checkout so a fork publishes links to itself. The wiki
 * cannot resolve `../architecture.md`, so those links must be absolute in the published copy.
 *
 * It asks git as well as opening `.git/config` because of linked worktrees: there `.git` is a
 * *file* holding `gitdir: <path>`, and the remote lives in the common directory that points at,
 * not next to the file — so `existsSync('.git/config')` is false and the remote is unreachable.
 * `--repo` overrides both, for a checkout with no origin at all.
 */
function repositoryUrl() {
  const index = process.argv.indexOf('--repo');
  const explicit = index === -1 ? undefined : process.argv[index + 1];
  const candidates = [explicit];

  const configPath = join(root, '.git', 'config');
  if (existsSync(configPath)) candidates.push(readFileSync(configPath, 'utf8'));

  try {
    candidates.push(
      execFileSync('git', ['-C', root, 'config', '--get', 'remote.origin.url'], {
        encoding: 'utf8',
      }),
    );
  } catch {
    // Not a git checkout, or it has no origin: the candidates above decide.
  }

  for (const candidate of candidates) {
    if (candidate === undefined) continue;
    const match = /github\.com[/:]([^/\s]+)\/([^/\s]+?)(?:\.git)?$/m.exec(candidate);
    if (match !== null) return `https://github.com/${match[1]}/${match[2]}`;
  }

  console.error(
    'Cannot tell which repository this is; pass --repo https://github.com/<owner>/<repo>',
  );
  process.exit(2);
}

/**
 * One pass over every Markdown link, deciding from the **source** text rather than from the residue
 * of a rewrite. A pattern applied to its own output cannot notice what it failed to match, and that
 * is exactly how the first version of this script let a `%20`-encoded path through: the `[\w.-]`
 * class stopped at the `%`, the rewrite matched nothing, and the guard — which ran afterwards — saw a
 * link it considered acceptable. Links must be judged where they were written.
 *
 * Recognised: absolute links, `#anchor`, `./file.md` with an optional `#anchor` and optional
 * `"title"`, and `../path` links into the repository. Anything else relative is a failure, because
 * the wiki is flat and has nowhere to resolve it to.
 */
function publish(text, file, repository) {
  return text.replace(/\]\(([^)\s]+)((?:\s+"[^"]*")?)\)/g, (whole, target, title) => {
    if (/^(#|https?:|mailto:)/.test(target)) return whole;

    if (target.startsWith('../')) {
      return `](${repository}/blob/main/docs/${target.slice(3)}${title})`;
    }

    const [path, anchor] = target.split('#');
    const page = PAGES.get(path.replace(/^\.\//, ''));
    if (page === undefined) {
      console.error(
        `docs/wiki/${file}: ${whole} cannot be published. The wiki is flat, so every relative link ` +
          'must be ./<file in docs/wiki> or ../<file in the repository>.',
      );
      process.exit(1);
    }
    return `](${page.replace(/\.md$/, '')}${anchor === undefined ? '' : `#${anchor}`}${title})`;
  });
}

function resolveTarget() {
  const index = process.argv.indexOf('--target');
  const value = index === -1 ? undefined : process.argv[index + 1];
  if (value === undefined || value === '') {
    console.error('usage: node scripts/sync-wiki.mjs --target <wiki-checkout> [--prune]');
    process.exit(2);
  }
  const out = resolve(value);
  if (!existsSync(join(out, '.git'))) {
    console.error(`Not a git checkout: ${out}`);
    console.error(
      'Clone the wiki first: git clone https://github.com/<owner>/<repo>.wiki.git <dir>',
    );
    process.exit(2);
  }
  return out;
}

/** Line endings are normalised so a Windows checkout does not report every page as changed. */
const normalise = (text) => text.replace(/\r\n/g, '\n');

const out = resolveTarget();
const repository = repositoryUrl();
const prune = process.argv.includes('--prune');
const written = [];
const pruned = [];

// Nothing may be silently unpublished: a page here without a wiki page name would never appear.
for (const name of readdirSync(source)) {
  if (name.endsWith('.md') && !PAGES.has(name)) {
    console.error(`docs/wiki/${name} has no wiki page; add it to PAGES.`);
    process.exit(1);
  }
}

for (const [file, page] of PAGES) {
  const from = join(source, file);
  if (!existsSync(from)) {
    console.error(`Missing source page: docs/wiki/${file}`);
    process.exit(1);
  }
  const content = publish(normalise(readFileSync(from, 'utf8')), file, repository);
  const to = join(out, page);
  const previous = existsSync(to) ? normalise(readFileSync(to, 'utf8')) : null;
  if (previous === content) continue;
  mkdirSync(dirname(to), { recursive: true });
  writeFileSync(to, content, 'utf8');
  written.push(previous === null ? `${page} (new)` : page);
}

const managed = new Set(PAGES.values());
const strays = readdirSync(out).filter((name) => name.endsWith('.md') && !managed.has(name));

for (const name of strays) {
  if (!prune) {
    console.warn(`Wiki-only page (pass --prune to delete): ${name}`);
    continue;
  }
  rmSync(join(out, name));
  pruned.push(name);
}

/** `console.log` is forbidden by the release gate, and this script's report is stdout either way. */
const say = (line) => process.stdout.write(`${line}\n`);

if (written.length === 0 && pruned.length === 0) {
  say('Wiki already matches docs/wiki.');
  process.exit(0);
}

if (written.length > 0) say(`Updated: ${written.join(', ')}`);
if (pruned.length > 0) say(`Deleted: ${pruned.join(', ')}`);
if (strays.length > 0 && !prune) {
  say('Wiki-only pages were left alone; they are the drift this script exists to remove.');
}
