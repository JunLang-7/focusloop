# Changelog

All notable changes to FocusLoop are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.0-alpha.1] — 2026-10-14

An alpha preview for trying the learning loop with your own material. Since `0.1.0-demo`,
FocusLoop adds configurable models, answers and quizzes, file attachments, daily reminders,
and a revised focus workspace. Local-only use remains available without an API key.

### Highlights

- Configure DeepSeek, OpenAI or a custom OpenAI-compatible provider in Settings, with model
  discovery, connection testing and an explicit choice of the active model.
- Write answers, check quizzes and ask the tutor for explanations, hints or feedback; resume
  an interrupted session with your current step and answer preserved.
- Attach text, Markdown, PDF, Word documents or pictures of notes to an answer, with local
  text extraction and English/Chinese OCR.
- Set a daily reminder that can arrive with the app closed, choose language and appearance
  during first run, and track wellbeing check-ins and study streaks.
- Use a consistent blue-and-white interface, a compact Settings dialog and a focus workspace
  with clearer task controls, plan rows and return cards.

### Added

- **Configurable LLM providers and models.** Settings supports DeepSeek and OpenAI presets as well
  as custom OpenAI-compatible endpoints. Fetch models or enter an ID manually, save configuration,
  test a connection and explicitly enable a model. Each provider has independent credentials,
  encrypted using the operating system's secure storage and scoped to its endpoint. **Use local
  only** disables remote model calls while retaining saved configuration. See
  [LLM Providers](docs/llm-providers.md) for configuration and compatibility details.
- **A daily wellbeing check-in, and a streak beside the heatmap.** The home page now asks how the day
  feels — five faces and an optional sentence, one answer per local day, stored on this machine and
  editable later. It is a different question from the learning state: the engine can see what the learner
  is doing, and cannot infer how they are, so it asks. The dashboard gained the other half of that habit —
  a day streak, counted from the same days the heatmap colours rather than from a seven-day window, which
  would have capped a three-week streak at seven. Both come from reading Tiimo's public model (see
  `analysis/tiimo-rea/REPORT.md`), and neither copies it: the check-in is a quiet card, not a modal, and
  the streak is a label over data the app already had rather than a trophy to collect.
- **The clock can be 24-hour or 12-hour.** A display preference in Settings, beside the theme, stored by
  the store like the language. It changes how a time of day is written and nothing else — a duration
  still reads `3:09` in both, because that is minutes and seconds, not a time of day.
- **A daily reminder to start, and a first-run questionnaire that asks for it.** The app can now nudge
  the learner once a day, at a time they choose, when no session is running — a reminder to _start_,
  never to keep going, because the inside of a session already has the clock and the resume card and a
  notification there is the interruption this product removes. On a first run the app asks for the
  interface language, whether and when to be nudged, and appearance, with a live language preview.
  Preferences are saved only if the learner accepts; "Later" leaves them unchanged and stops the
  questionnaire asking again. The reminder also works with the app closed, as described below.
- **An answer can be a file, and the app reads it here.** A step's answer box, and the same box on a
  resume card, now carry an attach button beside the one that asks the tutor. Plain text, Markdown,
  PDF, Word (`.docx`) and photographs of notes are all accepted, and all four readers run inside the
  app with no network request: `pdf-parse` for PDF text, `mammoth` for Word, the file's own bytes for
  text, and `tesseract.js` for pictures, with its English and Chinese language data taken from the
  app's own dependency tree rather than a CDN. Only the file picked in the operating system's dialog
  is read — nothing walks a folder — and the path is handed to the app's main process, so the sandboxed
  window still cannot touch the filesystem itself. What comes back is **text in the box**, visible and
  editable, then treated exactly like typing: it reaches a model only if a key is configured _and_ the
  learner presses Check my answer, Ask my tutor or completes the step, and a cancelled dialog, a
  refusal (unsupported type, past the 25 MB limit, unreadable, nothing legible) and a truncated read
  each have their own sentence under the box rather than a silent failure. Text from a picture is
  labelled as a recogniser's guess, because an answer should be judged on what the learner meant.
  There is deliberately no microphone button: offline speech needs a downloaded model or a native
  build, the app ships neither, and a control that did nothing would be worse than its absence.
- **Coming back asks what you remember, and keeps it.** The resume card now carries the check-in the
  product was missing on every route: the step's own question and options when the course holds a quiz,
  otherwise the same box the step has, whose words are recorded as the learner's answer for that step
  (`TASK_ANSWERED` — a new event, bounded like the completion's answer and projected into an agent
  context under the same smaller budget). The box, the chosen option and the verdict are **one piece of
  state**, so the step, the notice above it and the card on other routes are one field rather than three
  copies of the same question: writing in the notice is what the step's box holds, and the step's copy is
  hidden only while the resume notice is open, which is the row #77 reserves and the half of the step it
  needs. The card's "Show context" button and the raw checkpoint/timestamp dump behind it are gone: it
  printed a UUID and two ISO timestamps at a learner, and the row it occupied is now the check-in.
  Completing a step still carries the answer it was written with; the two events are different facts —
  what they said while they were on the step, and what they said when they finished it.
