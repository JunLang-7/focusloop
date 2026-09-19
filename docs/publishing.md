# Repository and releases

The project lives in a **public** GitHub repository:

```text
https://github.com/nianpingy-cpu/focusloop
```

`origin` is wired to it over SSH, `main` tracks `origin/main`, and the release tag `v0.1.0-demo` is
pushed. The upstream repository carries only `main`: work arrives through pull requests, from a
branch in a fork for anyone outside the project, and from a branch in the repository itself for the
owner.

## Day-to-day

```bash
git push                  # main already tracks origin/main
git push origin --tags    # after re-tagging a release commit
```

If the remote is ever lost:

```bash
git remote add origin git@github.com:nianpingy-cpu/focusloop.git
git push -u origin main
git push origin v0.1.0-demo
```

## Renaming the repository

`url:` fields must be absolute, so the owner/repo path is hardcoded in three places. Renaming the
repository breaks all of them:

| File                                | What to change                                  |
| ----------------------------------- | ----------------------------------------------- |
| `.github/ISSUE_TEMPLATE/config.yml` | the `owner/repo` segment of both `url:` values  |
| `README.md`                         | the links under **Install** and **Development** |
| `docs/publishing.md`                | this table and the URL above                    |

## Commit identity

Every commit so far was authored under a local stand-in identity — `git config user.name` is
`FocusLoop Orchestrator`, which is not a GitHub account. On GitHub they will all be attributed to
that name.

To attribute _future_ commits to yourself:

```bash
git config user.name "your-github-username"
git config user.email "you@example.com"
```

Changing the author of _existing_ commits needs a history rewrite (for example `git filter-repo`
with a mailmap). That changes every commit hash, so `v0.1.0-demo` has to be recreated and anything
already pushed needs a force-push. For a demo tag that is rarely worth it.

## Distributing the installer

`dist/` and `release/` are gitignored, so the ~114 MB installer and the built bundles stay out of
the repository. Attach the installer to a release rather than committing it:

```bash
gh release create v0.1.0-demo \
  apps/desktop/release/FocusLoop-Setup.exe \
  apps/extension/release/focusloop-extension.zip \
  SHA256SUMS.txt \
  --title "FocusLoop v0.1.0-demo" \
  --notes-file CHANGELOG.md
```

`SHA256SUMS.txt` is written by `.github/workflows/release.yml` at release time and attached to the
release. It is deliberately **not** committed: the repository would then carry checksums for two
binaries it does not contain, and a local release run would rewrite a tracked file. The README's
"verify your download against `SHA256SUMS.txt`" refers to the copy attached to the release.

Until that runs, the **Install** link in the README leads to an empty releases page. The repository
is public, so a published release is visible to anyone.

The same workflow can be rehearsed by hand: **Actions → Release → Run workflow**. A dispatched run
executes every packaging and checksum step and stops before publishing — a release cannot be
attached to a branch — and uploads the installer, the extension zip and `SHA256SUMS.txt` to the run
instead. That is the only way to exercise the NSIS installer without pushing a tag.

## Before pushing

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm verify:scaffolding
pnpm verify:workflows
pnpm verify:docs
pnpm verify:tokens
```

The `quality` job runs exactly these on Ubuntu, Windows and macOS, plus `pnpm format:check`; the
`golden path` job then runs `pnpm e2e` on Windows and macOS, and the `package (smoke)` job builds the
installer directory and the extension zip so a packaging break is caught before a tag.
