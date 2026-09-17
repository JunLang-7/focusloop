# Publishing this repository

This repository is **local only**. `git remote -v` is empty and nothing has been pushed anywhere.
The steps below are what it takes to put it on GitHub.

## Create and push

With the `gh` CLI (already authenticated in this environment):

```bash
gh repo create focusloop --private --source=. --remote=origin --push
```

- `--source=.` uses the current directory
- `--remote=origin` wires up the remote
- `--push` pushes `main` and the `v0.1.0-demo` tag

Swap `--private` for `--public` if you want it world-readable. Prefer `--private` first: nothing
here is a secret, but a public repository cannot be un-indexed once it has been crawled.

Without `gh`:

```bash
git remote add origin git@github.com:<owner>/focusloop.git
git push -u origin main
git push origin v0.1.0-demo
```

## Update the links afterwards

Three places assume an owner/repo that only becomes real once you run the command above. They are
currently set to `nianpingy-cpu/focusloop` as a best guess — fix them if you chose a different name:

| File                                | What to change                                 |
| ----------------------------------- | ---------------------------------------------- |
| `.github/ISSUE_TEMPLATE/config.yml` | the `owner/repo` segment of both `url:` values |
| `README.md`                         | the releases link under **Install**            |
| `docs/publishing.md`                | this table                                     |

`url:` in the issue-template config must be absolute, so it cannot be relative and will 404 on a
rename.

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

## What actually gets pushed

`dist/` and `release/` are gitignored, so the ~114 MB installer and the built bundles stay out of
the repository. To distribute the installer, attach it to a release rather than committing it:

```bash
gh release create v0.1.0-demo \
  apps/desktop/release/FocusLoop-Setup.exe \
  apps/extension/release/focusloop-extension.zip \
  SHA256SUMS.txt \
  --title "FocusLoop v0.1.0-demo" \
  --notes-file CHANGELOG.md
```

That also makes the **Install** link in the README resolve.

## Before the first push

```bash
pnpm lint
pnpm typecheck
pnpm test
node scripts/verify-no-scaffolding.mjs
```

All four are CI gates (`.github/workflows/ci.yml`) and all four must pass before `main` is pushed.
