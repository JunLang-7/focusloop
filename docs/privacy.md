# Privacy

FocusLoop exists to help people who find it hard to start and resume work. It is built on the
assumption that such a tool is only usable if it is obviously, verifiably private.

## The short version

- No account. No sign-in. No telemetry. No analytics. No crash reporting. No ads.
- No central server. There is nothing to send data to.
- Everything is stored in one SQLite file in your OS user-data directory.
- The optional model provider is off unless you supply a key yourself.
- The browser extension cannot read page content, because it does not request permission to.

### Decision: option (A) — no production telemetry

**Chosen and frozen** (issue [#115](https://github.com/nianpingy-cpu/focusloop/issues/115), 2026-09-25):

The product ships with **no telemetry of any kind** — no aggregate metrics, no analytics, no crash
reports. Evaluation and guardrail reports (AG10) are produced **only on developer machines and in
CI**; the running application never uploads them.

**Option (B) — allowing aggregate metrics later — is rejected until this document is amended first.**
Any future change must specify, before any code ships: default on/off; how consent is obtained and
withdrawn; the destination; retention period; how a user deletes what was already sent; and a
field-level allowlist of what can **never** be uploaded (raw material, learner text, tutor
transcripts, provider prompts, keys, URLs, form content). A consent UI and deletion path must land
in the same change as the weakened promise.

Until that happens, any wiki or plan text that suggests production upload is wrong and must be
removed, not footnoted.

## What FocusLoop stores

| Data                                       | Where                                    | Why                                                                      |
| ------------------------------------------ | ---------------------------------------- | ------------------------------------------------------------------------ |
| Courses, concepts, micro tasks, quizzes    | local SQLite                             | to run a session                                                         |
| Imported material                          | local SQLite                             | to generate micro tasks                                                  |
| Sessions, learning events                  | local SQLite                             | to compute the learning state                                            |
| Checkpoints                                | local SQLite                             | to resume your cognitive position                                        |
| Interventions and outcomes                 | local SQLite                             | to show whether help actually helped                                     |
| Resume-card timings                        | local SQLite                             | to measure resume latency                                                |
| The words you write in a step's answer box | local SQLite, with the completion event  | so the agent knows what you produced, not just that you pressed a button |
| The words you write when you come back     | local SQLite, as a `TASK_ANSWERED` event | so what you remembered on the way back in is part of the record          |

The database lives at:

- Windows: `%APPDATA%\FocusLoop\focusloop.sqlite`
- macOS: `~/Library/Application Support/FocusLoop/focusloop.sqlite`
- Linux: `~/.config/FocusLoop/focusloop.sqlite`

Deleting that file removes everything FocusLoop knows. You do not have to go looking for it: the
sidebar footer shows this directory under **Your data**, with **Open folder** and **Delete
everything** beside it. The path there is read from Electron's `app.getPath('userData')`, so it is the
directory the running app is using rather than a path copied into this document.

### What it observes, without asking for any permission

Being able to notice that you have gone is the whole point of the app, and it does that from two
things the operating system already exposes to it:

- **whether its own window is in the foreground**, so switching to a browser, a PDF or a notes app is
  recorded as leaving and coming back;
- **how long the machine has been untouched**, so a screen nobody is using is told apart from one
  somebody is reading.

Neither reads a page, a keystroke, a window title or a screenshot, and neither leaves the machine:
what is stored is the same learning event as before — an event type, a timestamp and how long you were
away. The browser extension adds tab-level detail on top of this and is optional. This is why the
promise above is "no camera, no microphone, no eye tracking, no screen recording" and not "no
observation": the app knows _that_ you left, which is the minimum needed to help you come back, and
nothing about where you went.

**Delete everything** says what will be lost, asks for a second press, and then removes the file and
returns the app to a first-run state without a restart. If another program has the database open, the
app says so instead of reporting a success it did not have.

One corner is worth stating rather than implying: if the database file is deleted but FocusLoop cannot open
the database again afterwards (something holding the path, a transient permission error), the data is gone
and the app says that a restart is needed before it can be used. That is the only case in which a deletion
involves a restart, and it is reported rather than passed over.

Uninstalling leaves the file in place on purpose, so a reinstall does not lose your progress.

## What FocusLoop never collects

- No page content, no page titles, no URLs.
- No keystrokes, no form values, no clipboard.
- No cookies, no browsing history, no bookmarks.
- No camera, no microphone, no eye tracking, no screen recording.
- No device fingerprints, no location, no contacts.

## The browser bridge

The extension is optional. The golden path works without it: the app notices its own window losing
focus and the operating system's idle time by itself, so a learner who switches to a browser, a PDF
or a notes app is recorded as leaving and coming back with nothing installed at all. What the
extension adds is tab-level detail on top of that.

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

The footer's model entry opens [LLM Providers](llm-providers.md). You can configure DeepSeek, OpenAI
or an OpenAI-compatible endpoint, fetch its models and edit the model ID yourself. Saving configuration
alone does not enable it: **Use this model** selects the provider/model for new requests. **Use local
only** stops remote calls while retaining configuration. On a fresh profile, explicitly supplying
`FOCUSLOOP_DEEPSEEK_API_KEY` or `FOCUSLOOP_OPENAI_API_KEY` opts into that preset instead.

**Fetch models** explicitly contacts only the configured `/models` endpoint, sending the Key but no
learner material. **Test connection** sends a fixed short prompt and can incur a small API charge; it
never falls back to a mock success. Neither action enables a model. When a model is enabled:

- only the text of the single request is transmitted — and for the optional hint/example line on a
  rescue card, that request is named here so nothing is vague: it contains the current step's title
  and the same passage the card would quote offline (your concept summary, or a sentence of your
  imported material). This is what the import screen's hint means by "unless you configure a model
  key"; without a key no such request is made at all;
- the contextual tutor's request is the step, the passage of your material it sits on, and **the text
  you typed in its box** — the question you asked, or your own answer when you press _Check my
  answer_ from a step. The same goes for a rescue card's generated line. The conversation is kept in
  memory for the session and is never written to the database, so ending the session or deleting your
  data ends it — while the answer itself is written to the event log, as what you produced for that step;
- your learning events, checkpoints, session history and database are **never** sent;
- the key is never written to the repository and never persisted to the database. An environment
  variable is read and never stored; a key saved in the app is stored **encrypted by the operating
  system's keychain** (`safeStorage`) in a provider/endpoint-scoped file beside the database, and if
  secure storage is unavailable (including Linux `basic_text`) the app refuses to store it rather than
  keeping it in the clear. Changing the endpoint never reuses the old Key; redirects are refused. Either way the
  key is never returned to the interface, never included in an error message and never logged;
- the entry in the footer that shows which model is in use reads its answer from the running provider,
  so it cannot claim a key is in force when none is;
- if the request fails for any reason — offline, timeout, rate limit, bad response — FocusLoop
  silently degrades to the mock provider and tells the UI that it did.

You can verify the second claim by reading `packages/llm-provider/src/openai-compatible-provider.ts`: the
request body contains exactly `model`, `messages`, `stream` and the sampling options. That reading is
also the only way to inspect what was sent: there is no on-screen "what left the process" view.

The app's **Delete everything** action also removes app-owned encrypted Key files and provider
configuration, reporting any files left behind, and resets selection to local-only. Deleting the SQLite
file by hand does not remove separate encrypted Key files; use the application controls to remove them.
Environment variables are never modified by FocusLoop.

## A file you attach to an answer

Answering a step does not have to mean typing. The step's answer box — and the same box on a resume
card — can take a file instead: plain text, Markdown, PDF, Word (`.docx`) or a photograph of your
notes. All four readers run **inside the app, on this machine**, with no network request:

- PDF text is read with `pdf-parse`; Word documents with `mammoth`; text and Markdown are read as
  they are; pictures are read with `tesseract.js`, whose English and Simplified-Chinese language data
  ships in the app's own dependency tree (it is copied into a scratch folder beside the app's other
  temporary files on first use, and the recogniser itself needs no connection).
- **Only the file you pick is read.** Nothing walks your folders, nothing watches a directory, and no
  file is read that you did not choose in the operating system's own file dialog. The path never
  leaves your machine: it is passed from the window to the app's own main process, which is the same
  process that owns your database.
- What is read becomes **text in the answer box**, where you can see it and edit it. The file itself
  is not stored, not copied into the database, and not remembered by name afterwards — the line under
  the box names it until you answer and no longer.
- That text is then treated exactly like text you typed. It is sent to a model provider only if you
  configured one _and_ you press _Check my answer_, _Ask my tutor_ or complete the step — never when
  the file is read. Without a key nothing is sent at all, which is the same rule as the rest of the
  app (see _When a model provider is used_ above).
- Text from a picture is a **guess by a recogniser** and is labelled as one in the interface, because
  a mis-read word in a photograph of your handwriting is the difference between an answer that is
  judged on what you meant and one that is judged on what a machine thought it saw.

There is no automatic speech-to-text. Reading speech offline needs either a speech model downloaded
onto your machine or a native build of a recogniser, and the app ships neither; rather than show a
microphone button that does nothing, the app leaves voice input out and says so here.

## What the app can see, and what it does about it

The renderer is sandboxed with `contextIsolation: true`, `nodeIntegration: false` and
`sandbox: true`. Its only capability is a fixed list of methods on `window.focusloop`. It cannot read
files, open sockets, or spawn processes — when it needs a file read it can only ask the main process
to read the one file you picked, and it gets back text or a refusal.

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
