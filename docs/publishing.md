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

## Distributing the installers

`dist/` and `release/` are gitignored, so the ~125 MB installers and the built bundles stay out of
the repository. `.github/workflows/release.yml` builds them and attaches them; a manual release is
only the fallback:

```bash
gh release create v0.2.0 \
  apps/desktop/release/FocusLoop-Setup-x64.exe \
  apps/desktop/release/FocusLoop-Setup-arm64.exe \
  apps/desktop/release/FocusLoop-Setup-arm64.dmg \
  apps/desktop/release/FocusLoop-Setup-x64.dmg \
  apps/extension/release/focusloop-extension.zip \
  SHA256SUMS.txt \
  --title "FocusLoop v0.2.0" \
  --notes-file CHANGELOG.md
```

Four installers, because the release covers two operating systems and two architectures each:

| Platform              | Artefact                    |
| --------------------- | --------------------------- |
| Windows (x64)         | `FocusLoop-Setup-x64.exe`   |
| Windows on ARM        | `FocusLoop-Setup-arm64.exe` |
| macOS (Apple Silicon) | `FocusLoop-Setup-arm64.dmg` |
| macOS (Intel)         | `FocusLoop-Setup-x64.dmg`   |

The arch flags are not optional. `electron-builder` builds only the architecture of the machine it
runs on unless told otherwise, so leaving them off produces one installer and drops the other from
the release without an error.

Neither installer carries a Developer ID, so a downloaded copy still needs right-click → **Open**
(macOS Gatekeeper) or **More info → Run anyway** (Windows SmartScreen). A paid Apple Developer
Program membership plus a notarization round is what removes that prompt, and there is no free path
to it: the account is Apple's gate rather than a technical one.

The macOS builds are **ad-hoc signed** (`identity: '-'`), which is not the same as unsigned. The
ad-hoc signature seals the bundle, so `codesign --verify --strict` passes and macOS treats the app
as unidentified rather than as damaged. `identity: null` — what this file used before — left the
bundle with only the linker's signature on the executable and no `CodeResources` at all, which
strict verification rejects; measured on the arm64 dmg, the seal was absent before and present
after. `hardenedRuntime` is off, because hardened runtime combined with an ad-hoc signature
enforces library validation and would stop the app launching unless it also carried
`com.apple.security.cs.disable-library-validation`. Notarization will want it back on with a real
entitlements file.

The Windows builds set `signExecutable: false`, which keeps the icon and version metadata while
leaving the signing toolchain out of the build.

`SHA256SUMS.txt` is written by `.github/workflows/release.yml` at release time and attached to the
release. It is deliberately **not** committed: the repository would then carry checksums for the
four binaries it does not contain, and a local release run would rewrite a tracked file. The
README's "verify your download against `SHA256SUMS.txt`" refers to the copy attached to the release.

Until that runs, the **Install** link in the README leads to an empty releases page. The repository
is public, so a published release is visible to anyone.

The same workflow can be rehearsed by hand: **Actions → Release → Run workflow**. A dispatched run
executes every gate, packaging and checksum step and stops before publishing — a release cannot be
attached to a branch — and uploads all four installers, the extension zip and `SHA256SUMS.txt` to
the run instead. That is the only way to exercise the NSIS installers and the dmg images without
pushing a tag.

## What a release must pass

Release is deliberately stronger than CI. `.github/workflows/release.yml` **calls**
`.github/workflows/ci.yml` as a reusable workflow rather than restating its steps, so every gate CI
gains is automatically part of the next release. Before it did this, Release ran four gates and
quietly missed the other seven plus the whole golden-path suite — nothing failed, the gates were
simply absent.

The gates CI does not run live in `.github/workflows/deep-checks.yml`, because the same ones also
run **nightly** on a schedule. Two triggers, one definition: a regression is found within a day
rather than at the next release, and a release cannot pass a gate the nightly run would have failed.

