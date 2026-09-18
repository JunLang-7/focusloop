# Repository and releases

The project lives in a **private** GitHub repository:

```text
https://github.com/nianpingy-cpu/focusloop
```

`origin` is wired to it over SSH, `main` tracks `origin/main`, and the release tag `v0.1.0-demo` is
pushed. Only the default branch is on the remote — the feature branches were merged into `main` and
kept local.

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
is private, so the release is visible to collaborators only.

## Before pushing

```bash
pnpm lint
pnpm typecheck
pnpm test
node scripts/verify-no-scaffolding.mjs
```

All four are CI gates (`.github/workflows/ci.yml`) and all four must pass before `main` is pushed.