- **The step asks what you came up with, and answers back.** A running step now offers the one thing
  the loop was missing: a place to produce something. Every step carries a box for the learner's own
  words — the text travels with the completion, so the checkpoint and every prompt an agent builds know
  what was written rather than only that a button was pressed — with a button that hands that text to
  the tutor in **Check my answer**, filled in and opened rather than sent. A step whose kind is `quiz`
  shows its question and its options instead, and is graded **in the main process**: the screen sends
  the option and is told the verdict, which marks the right answer next to the one that was chosen and
  explains why. That also gives `QUIZ_CORRECT` / `QUIZ_INCORRECT` a producer inside the app again —
  since the simulator bar was removed nothing could emit them, so the state machine's confused branch,
  the dashboard's "progressed" count and the intervention outcomes had no way to be reached by a
  learner. The learner's answer is bounded (`LEARNER_ANSWER_CHARACTERS`) where it is written, refused at
  the IPC boundary past that, and cut to a smaller budget (`AGENT_CONTEXT_LIMITS.answerCharacters`) on
  the way to a model.
- **An optional quiet layer, generated in the app rather than shipped (#57).** Brown noise through a
  low-pass filter, off until the learner asks for it, offered as a small quiet control in the focus
  screen's session row — beside the session state and End session, never inside the task box, whose
  height is a contract against the notice and the tutor panel. It plays while a session runs, including
  with the dashboard on screen, because the layer lives outside the focus route, and it stops when the
  session ends or the toggle goes off. The choice is remembered, and remembering it never starts a sound
  on its own. No audio files are added and nothing leaves the machine.
- **Your data, in the app.** The sidebar footer shows the directory the database lives in, read from
  Electron rather than written down, with a button that opens it in the OS file manager. **Delete
  everything** says what will be lost, asks for a second press, and then removes the database and its
  sidecars and returns the app to a first-run state without a restart. A file another program has open is
  reported as not deleted rather than shown as a success, and a file that could not be removed is named. See
  `docs/privacy.md`.
- **The model answers in the interface's language.** The tutor and the rescue suggestion now carry the
  language the learner chose in their system prompt, so a Simplified-Chinese interface is answered in
  Simplified Chinese and an English one in English — including when the material, the task or the question
  is in the other language, which is what decided the language before. The instruction is part of the
  system prompt the prompt builders measure, so it is charged against the same character ceiling as the rest
  of the prompt rather than appended after the budget was computed; that is why the tutor's boundary test
  now finds its refusal size 139 characters lower. `replyLanguageInstruction` in
  `packages/agent-core/src/model-language.ts` is the single wording, keyed by `Locale` so a locale added
  without one fails the typecheck instead of answering in whatever the material happened to be written in.
- **The reminder now arrives with the app closed, and in the right language.** It was owned by the
  renderer, which meant it could only fire while the window was open — a reminder to start a session
  that required already being in the app. The app now registers a daily entry with the platform's own
  scheduler (Task Scheduler on Windows, a LaunchAgent on macOS, a systemd user timer on Linux), which
  launches the executable with `--reminder-fire` at the chosen time. Which of the two speaks is decided by
  the single-instance lock: a window already open holds it, so the scheduled launch exits quietly and the
  window's own timer fires; with the app closed the launch takes the lock, shows one notification and
  exits. The window is the owner only for a time it was open to see (`runningSince`), so opening the app an
  hour after a reminder already arrived does not say the same sentence twice. The two sentences moved to
  `packages/shared-types/src/reminder.ts` so the window and the scheduler say
  the same thing, and the scheduled launch carries the language in its arguments rather than opening the
  database the running instance already has open. The first run also takes the machine's language from
  `app.getLocale()` when nothing is stored yet, and asks it as the questionnaire's first question with a
  live preview, rather than opening a Chinese machine on an English questionnaire. A reminder whose
  notifications the platform will not show now says so in Settings — with the button that asks for
  permission, which only a gesture can do — instead of looking switched on while being silently dropped.

### Changed

- **The whole app is one blue-and-white palette.** The dashboard's ring, its legend and the daily heatmap
  were a rainbow — green for focused, amber for confused, orange for overloaded, red for interrupted, and
  a green calendar — so one day's time read as eight unrelated verdicts instead of as one column of the
  app's own colour. The ring is a blue-to-slate ramp now: the study states are the accent, strongest for
  `FOCUSED`, and the away states are the neutral slate the app draws everything that is not the learner's
  work in. The heatmap's ink is the accent, the state chip's dot follows the same ramp, and the task kinds
  lost the last two hues — the row's glyph already says which kind it is. Red is kept for errors and
  refusals and amber for the two warnings, because those are verdicts rather than decoration.
- **The focus screen's accent is the app's blue, not a warm orange.** The running clock, the progress
  bar, the "current micro task" eyebrow, the kind chip, the answer label and the Complete task button all
  took `--warn`, which made the one screen the learner spends the most time on the only surface that was
  not the app's own colour — while the return card beside it and the plan's edge were already the accent
  blue. They take `--accent` now, and the tokens are named `--focus-accent*` because they no longer
  describe a warm hue.
- **The plan's rows are banded blue and white instead of tinted by task kind.** Every row carried its
  own kind's colour — the read blue, the practice purple or the quiz orange at 8% over the sheet — so a
  stack of tasks read as three washes interleaved, while the kind was already carried twice over by the
  4px left border and the row's glyph. The rows alternate now: the odd ones keep the row's own surface
  and the even ones take the accent blue at 10% over it, which measures `#ecf2fe` against `#ffffff` in
  the light theme and `#1f2837` against `#161a21` in the dark one. The banding follows a row's position
  rather than the task, so reordering keeps it a regular stripe, and the 4px edge takes the same accent
  blue on every row instead of the task kind's colour — the glyph is what still carries the kind.
- **The answer box and its two buttons share one line.** The button that asks the tutor and the one that
  brings a file in sat in a strip of their own under the box, which cost the task card a whole row for two
  controls that fit beside it. They are on the box's line now, bottom-aligned with it, and the reserved
  note line under them is untouched — reading a file still cannot move the box or the buttons beside it. A
  window narrow enough that the two cannot share the line drops them below the box instead of shrinking it
  to a sliver, which is the trade the notice's own answer row already makes.
- **Every page has the same vertical rhythm now, not just home.** `fl-home` was given a 22px column gap
  and the other three page elements were left as plain blocks, so the gap `.content` puts between pages
  stopped at the page boundary and the sections inside them sat flush: measured at 1280, the record
  screen's five sections began at 126, 178, 265, 351 and 441 with 0px between a section and the next
  one's title, the dashboard's at 389 and 499 with the first two touching, and the course page's header,
  course map, concepts and task table at 46, 129, 527 and 1088 with nothing between any of them. They all
  ask for the same rhythm now. Inside the pages the same treatment: cards carry 18px of padding rather
  than 16, panels 16/18 rather than 14/16, grid gaps 16px rather than 12, the concept cards and their key
  points are spaced instead of stacked, the micro-task table's rows are 63px rather than 55, and the
  event log's rows are 10px apart rather than 7 — where a row's two hairlines sat closer to its text than
  the rows sat to each other. The record screen's weekly lines also stopped welding their parts together:
  Angular drops whitespace-only text nodes, so a row of label, value and evidence rendered as
  "给出的帮助289289 次观察", and the three parts now carry the gap the markup never had.
- **The import form says what it needs, and no longer ships demonstration text.** The text box arrived
  holding a paragraph of the demo course, which made the button live before the learner had brought
  anything — and what that paragraph imported was a second course called "Rotations" that nobody asked
  for. The box is empty and prompts for the text instead, and the button stays off until the form has all
  three things it needs, each stated under it in words rather than answered by the main process: a name
  ("Give the file a name first."), a name the parser can read ("Use a .txt or .md name."), and something
  to import ("Drop a file, or paste the text first."). The last of the three is also what the paste box is
  for, and it is not decoration: it is the only way in for material that is not a file — notes copied out
  of a page, a chat or a PDF viewer — which is what the file chooser was later added on top of, so its
  label now says so ("Or paste text instead of a file"). The line under the button reports the import
  that was just sent and nothing earlier: it is cleared as the import goes out rather than left standing
  until the next answer arrives, because a line still carrying the previous import's counts describes
  material the form no longer holds — which is what a second import showed while its own answer was in
  flight, and what an import that came back with nothing left behind as its result.
- **The dashboard keeps to the numbers, and the record has a screen of its own.** The plan's rows are
  all the same height: the estimate is written on each row rather than drawn as a length, which is what
  made a five-task plan read as a chart and a two-minute task as a hairline — and an even column is what
  makes a row findable again after a reorder. On the dashboard, re-engagement and progress after an
  interruption have their own section instead of sharing the session's row, because they answer a
  different question and are counted from a different set of events. The week's evidence, the
  intervention and rescue results, the browser bridge's pairing details and the folded event log moved to
  **More data** (`#/more`), one click from the dashboard — none of them is a number the learner acts on
  while studying, and the log has to be a screen rather than a dialog because a change offer is confirmed
  in a modal that the log is read through.
- **The focus screen's bottom slot is the return card, and nothing else.** It used to be a three-way
  strip: a resume card, the agent's suggestion with three quick choices, and an expired-timer offer. Two
  of the three were second copies of controls already on the screen the learner was reading — the three
  choices are `cannot-start`, `too-big` and `tired`, which are three of the six reasons the step's own
  Ask-for-help control already offers, and an expired commitment is already answered by the control that
  turns into "+1 minute" for exactly that phase. Both are still reachable: the agent's card is drawn in
  the step's control row, where it is one more item of the row rather than a strip over the box, so it
  cannot cover the buttons it belongs beside; the expired clock keeps its offer on the clock's own
  control. What is left at the bottom is the one genuinely interruptive case — you have just come back
  from somewhere else and your place has to be found for you. Answering the card now empties the slot
  instead of falling through to a second question, and the keyboard is handed to the stage rather than
  left on the document, which is what the notice's own reclaim can no longer do once it unmounts.
- **The tutor is asked with three buttons instead of six.** Explain this, Give me a hint and Check my
  answer: the three moments one step can put a learner in — not understanding it, not being able to
  start it, and having written something they want judged. The other three modes (`EXAMPLE`, `SOCRATIC`,
  `SUMMARIZE`) are still in the contract and still reached from where they belong, but a picker that
  lists everything the contract can express makes the learner read a menu before they can ask anything.
- **The folded sidebar hands its column back on the focus screen, symmetrically.** With the sidebar away,
  the focus workspace used to keep the open sidebar's whole column — `padding-left: 256px`, the 232px track
  plus the base padding — so that the hover-peeked panel could only ever slide over an empty gutter, and the
  stage never reflowed into the space it had just been given. The price was a 256px band of nothing down the
  left of the one screen the learner is meant to be looking at: at a 1140-wide window the stage was 822px
  wide. Now the column's inset is `clamp(62px, 5vw, 68px)` on **both** sides — the floor clears the floating
  recall button, and the equality is what centres the stage at every width (the old shape was a fixed 62 on
  the left against a `5vw` right, which differed by a few pixels at most widths). Nothing moves when the
  pointer rests on that button, because the peek still lifts the panel out of the grid rather than reflowing
  the page; what changed is what it covers. The panel now covers the stage's left edge on a window narrower
  than about 1370px, which is what a drawer over a page does, and it never covers the countdown, which sits
  in the stage's right-hand column.
- **The session's own row is a row.** The state label, the ambient toggle and the end button had no layout
  rule at all: three inline things in a plain block, so the space between them was whatever the whitespace
  happened to make, and the type was two sizes because the toggle carried `btn--small` at 12px while the
  other two inherited the body's 14px. They are one size now, with 14px between them.
- **The focus screen stopped wasting the row it has.** The type scale is one scale again: the step's
  title tops out at 36px instead of 46, the instructions and the fine print under the box are 13px
  rather than inheriting body size (a class-plus-element rule was out-specifying `.muted.small`), and the
  labels above them are 12px. The stage's own padding is a third of what it was, the row above the box
  is 12px instead of 18, and the box's explanatory line is still revealed on focus rather than printed
  under an empty field — which together are what stopped a 1000px-tall window scrolling to reach the
  buttons.
- **The plan says what its own shape means.** The blocks were transparent in the sheet, so a
  proportional block — the encoding that answers "how long will this take" for someone who cannot
  estimate it — read as a list with gaps in it. They now fill with their kind's colour, carry their kind
  down the left edge, and a legend line under the summary says what the height is. The reorder grip's
  dots also stopped floating in the middle of a long block: a `button` centres its content, and this one
  is stretched to the row's full height.
- **The clock reads as one instrument at three sizes.** The value and the paused state were two grid rows,
  so they were centred _as a pair_ — the time sat above the middle of a circle drawn around it, and the two
  lines crowded each other the shorter the dial got. The time is now on the centre line, the state is
  pinned inside the lower third, and the type is sized from the dial (`cqw`) rather than the viewport.
- **The notice is a notice, and it does not fight the plan.** It carries the accent its card already had
  — accent border, an accent edge, the large shadow — instead of the neutral panel it was drawn as. It also
  stands down while the plan sheet is open: both live at the bottom of the window and they were painted
  through each other, and the learner who asked for the plan is looking at the plan. Hidden, not dismissed.
- **The tutor panel no longer re-opens itself on the next step.** A "check my answer" request left on the
  signal was remembered inside the panel component — which is created and destroyed with the step it sits
  in — so the next step's panel found it, opened over the new step and quoted the answer the learner had
  written for the previous one. The request is cleared when it is consumed, which is what makes "once"
  mean once.
- **The long resume names the key idea instead of asking for a recall (#193).** The long card's
  refresher said "Take 30 seconds to recall the key idea before continuing" — a demand on a card
  that showed no idea and let Continue through immediately. It now carries the concept's own idea,
  selected by the same function that grounds a HINT (summary, else first key point, with the guard
  that rejects text merely repeating the task), bounded like the step beside it, taken from the
  context and never generated; when nothing is quotable the card carries no refresher rather than a
  demand. The 30-second parameter is gone from both locales, and the epic's wording and the wiki's
  AG5 entries now say what the code does.
- **The long resume can be reached without waiting a day, and its result reaches the screen (#192).**
  The simulator's `return` takes an optional `durationMs`, so a test says how long it was away instead
  of waiting it out; the demo's own 30 seconds is unchanged when nothing is given. The new e2e reads
  the boundary from `DEFAULT_RESUME_POLICY_CONFIG` rather than restating it, and asserts the refresher
  only the long card carries. The handler also pushes the result to the renderer: previously a
  simulation the renderer had not clicked itself stayed invisible until some unrelated transition
  pushed an update, which is why the card could be offered by the engine and never appear.
- **The resume step number says whose order it counts, and the next task follows the plan (#194).**
  `LearningCheckpoint.currentStep` and `AgentContextCheckpoint.currentStep` are now `courseStep`: the
  one-based position in the course's own order, which is the list the "of 7" also counts. The learner's
  reorder cannot answer that question — the plan deliberately excludes the running task, so it has
  nowhere to put the task the checkpoint is about — and both numbers are now computed from the same
  sorted list, so the agent's `task.step` and the checkpoint's `courseStep` cannot disagree. The
  question the reorder _can_ answer, "which task comes next", now follows it: `firstIncompleteTask`
  reads `session.taskOrder`, so the resume card's next task is the one the focus screen offers. The
  one rule for that reading moved to `shared-types` with its tests, so the plan and the checkpoint
  cannot drift into two plans. The stored column keeps its name, so no migration.
- **The short resume is asserted on screen for what it is.** A short interruption lists one item per
  column even when more is done; the golden path only ever checked that a card appeared, so the one
  tier an e2e can actually reach was not pinned. (#192)
- **Resuming after a rescue comes back to the step, not the task.** When a rescue has narrowed or split
  the current task, the resume card is now built from the task as the learner is being served it: it
  shows the step (`You were on: …`) and its own estimate, instead of the stored task's title and
  minutes. Previously the card promised 3 minutes over a screen showing 2, because the resume path read
  the stored row while the focus screen was served the narrowed one. The policy still reads the
  authored task — its overrun rule asks about the plan the course states, and moving that question is a
  separate decision. (#191)
- **The agent-context event projection is exhaustive by construction (AG1.2).** Every learning event
  type in `LEARNING_EVENT_TYPES` must have an explicit projection: adding one without deciding what an
  agent may be told about it is now a compile error (the `default` branch is `never`, as the state
  machine's switch already was) and a failing test (the spec's expectation map is keyed by the union).
  previously such an event was dropped from every context with only a count in the omissions. (#97)
- **One rule decides whether the developer surfaces appear, and it is tested.** The simulator bar and
  the context inspector asked the same question with the same copied expression; both now call
  `developerModeEnabled(runtime)`, which is `false` for a packaged build and for an answer that has not
  arrived yet. Absence from a learner's screen used to be two files agreeing; it is now a tested rule.
  (#98)
- **The eval suite covers what the rescue actions actually do.** `agent-evals` gains eight fixtures for
  the MICRO_START/SIMPLIFY rewrite (through the production builder, read back through
  `applyTaskRewrite`, with the original task's text forbidden in the output) and eight for what a HINT
  or an EXAMPLE quotes, including the cases where there is deliberately nothing to quote. (#173)
- **Stuck rescue: HINT and EXAMPLE quote your own concept and material.** An accepted HINT shows the
  idea behind the step (the concept summary, else its first key point); an accepted EXAMPLE shows a
  passage of your material (else a key point). The text is taken from what the agent context already
  carries, so it works offline, is never generated, and is not stored. A card with nothing to quote
  keeps its fixed steps. (#170)
- **Stuck rescue: the dashboard says how each rescue went.** A new "How rescues went" section shows,
  per action, how many accepted rescues helped (a Continue or progress on the task), how many were
  followed by another request for help, how many showed no progress, and how many are still inside
  their window. It is recomputed from the event log on every read, so nothing new is stored. (#173)
- **Desktop shell: the sidebar folds completely.** The sidebar's own toggle collapses it; a small
  floating brand button in the top-left corner recalls it — during focus too. While a focus
  commitment runs, the sidebar now folds away entirely instead of shrinking to a 64px icon rail,
  and leaving the focus screen forgets a recall but keeps a deliberate collapse. Hovering the
  recall button peeks the sidebar out over the untouched content — the fold gives the content its
  own column and keeps it, so the panel can only ever cover it — and moving the pointer away folds
  it back; clicking the peeked panel pins it open. On the focus screen the fold leaves the
  workspace's column in place, so the peeked panel only ever slides over the gutter it vacated and
  the countdown never reflows under it.

### Fixed

- **An empty provider account is reported as an empty account, not as a malformed reply.** The nightly
  `llm-live` gate went red the day after its secrets were added and printed one line:
  `{"provider":"compatible","ok":false,"reason":"bad-response"}` — which reads as a broken adapter, and
  was in fact the endpoint answering **HTTP 402 Insufficient account balance**. `mapStatusToReason` had no
  name for it: every status that was not 401/403/429 fell through to `bad-response`, the reason the retry
  policy classifies as a deterministic contract violation, so a billing problem looked exactly like a
  malformed body — on the completion path, during model discovery, and in the learner's own Test connection
  button. `ProviderFailureReason` gains `quota-exceeded`, terminal like `unauthorized` because only a human
  topping the account up clears it (429's window moves on its own); the completion, streaming and discovery
  paths share one `mapStatusToReason` so a status cannot mean two things in one workspace; `ProviderError`
  carries the numeric status it came from; and the smoke script prints it, so the same failure now reads
  `{"reason":"quota-exceeded","status":402}`. Reproduced against the live endpoint before the change:
  `/models` answers 200 while every completion answers 402 `insufficient_balance`, and the adapter reports
  it as `quota-exceeded` carrying the status and no key, body or URL. The interface has a sentence for that
  reason in both locales, so it sends the reader to the account balance rather than to the model ID.
- **Three transitive advisories are pinned out of the tree.** Dependabot reports fourteen, and none of
  them is reachable from the app's own code: `nx` pins `axios` (nine of the fourteen) and `smol-toml`,
  and `source-map-js` arrives through vitest's coverage instrumentation. Three of the four packages
  have published fixes inside the major the tree already resolves, so `pnpm-workspace.yaml` overrides
  them and the lockfile follows — `axios` 1.18.1 → 1.20.0, `smol-toml` 1.6.1 → 1.9.1, `source-map-js`
  1.2.1 → 1.2.2 — and dropping an entry is one line once its parent moves. The other two are left
  alone on purpose: `brace-expansion`'s fix is 5.0.12 where the `minimatch` 3 that electron-builder's
  asar tooling calls expects the 1.x API, and `sprintf-js` has no fix published at all (it is reached
  through `mammoth`, which the document reader depends on). Forcing either would be a behaviour change
  made to silence a report, so both stay open and are named here rather than quietly dismissed.
- **Study time no longer depends on how often the app wrote an event.** The insights timeline capped
  every stretch at the idle threshold, so the same ten minutes of reading counted as ten with an event
  every two minutes and as two with only a start and an end, and a witnessed absence was credited in full
  — which put twenty-two hours of 离开中 into a session left overnight. The timeline is the single source of
  truth now: replaying the reducer gives the state at every instant, a stretch bounded by two events is
  credited **whole** while it is study time (`FOCUSED`, `RESUMING`, `CONFUSED`, `OVERLOADED`), so splitting
  it with another event cannot change the total, and a state that is not study time is bounded everywhere,
  so a night away cannot read as a day of study. Only the unobserved tail after the last event of an open
  session is capped, at a new `presenceTimeoutMs` that is deliberately separate from the state machine's
  `idleThresholdMs` — changing what the engine calls idle no longer changes how much study time is
  recorded. Additivity is pinned by tests: ten minutes with two events and with twenty must agree, and a
  session split at local midnight must sum to the whole.
- **The return card no longer lands on the plan.** The notice's row and the plan share the bottom of the
  focus screen, and the lift that keeps the step clear of the card measured only the step. At 1280x800
  with the card up the plan's trigger sat 26px behind the notice's top edge, and opening the sheet put
  every one of its four rows behind the card, so the press looked like it had done nothing. The stage's
  floor is the plan now — the open sheet when there is one, the trigger otherwise — so the lift clears it
  with a 16px gap, and the sheet's own open and close are watched as well as the card's height, because
  opening the sheet moves the floor without resizing the card. Closing the sheet scrolls back to the step,
  whose title the closed case still protects: on a window shorter than the app's own minimum the title is
  what keeps its place and the trigger waits a scroll. Measured with the card up: the trigger clears at
  1280x800, 1157x732 and 1024x768, and the open sheet's rows are all above the card at every one of them.
- **The wiki publishes without a secret, because it never needed one.** `wiki-sync.yml` required a
  `WIKI_SYNC_TOKEN` repository secret and, without it, did nothing but print a notice on every change
  under `docs/wiki/`. The premise — "the default token cannot push to the wiki repository" — came from
  passing `$GITHUB_TOKEN` out of the _ambient_ environment, where it is empty (its length in a `run:`
  step is 0); an empty credential produces exactly the rejection that was read as "no permission".
  `secrets.GITHUB_TOKEN` is populated, and with `permissions: contents: write` it pushes to
  `<repo>.wiki.git` — measured by pushing a scratch branch of this wiki with that token (exit 0) and
  deleting it in the same run. So the requirement, the guard and the notice are gone and the pages
  publish on every change.
- **`WIKI_SYNC_TOKEN` is an override, never a requirement — learned from breaking the wiki with it.**
  It is honoured when it is set, and preferred when it works; the built-in token publishes when it does
  not. That ordering is not a nicety. Preferred _unconditionally_, an override turned a working wiki
  into a failing workflow the day a token GitHub did not accept was pasted in: three red runs and no
  pages published, which is the opposite of what insurance is for. A rejected override now costs a
  warning and nothing else — the run stays green, the wiki publishes with the built-in token, and the
  run summary names the credential that was used, so a wrong secret is visible without being fatal.
  Two related facts are measured rather than reasoned: precedence itself (the log names the override
  when the secret works), and `GIT_TERMINAL_PROMPT=0`, without which a rejected credential is reported
  as `fatal: could not read Username for 'https://github.com': No such device or address` — true, red,
  and pointing at the network rather than at the secret.

- **A secret that never received its token now says so, instead of blaming permissions.** Two faults
  wore one message: a credential that was _rejected_ — expired, revoked, unable to write — and a secret
  whose value was never a credential at all. The second turned up in the wild: a `WIKI_SYNC_TOKEN`
  holding a single non-alphanumeric character reported "The credential was rejected by the wiki
  repository", which is true, and which sends the reader off to check scopes when the paste is what
  failed. That branch now reports the stored value's length and the absence of a `ghp_` /
  `github_pat_` / `gho_` / `ghs_` prefix instead, and the snippet in `docs/publishing.md` that sets the
  secret refuses to store anything shorter than 20 characters — so the mistake cannot reach the
  workflow in the first place.
- **The focus screen's header had two rules under it.** The header row ends in a 1px border and the
  progress strip began with a 1px border of its own, with the stage's 30px of padding between them: two
  parallel lines with an empty band in the middle, measured as borders at y=97 and y=128 — the stray
  rule the learner sees as a line that means nothing. The strip keeps its padding and loses the rule, so
  the header's own underline is the only line there.
- **The focus column sat 5px left of the window's centre while a step ran.** The focus screen's insets are
  the same on both sides on purpose, and the scroller's own scrollbar — 5px wide — comes out of the right
  one, which moved the workspace, the task and the plan sheet off the centre line together: measured at
  1264x801 with a step running, the plan sheet was 199.5px from the left edge of the window and 204.5px
  from the right, against the 2px the suite that calls it centred allows. The gutter is still _reserved_
  rather than waited for, because that is what keeps the column from jumping sideways the moment a step
  makes the page scrollable; the right padding gives the same 5px back instead, read from
  `--dsh-scrollbar-width` so the padding and the scrollbar cannot drift apart.
- **The import refuses a name it cannot read, in words, instead of reporting the channel.** A file
  dropped on the home page's zone — or a name typed beside pasted text — whose extension the parser
  does not know (`.rst`, `.pdf`, or none at all) used to travel to the main process and come back as
  `Error invoking remote method 'focusloop:material:import': MaterialParseError: Cannot determine a
supported format for outline.rst.`: a channel name, an error class, and nothing a learner can act
  on. The renderer now applies the parser's own rule where the mistake is. A dropped or chosen file is
  refused on the zone beside the other three refusals ("That file is not a .txt or .md file."), before
  it is read at all, and the Import button stays off under the field with "Use a .txt or .md name."
  while the name is unreadable — the same treatment an empty name has had since the channel error for
  that one was removed. The hint beside the field also stopped over-promising: it said "The course
  takes this name." while a Markdown document with its own `# heading` has always been titled after
  the heading, so a file named `sweep-notes.md` containing `# Sweep notes` was never going to be
  "sweep notes". The chooser's own filter now lists what the parser reads (`.txt`, `.text`, `.md`,
  `.markdown`, `.mdx`) rather than a shorter list the app would then argue with, and the whole page —
  the current-session card, course cards, the getting-started block and all four refusals — is pinned
  by the new `apps/desktop-e2e/tests/home.spec.ts`.
- **The notice no longer lands on the step's own controls, and the focus screen has one scroller.** With a
  notice up, the frame around it was sized by `height: calc(100dvh - 48px)` while the column it stood in
  carried 18px of padding at the top, 96px at the bottom and a 22px gap before it — so the frame was taller
  than its box, the _page_ scrolled as well as the stage, and at 1140x767 the frame sat 15px above the
  window's top edge with the notice stopping 62px short of the bottom. Worse, the row the learner was about
  to press ended up behind the notice's edge: measured with a decision notice up at 1140x767, the step's
  controls were 48px under the notice's top edge — and the test that exists to catch exactly that was
  scrolling the step into view itself before measuring, so it agreed with the app that all was well. The
  frame is now laid out rather than calculated (the column's flex item is allowed to be shorter than its
  content, and the workspace fills it), and the page puts the step's controls clear of the notice by the
  measured intersection, re-measured through a resize observer because the row is filled in several passes
  and its first frame is zero pixels tall. The test no longer scrolls anything itself.
- **The courses the app writes itself are written in the learner's language, not in English.** A
  Chinese window around a course generated from Chinese notes still read `Read: 模拟调制` and
  `Explain "模拟调制" using a concrete example you invent yourself.`, and the built-in course was
  English end to end — the app's own sentences, in the two places the "the renderer owns the wording"
  rule had not reached. `agent-core` now takes the wording as an argument (`TaskCopy`, `DemoCopy`) and
  the shell supplies it from the locale the store already holds, so a heading or a sentence from the
  learner's own notes is still theirs and everything around it follows the interface. Switching
  language re-writes both the built-in course and every course the app generated, straight away rather
  than at the next restart — the ids those rows are keyed by come from the material, so a running
  session, its completions and its checkpoints still point at the same step, and the order the learner
  dragged their steps into belongs to the session rather than to the course. Four Chinese strings that
  had kept the English word `Agent` now say 智能体.
- **A button that cannot be pressed now looks like one.** The tutor's Ask is disabled until a mode and
  a question are both there, and nothing in the stylesheet made a disabled control look disabled: it
  kept its full contrast and its pointer cursor, so a press that could not happen read as a press that
  did nothing. Disabled controls are dimmed, take a `not-allowed` cursor and no longer light up on
  hover, and the tutor panel names the half of the request that is still missing rather than leaving
  the learner to guess which one it is.

### Known limitations

- This is an alpha preview; workflows and interface details may change before a stable release.
- Course material import accepts text and Markdown. PDF, Word and image extraction is available
  for **answer attachments**, not course import.
- Remote tutor and rescue responses require your own API key and provider credit. Compatibility
  covers Chat Completions and SSE; native Anthropic/Gemini protocols, the Responses API and
  subscription login are not supported.
- Windows installers are unsigned. macOS bundles use ad-hoc signing and are not notarized, so
  downloaded applications may require approval in the operating system's security settings.
- The release workflow targets Windows and macOS, each in x64 and arm64, plus the browser
  extension ZIP and checksums. It does not produce a Linux installer.
- Daily reminder delivery depends on the operating system's scheduler and notification permissions.

## [0.1.0-demo] — 2026-09-17

The first demonstrable end-to-end slice. FocusLoop does not diagnose ADHD; it tracks the learning
interaction and helps the learner resume.

### Added

- **Desktop shell** — Electron main process with an Angular renderer, `contextIsolation: true`,
  `nodeIntegration: false` and `sandbox: true`.
- **Typed IPC bridge** — a closed whitelist of channels exposed as `window.focusloop`, with
  argument validation re-run in the main process.
- **Local persistence** — SQLite via Node's built-in `node:sqlite`, append-only migrations and
  repositories for courses, concepts, micro tasks, quizzes, materials, sessions, events,
  checkpoints, interventions, outcomes and resume-card timings.
- **Learning state engine** — a pure, deterministic reducer over eight states
  (`READY`, `INITIATION_FRICTION`, `FOCUSED`, `CONFUSED`, `OVERLOADED`, `DISTRACTED`,
  `INTERRUPTED`, `RESUMING`) driven entirely by events. No LLM is involved in judging state.
- **Learning checkpoints** — the learner's cognitive position: concept, goal, mastered, unresolved,
  current step, friction state and next best action.
- **Interruption detection** — configurable tab-left and idle thresholds, plus time-based
  evaluation for the case where no event arrives.
- **Resume engine and Resume Card** — a rule-based card that restores context, with recorded
  `shownAt` / `acceptedAt` / `dismissedAt` / resume latency.
- **Intervention policy v1** — rule-based, explainable, with `NO_ACTION` as a first-class answer,
  a session budget, a cooldown, urgency-based escalation, and `HELP_REQUESTED` overload detection.
- **Intervention outcome logging** — accepted, dismissed, task completed, resume latency and quiz
  outcome, aggregated for the dashboard.
- **Dashboard** — session duration, micro-task completion, interruption count, average resume
  latency and per-action intervention outcomes.
- **Material import** — `.txt` and `.md` parsed into a normalised document, with deterministic
  concept and micro-task generation (mock mode is reproducible).
- **Built-in demo course** — "Red-black trees: the basics": 4 concepts, 5 micro tasks, 2 quizzes and
  a scripted interruption fixture. Written for this project so it ships without attribution debt.
- **Demo Event Simulator** — distraction, return, confusion, overload and success. Available in
  development builds, hidden in packaged builds.
- **Manifest V3 browser bridge** — tracks tab activation and idle state only. It requests no page
  access at all, so it cannot read URLs, titles, text, input or cookies.
- **Loopback bridge server** — binds to `127.0.0.1`, requires a per-run token compared in constant
  time, schema-validates every message, and applies each event id at most once.
- **Degraded mode** — no network, no API key, provider timeout or a disconnected extension all
  keep the golden path working.
- **Provider abstraction** — `MockAIProvider` (default, offline, deterministic) and an optional
  DeepSeek adapter behind the same interface.
- **Windows packaging** — NSIS installer, extension zip and checksums.
- **Bilingual interface** — English and Simplified Chinese, switchable from the sidebar. The domain
  emits message keys and interpolation params rather than prose; the renderer owns the wording, so
  there is one bilingual implementation rather than two. A missing translation is a compile error,
  and a test asserts that both languages use the same placeholders.
- **Insights dashboard** — the dashboard re-aggregates over this session, today, the last seven days
  or all time: total and daily-average time, a focus ratio, a ring of time by learning state, a
  daily activity grid, a per-course breakdown, and the share of the window that was actually on
  task. Everything is rebuilt from the event log by replaying it through the real state machine, so
  the charts cannot disagree with the engine; silent stretches are capped by the engine's own idle
  threshold rather than counted as focus.
- **Light and dark themes** — the theme preference is `system`, `light` or `dark`, switchable from
  the sidebar. Every colour comes from a token, so a theme is one block of overrides rather than a
  hunt for hardcoded hexes; `system` re-resolves live when the OS setting changes, and the window
  background follows the OS so there is no flash before the renderer paints.
- **A shell that uses the room it has** — the sidebar carries an ambient _today_ summary (total
  time, a ribbon of the time by state, and the day's task and interruption counts) rather than
  leaving a hole under a three-item nav, and it is pinned above the state chip so the bottom of the
  sidebar is one cluster instead of one lonely pill. It always reports _today_, whichever window the
  dashboard is showing, which is why it fetches its own summary rather than borrowing the
  dashboard's. The content column is capped at a measure and centred, so a wide window gets a
  readable column instead of cards stretched edge to edge, and the donut and its legend wrap
  instead of ellipsising every state name at the minimum window width.- **A folded event log** — consecutive events of the same type and source collapse into one row
  (`HELP_REQUESTED ×3`) with a time span when the run is wider than an instant, and the rows are
  hairline list rows rather than one bordered card per event. Only _adjacent_ repeats fold, so an
  unrelated event in between keeps the two runs apart instead of inventing an order that never
  happened. This also fixes two log defects found while testing: reopening the app showed "No events
  recorded yet" for a session that had plenty, and ending a session left its log on screen.- **Quality gates** — ESLint (flat config), TypeScript strict mode, Vitest, Playwright and GitHub
  Actions.

### Known limitations

- PDF import is not implemented (`.txt` and `.md` only).
- The state engine's thresholds are configurable in code, not yet in the UI.
- The packaged installer is unsigned, so Windows SmartScreen will warn on first run.
- The extension currently reports tab changes only; it does not yet send an origin.
- Two interface languages ship (English, Simplified Chinese). Adding a third means adding one
  dictionary file — but the wording itself is not yet user-editable or community-translated.