| Stage             | What it proves                                                                                                     |
| ----------------- | ------------------------------------------------------------------------------------------------------------------ |
| CI gates (reused) | lint, typecheck, spec types, tests, build, formatting, all five `verify:*` gates, golden path on Windows and macOS |
| `deep` (reused)   | the four gates below, defined once in `deep-checks.yml`                                                            |
| ↳ `coverage`      | every package still meets its own coverage floors                                                                  |
| ↳ `soak-unit`     | the unit suite passes five consecutive runs on all three OSes — a rare stall cannot hide behind one green run      |
| ↳ `soak-e2e`      | the golden path passes three consecutive runs on Windows and macOS                                                 |
| ↳ `llm-live`      | the shipped adapters still reach a real provider                                                                   |
| `package-*`       | four installers build, one per OS/architecture                                                                     |
| `smoke-windows`   | each installer silently installs and leaves a runnable app                                                         |
| `smoke-macos`     | each dmg mounts and contains a complete, correctly-architected app bundle                                          |

The soak jobs exist because a suite that passes once is not a suite that passes: the Windows SQLite
I/O stall that turned `main` red had passed its own branch's CI and failed only after merging.

The nightly run can also be started by hand: **Actions → Deep checks → Run workflow**.

### Required repository secrets

`llm-live` fails loudly when its credential is absent. A release gate that quietly passes without
its secret is the appearance of a gate, so a missing `DEEPSEEK_API_KEY` blocks the release with a
message naming it.

| Secret                    | Required | What it exercises                                                         |
| ------------------------- | -------- | ------------------------------------------------------------------------- |
| `DEEPSEEK_API_KEY`        | **yes**  | `/models` discovery, completion and streaming against the DeepSeek preset |
| `OPENAI_COMPATA_API_KEY`  | no       | completion against a real OpenAI-compatible endpoint                      |
| `OPENAI_COMPATA_BASE_URL` | no       | that endpoint's base URL                                                  |
| `OPENAI_COMPATA_MODEL`    | no       | the model to probe there; defaults to the script's own                    |

The compatible probe is skipped when its credential is absent, because the project never claimed to
ship a particular third-party endpoint — but the DeepSeek adapter is the documented default and must
be proven before a release ships. Nothing in the live job prints a credential, an HTTP body or a URL:
`scripts/test-llm-connection.mjs` emits one sanitized JSON object per line and exits non-zero on
failure.

A red `llm-live` run is not always a code defect. The job exercises a real account, so an account out
of credit answers HTTP 402, and the adapter reports that as `quota-exceeded` with the status beside it
rather than as `bad-response`: the fix is to top the account up (or unset the optional
`OPENAI_COMPATA_*` pair so the probe skips), not to look for a malformed reply. That distinction is why
the live probe's first red run after a balance ran out read as an adapter bug.

### The wiki publishes with no secret at all

`docs/wiki/` is published to the GitHub Wiki by `wiki-sync.yml` on every push to `main` that touches
it. It used to require a `WIKI_SYNC_TOKEN` secret and, without one, did nothing but print a notice —
and the secret was never needed. The job token can write to `<repo>.wiki.git` when the job is granted
`contents: write` (GitHub has no wiki-only permission), so **the wiki needs no configuration**.

`WIKI_SYNC_TOKEN` is therefore **optional, and an override rather than a requirement**: it is preferred
when it works and the built-in token publishes when it does not. It exists so that a change to what
GitHub lets the built-in token do is answered by pasting a credential rather than by a code change.

That "when it works" is the whole design, and it was learned from a failure rather than reasoned out: an
override that was preferred _unconditionally_ turned a working wiki into a failing workflow the moment a
token GitHub did not accept was pasted in — the opposite of what insurance is for. Now a rejected
override costs a **warning**, the run stays green, the wiki still publishes, and the run summary says
which credential was used. A secret that is set but wrong is therefore visible without being fatal.

**Deleting the secret returns the workflow to the built-in token entirely**, which is why the fallback
is a one-liner rather than a revert:

```bash
gh secret set WIKI_SYNC_TOKEN --repo nianpingy-cpu/focusloop     # optional; paste a PAT
gh secret delete WIKI_SYNC_TOKEN --repo nianpingy-cpu/focusloop  # remove it again
```

Before pasting one, check what you have. A rejected token is the failure this workflow tolerates, but it
is still a token that does not work — and two ways of getting this wrong are worth avoiding, because
both have happened. Once, a secret was stored holding a **single character**, because nothing checked
the value between the paste and the `gh secret set`. And once, a multi-character paste into
`Read-Host -AsSecureString` delivered **one character** to the prompt and spilled the rest of the token
onto the screen afterwards — the guard below caught it (`Nothing was stored`), but the token was now
echoed into a terminal's scrollback, which is a leak, not an inconvenience.

