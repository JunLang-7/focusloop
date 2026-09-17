# Privacy

FocusLoop exists to help people who find it hard to start and resume work. It is built on the
assumption that such a tool is only usable if it is obviously, verifiably private.

## The short version

- No account. No sign-in. No telemetry. No analytics. No crash reporting. No ads.
- No central server. There is nothing to send data to.
- Everything is stored in one SQLite file in your OS user-data directory.
- The optional model provider is off unless you supply a key yourself.
- The browser extension cannot read page content, because it does not request permission to.

## What FocusLoop stores

| Data                                    | Where        | Why                                  |
| --------------------------------------- | ------------ | ------------------------------------ |
| Courses, concepts, micro tasks, quizzes | local SQLite | to run a session                     |
| Imported material                       | local SQLite | to generate micro tasks              |
| Sessions, learning events               | local SQLite | to compute the learning state        |
| Checkpoints                             | local SQLite | to resume your cognitive position    |
| Interventions and outcomes              | local SQLite | to show whether help actually helped |
| Resume-card timings                     | local SQLite | to measure resume latency            |

The database lives at:

- Windows: `%APPDATA%\FocusLoop\focusloop.sqlite`
- macOS: `~/Library/Application Support/FocusLoop/focusloop.sqlite`
- Linux: `~/.config/FocusLoop/focusloop.sqlite`

Deleting that file removes everything FocusLoop knows. Uninstalling leaves it in place on purpose,
so a reinstall does not lose your progress.

## What FocusLoop never collects

- No page content, no page titles, no URLs.
- No keystrokes, no form values, no clipboard.
- No cookies, no browsing history, no bookmarks.
- No camera, no microphone, no eye tracking, no screen recording.
- No device fingerprints, no location, no contacts.

## The browser bridge

The extension is optional. The golden path works without it, via the Demo Event Simulator.

What it does collect: **tab activation and idle state only** — "the active tab changed", "the user
became idle", "the user came back after 30 seconds".

Why it _cannot_ collect more:

```json
{ "permissions": ["idle", "storage", "alarms"] }
```

There is no `tabs` permission and no host permission, so the extension API will not return a URL or
a title even if the code asked for one. There are no content scripts, so nothing runs inside a page.
The tracker's entire state is `{ learningTabId, awaySince, idleSince }` — three numbers and an id.

Transport is equally constrained:

- The desktop binds a WebSocket server to **`127.0.0.1` only**. It is not reachable from the network.
- Every message must carry a **per-run token**, compared in constant time. The token is regenerated
  each launch and shown to you in the app so you can paste it into the extension.
- Every message is **schema-validated**. Unknown fields are dropped, an oversized message is
  rejected, and a message that is not on the closed list of types is refused.
- If `payload.origin` is present it is reduced to `scheme://host`. A path, query or fragment never
  survives validation.
- Event ids are remembered in a bounded ring, so a reconnect cannot replay an event.

## When a model provider is used

FocusLoop ships with `MockAIProvider`: deterministic, offline, no key. It is the default and it is
enough for the entire demo.

If you set `FOCUSLOOP_DEEPSEEK_API_KEY`, the app will additionally use DeepSeek for optional
enrichment (for example, generating an example for a hint). In that case:

- only the text of the single request is transmitted;
- your learning events, checkpoints, session history and database are **never** sent;
- the key is read from the environment only — it is never written to the repository, never persisted
  to the database, and never included in an error message or a log;
- if the request fails for any reason — offline, timeout, rate limit, bad response — FocusLoop
  silently degrades to the mock provider and tells the UI that it did.

You can verify the second claim by reading `packages/llm-provider/src/deepseek-provider.ts`: the
request body contains exactly `model`, `messages`, `stream` and the sampling options.

## What the app can see, and what it does about it

The renderer is sandboxed with `contextIsolation: true`, `nodeIntegration: false` and
`sandbox: true`. Its only capability is a fixed list of methods on `window.focusloop`. It cannot
read files, open sockets, or spawn processes.

The Content-Security-Policy is:

```text
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'
```

No remote script, no inline script, no remote connection from the renderer.

## Your rights, practically

- **Access:** the database is a single file you own.
- **Deletion:** delete the file.
- **Portability:** it is standard SQLite; open it with any SQLite client.
- **Refusal:** do not install the extension, and do not set an API key. You lose nothing essential.

## Reporting a privacy issue

Open an issue labelled `privacy`. If the report involves a way to exfiltrate data, please describe
the mechanism without including anyone's real data.
