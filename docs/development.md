# Development guide

Everything needed to run, package and test FocusLoop from source. The README keeps only the short
path; this file holds the detail.

## Prerequisites

[Node.js](https://nodejs.org) ≥ 22.13 (`.nvmrc` pins the exact version) and pnpm ≥ 9.

```bash
corepack enable   # provides pnpm at the version pinned in package.json
pnpm install
```

If `corepack` is unavailable, `npm install -g pnpm` works too.

## Run the desktop app

```bash
pnpm --filter @focusloop/desktop run start
```

This compiles the Angular renderer and the Electron main process, then opens the window. There is
no hot reload: after changing source, stop the app and run the command again.

Running from source uses Electron's default profile directory, not the packaged app's `FocusLoop`
one. Every interruption is real: the app notices its own window losing focus, so switching to
another window for twenty seconds is enough.

Launchers on Windows:

- `scripts\start-focusloop.cmd` runs the same command from any directory and keeps the window open
  on failure.
- `scripts\focusloop-startup.ps1` adds a shortcut to your Startup folder (no administrator rights):

```powershell
.\scripts\focusloop-startup.ps1            # start FocusLoop at every sign-in
.\scripts\focusloop-startup.ps1 -Remove    # undo
.\scripts\focusloop-startup.ps1 -Target "$env:LOCALAPPDATA\Programs\FocusLoop\FocusLoop.exe"
```

## Package

```bash
pnpm --filter @focusloop/desktop run package           # → FocusLoop-Setup-{x64,arm64}.exe
pnpm --filter @focusloop/desktop run package:mac:arm64  # → FocusLoop-Setup-arm64.dmg
pnpm --filter @focusloop/desktop run package:mac:x64    # → FocusLoop-Setup-x64.dmg
pnpm --filter @focusloop/desktop run package:mac:dir    # → mac-arm64/FocusLoop.app (Intel: mac/)
pnpm --filter @focusloop/extension run build:zip       # → focusloop-extension.zip
```

Both installers land in `apps/desktop/release/`. The arch flags matter: without them
electron-builder builds only the architecture of the machine it runs on, so the other one
silently goes missing.

The macOS bundle is unsigned. When run from source, Task Manager, the Dock and Finder show the stock
**Electron** name; only packaged apps carry the FocusLoop name and icon. Packaged apps use a
different profile from source runs, so existing development data is untouched. Export learning data
from the development app and import it into the packaged one to move it.

## Real model provider

The default is `MockAIProvider`: deterministic and offline. In the app, open **Settings → Models**
(⌘, / Ctrl+,) and choose DeepSeek, OpenAI, or an OpenAI-compatible provider with your own Base URL
and API Key. See [LLM Providers](llm-providers.md).

Alternatively supply a key at runtime; the environment variable wins over a saved key:

```bash
FOCUSLOOP_DEEPSEEK_API_KEY=... pnpm --filter @focusloop/desktop run start
```

```powershell
$env:FOCUSLOOP_DEEPSEEK_API_KEY="..."; pnpm --filter @focusloop/desktop run start
```

Keys saved in the app are encrypted by the OS keychain (`safeStorage`) into a single file beside the
database. They are never written to the repository or database, never logged, and never handed to the
renderer. If the provider fails, FocusLoop degrades to the mock provider and tells the UI why.

## Checks

```bash
pnpm lint        # eslint across every project
pnpm typecheck   # tsc --noEmit across every project
pnpm test        # vitest across every project
pnpm build       # production bundles for every project
pnpm e2e         # playwright drives the real Electron app, building it first
```

Repository gates: `pnpm verify:scaffolding`, `verify:workflows`, `verify:docs`, `verify:tokens`,
`verify:spec-types`. What each test area proves is in [testing.md](testing.md).

## The 3-minute demo

Home → _Start session_ on “Red-black trees: the basics” → _Start_ the first micro task → _Complete
task_ → switch to another window for ~25 seconds (nothing appears while you are away) → switch back
→ the Resume Card shows done / open / next step → _Continue_ → complete the task → open the
Dashboard for interruptions, resume latency and outcomes.