So the snippet reads the **clipboard** rather than asking you to paste into a prompt: no terminal is
involved in the transfer, so there is nothing to truncate and nothing to echo.

```powershell
# Copy the PAT first. Then, with nothing else on the clipboard:
$t = (Get-Clipboard -Raw).Trim() -replace '\s', ''
if ($t.Length -lt 20 -or $t -notmatch '^(ghp_|github_pat_|gho_|ghs_)') {
  throw "The clipboard does not hold a token ($($t.Length) characters). Copy the PAT again and re-run."
}
$h = @{ Authorization = "Bearer $t"; Accept = 'application/vnd.github+json' }
$repo = Invoke-RestMethod https://api.github.com/repos/nianpingy-cpu/focusloop -Headers $h
if (-not $repo.permissions.push) { throw 'This token cannot push to this repository, so it cannot publish the wiki.' }
gh secret set WIKI_SYNC_TOKEN --repo nianpingy-cpu/focusloop --body $t   # --body, so nothing else is in the value
Set-Clipboard ''                                                        # and do not leave it lying around
```

A token that has ever been echoed to a screen — a terminal's output, a transcript, a log, a screenshot —
is a token to **revoke**, not one to store. Deleting it at
[github.com/settings/tokens](https://github.com/settings/tokens) and minting a fresh one costs less than
the alternative.

Use a **dedicated** personal access token. A classic PAT with `repo` is what the wiki-publishing
ecosystem documents; a fine-grained token is undocumented for wiki Git access, so treat it as
unverified. Do not reuse the token your own `gh` CLI holds — that one carries `delete_repo` and
`admin:org`, and anyone who can push a branch to this repository can read a repository secret, so
reusing it would put account-wide reach behind a single workflow file.

## The application icon

`apps/desktop/resources/icon.ico`, `icon.png` and `icon.icns` are committed assets, not build output.
They are generated from `docs/assets/pure_logo.png`. The window hands the right icon to
`BrowserWindow` (the taskbar entry and the Alt-Tab thumbnail), and explicitly sets the macOS Dock
icon when running from source. electron-builder uses the ICNS for macOS, the PNG for Linux, and
embeds the ICO in the Windows executable, NSIS installer and uninstaller.
`apps/desktop/electron-builder.yml` names the paths explicitly, and `electron/app-icon.spec.ts`
fails if those references, the files, or this section disappear. The renderer bundles the same PNG
for its expanded/collapsed sidebar logo and favicon; the README uses the light/dark wordmarks in
`docs/assets/`. The sidebar's `wordmark-light.png` and `wordmark-dark.png` are cropped from the
transparent `docs/assets/logo_name_pure.png`, preserving its lettering and blue "Loop" while using
white "Focus" on dark backgrounds.

Regenerate the icons and sidebar wordmarks after changing the source artwork. The script uses the desktop app's
installed Electron image tooling, without extra dependencies or network access (on headless Linux,
prefix the command with `xvfb-run`):

```bash
node apps/desktop/scripts/make-icons.mjs
```

`signExecutable: false` keeps the Windows signing toolchain out of the loop without giving up the
icon: the icon and the version metadata are still written into `FocusLoop.exe`, so the installer, the
installed shortcuts and Add/Remove Programs all show the mark, and only code signing is skipped —
which is what the unsigned v0.1 demo wants. `signAndEditExecutable: false` is the blunter switch: it
skips the executable's icon and metadata too, leaving the icons set under `nsis` as the only ones (the
installer, the uninstaller and the header), and is the fallback if a release run cannot apply them.

The policy that governs signing a Windows release — what is signed, who approves it, and the
conditions a release has to meet — is in [code-signing-policy.md](code-signing-policy.md).

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
pnpm verify:spec-types
```

The `quality` job runs exactly these on Ubuntu, Windows and macOS, plus `pnpm format:check`; the
`golden path` job then runs `pnpm e2e` on Windows and macOS, and the `package (smoke)` job builds the
installer directory and the extension zip so a packaging break is caught before a tag.

The `dependency review` check (`.github/workflows/dependency-review.yml`) is the one gate with no
local equivalent: it reads the dependency diff of a pull request and fails it on a high or critical
advisory, which is what catches a newly added package rather than the ones already in the lockfile. It
needs the repository's **Dependency graph** setting, which is on, and it asks for `contents: read`
only, so it also runs on a pull request from a fork (#43).
