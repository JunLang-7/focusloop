/**
 * English wording.
 *
 * This file *is* the definition of the message key set: `MessageKey` is derived
 * from it, and every other locale is typed as `Record<MessageKey, string>`. That
 * is what makes a missing translation a build failure instead of an English
 * sentence leaking into a Chinese screen.
 *
 * Placeholders are written `{name}` and interpolated by `I18nService.t`.
 */

const en = {
  // ------------------------------------------------------------ application
  'app.tagline': 'learning continuity',
  'app.nav.home': 'Home',
  'app.nav.focus': 'Focus Session',
  'app.nav.dashboard': 'Dashboard',
  'app.navigation': 'Main navigation',
  'settings.title': 'Settings',
  'settings.close': 'Close settings',
  'settings.sections': 'Settings sections',
  'settings.general': 'General',
  'settings.models': 'Models',
  'settings.languageHint': 'Choose the language used throughout the app.',
  'settings.appearance': 'Appearance',
  'settings.themeLight': 'Light',
  'settings.themeDark': 'Dark',
  'settings.themeSystem': 'Follow system',
  'settings.materialHint': 'Show the original material alongside your learning steps.',
  'settings.data': 'Local data',
  'settings.dataHint': 'Manage the local storage folder and remove app-owned data.',
  'app.connecting': 'connecting…',
  'app.mode.offline': 'offline mode',
  'app.mode.network': 'network mode',
  'app.mode.degraded': 'degraded mode',
  'app.language': 'Language',
  'app.language.switch': 'Switch interface language',
  'app.theme': 'Theme',
  'app.theme.switch': 'Switch theme',
  /*
   * The data controls (#10). The path itself is not in the dictionary: it is whatever the main
   * process resolved, and a translated path would be a lie about where the data is.
   */
  'app.data': 'Your data',
  'app.data.open': 'Open folder',
  'app.data.delete': 'Delete everything',
  'app.data.openFailed': 'The system file manager did not open the folder.',
  'app.data.locked':
    'The database is open in another program, so nothing was deleted. Close that program, then try again.',
  'app.data.failed':
    'Nothing was deleted. FocusLoop could not remove the file, so your data is still there.',
  'app.data.deleted': 'The database has been deleted.',
  'app.data.leftBehind': 'These files could not be removed and may still hold your data: {files}',
  'app.data.unavailable':
    'FocusLoop could not open its database again. Restart the app to keep using it.',
  'app.data.confirm.title': 'Delete everything FocusLoop has stored?',
  'app.data.confirm.course': 'Your courses, and the material they were generated from.',
  'app.data.confirm.sessions': 'Every session, event, checkpoint and progress record.',
  'app.data.confirm.settings': 'Your language, theme and display settings.',
  'app.data.confirm.path': 'This deletes the database in {path}.',
  'app.data.confirm.irreversible':
    'FocusLoop keeps no copy anywhere else, so this cannot be undone.',
  'app.data.confirm.cancel': 'Keep my data',
  'app.data.confirm.action': 'Yes, delete everything',

  // The sidebar fold. Both are buttons, so a screen reader needs the verb rather than the
  // state: the floating button, and the sidebar's own toggle whenever the sidebar is
  // folded, say "show"; the toggle says "collapse" while the sidebar is docked.
  'app.sidebar.collapse': 'Collapse sidebar',
  'app.sidebar.expand': 'Show sidebar',

  // The persistent sidebar summary. Deliberately not the dashboard's wording:
  // this one has to read at 11px in a 232px column.
  'app.today': 'Today',
  'app.today.empty': 'Nothing recorded today.',
  'app.today.ribbon': 'Today by state',
  'app.today.tasks.one': '{n} task done',
  'app.today.tasks.other': '{n} tasks done',
  'app.today.interruptions.one': '{n} interruption',
  'app.today.interruptions.other': '{n} interruptions',

  // The theme preference, not the resolved theme.
  'theme.system': 'Auto',
  'theme.light': 'Light',
  'theme.dark': 'Dark',

  // --------------------------------------------------------- learning state
  'state.READY': 'Ready',
  'state.INITIATION_FRICTION': 'Getting started',
  'state.FOCUSED': 'Focused',
  'state.CONFUSED': 'Confused',
  'state.OVERLOADED': 'Overloaded',
  'state.DISTRACTED': 'Away',
  'state.INTERRUPTED': 'Interrupted',
  'state.RESUMING': 'Resuming',

  // ----------------------------------------------------------------- home
  'home.eyebrow': 'Home',
  'home.title': 'Keep your learning continuous',
  'home.subtitle':
    'FocusLoop helps you resume where you stopped thinking — not just where you stopped scrolling.',
  'home.current.title': 'Current session',
  'home.current.untitled': 'Untitled course',
  'home.current.meta': '{completed} / {total} micro tasks · {elapsed} · state {state}',
  'home.current.continue': 'Continue session',
  'home.empty': 'No session running. Pick a course below to begin.',
  /*
   * How to use the app (#21), shown only while nothing is running.
   *
   * Every step names a control the learner can actually see, where they will see it: the course card's
   * own button, then the "Next small step" card on the focus screen. The first version said "start one
   * micro task from the plan", which sent them to a panel that starts closed and is not on the path at
   * all, and it ended by claiming one finished step was a finished session, which the app does not
   * implement. The e2e checks the second step against the button's own label, so that wording and that
   * control cannot drift apart; the first and third steps are prose, and nothing ties them to a label.
   */
  'home.start.eyebrow': 'Getting started',
  'home.start.title': 'One session, in three steps',
  'home.start.step.course': 'Pick a course below.',
  'home.start.step.session': 'Press Start session on its card.',
  'home.start.step.task': 'On the focus screen, start the next small step it shows you.',
  'home.start.back':
    'Stop whenever you like. Coming back later is the point, not a failure: where you left off is kept.',
  'home.courses.title': 'Courses',
  'home.courses.meta': '{concepts} concepts · {tasks} micro tasks',
  'home.courses.view': 'View course',
  'home.courses.start': 'Start session',
  'home.courses.none': 'No courses yet.',
  'home.import.title': 'Import material',
  'home.import.hint':
    'Plain text and Markdown only. Imported material stays on this machine unless you configure a model key.',
  'home.import.fileName': 'File name',
  'home.import.content': 'Content',
  'home.import.contentPlaceholder': 'Paste or type the notes you want to keep here.',
  'home.import.action': 'Import',
  'home.import.placeholder': 'notes.md',
  'home.import.result': '{title}: {concepts} concepts, {tasks} micro tasks',
  'home.import.needFileName': 'Give the file a name first.',
  'home.import.needFormat': 'Use a .txt or .md name.',
  'home.import.needText': 'Drop a file, or paste the text first.',
  'home.import.drop': 'Drop a file here, or choose one',
  'home.import.dropNow': 'Let go to import it',
  'home.import.accepts': 'Text or Markdown · up to {limit}',
  'home.import.nameHint': 'The course takes this name, unless the text opens with a heading.',
  'home.import.remove': 'Remove file',
  'home.import.pasteSummary': 'Or paste text instead of a file',
  'home.import.reject.tooLarge': 'That file is over {limit}.',
  'home.import.reject.unsupportedFormat': 'That file is not a .txt or .md file.',
  'home.import.reject.empty': 'That file has nothing in it.',
  'home.import.reject.notText': 'That file is not plain text.',
  'home.import.reject.unreadable': 'That file could not be read.',

  // --------------------------------------------------------------- course
  'course.eyebrow': 'Course',
  'course.start': 'Start session',
  'course.concepts': 'Concepts',
  'course.tasks': 'Micro tasks',
  'course.col.order': '#',
  'course.col.task': 'Task',
  'course.col.kind': 'Kind',
  'course.col.estimate': 'Estimate',
  'course.col.status': 'Status',
  'course.minutes': '{minutes} min',
  'course.status.done': 'done',
  'course.status.open': 'open',
  'course.notFound': 'Course not found.',
  'course.back': 'Back to home',
  // ------------------------------------------------------ imported material
  // The text a concept was generated from, so the material can be read where the course is.
  'section.show': 'Show the text',
  // A preference rather than a fixed decision: the tasks stand on their own, and the full text is
  // there for whoever wants to read it in place.
  'app.material': 'Material text',
  'app.material.switch': 'Show the text you imported',
  'app.material.on': 'Shown',
  'app.material.off': 'Hidden',

  // ----------------------------------------------------------- model access
  // The model, and the honest sentence about what reaches it. Written as three notes rather than one
  // because the three states have three different truths, and a single reassuring sentence would be
  // false in two of them.
  'app.model.change': 'Model',
  'app.model.offline': 'Local only',
  'app.model.connected': 'Model verified',
  'app.model.configured': 'Model configured',
  'app.model.degraded': 'Model unreachable — using the offline fallback',
  'app.model.key': 'Model API key',
  'app.model.keyPlaceholder': 'Paste the key from your provider',
  'app.model.save': 'Save key',
  'app.model.clear': 'Remove key',
  'app.model.noKeychain':
    'Secure OS credential storage is unavailable. Use FOCUSLOOP_DEEPSEEK_API_KEY or FOCUSLOOP_OPENAI_API_KEY for the default endpoint instead.',
  'app.model.note.offline':
    'Without a key nothing leaves this machine: hints, examples and questions are answered by a built-in offline reply.',
  'app.model.note.online':
    'With a key, a hint, an example or your question sends that step’s text to the provider — nothing else, and never your database.',
  'app.model.note.environment':
    'A key from FOCUSLOOP_DEEPSEEK_API_KEY is in force and outranks anything saved here. Remove the environment variable to use a key saved in the app.',

  'llm.title': 'LLM Providers',
  'llm.compactSubtitle': 'Connect a provider and choose a model.',
  'llm.custom': 'Custom',
  'llm.chooseModel': 'Choose a model',
  'llm.modelPlaceholder': 'Enter a model ID or fetch the model list',
  'llm.editableModelHint':
    'Select from the list or enter any model ID. You can edit it afterwards.',
  'llm.searchModels': 'Search model ID or name…',
  'llm.refresh': 'Refresh',
  'llm.noMatchingModels': 'No matching models',
  'llm.otherModels': 'Configured models',
  'llm.newModel': 'New model',
  'llm.saveOnly': 'Save only',
  'llm.saveAndUse': 'Save & use',
  'llm.subtitle': 'Configure a provider, then choose the model you want to use.',
  'llm.close': 'Close',
  'llm.local': 'Use local only',
  'llm.noKey': 'No API key',
  'llm.configured': 'API key configured',
  'llm.inUse': 'In use',
  'llm.addProvider': 'Add provider',
  'llm.loading': 'Loading providers…',
  'llm.name': 'Provider name',
  'llm.providerType': 'Provider type',
  'llm.urlHint':
    'Include /v1 or your gateway prefix. Do not append /chat/completions. HTTPS is required except on loopback.',
  'llm.environment':
    'A provider-specific environment key takes precedence for this default endpoint. Remove it and restart to use the saved key, or choose local-only mode to stop remote calls.',
  'llm.urlChanged':
    'Changing the endpoint does not reuse its previous API key. Configure a key for the new address.',
  'llm.keepKey': 'Leave blank to keep the saved key for this URL',
  'llm.models': 'Models',
  'llm.fetchModels': 'Fetch models',
  'llm.fetchHint':
    'Uses only the configured endpoint and key; you can also enter a model ID manually.',
  'llm.discoveredModels': 'Available models · choose to auto-fill',
  'llm.autoFilled':
    'The selected model fills the first model row. You can edit its model ID, display name and compatibility options below.',
  'llm.modelsFetched': 'Models fetched. Select one to auto-fill, then edit and save as needed.',
  'llm.noModels': 'No models were listed. You can still enter a model ID manually.',
  'llm.addModel': 'Add model',
  'llm.modelId': 'Model ID',
  'llm.modelName': 'Display name (optional)',
  'llm.advanced': 'Advanced options',
  'llm.outputLimit': 'Maximum output tokens (optional)',
  'llm.tokenParameter': 'Output-limit parameter',
  'llm.removeModel': 'Remove model',
  'llm.save': 'Save configuration',
  'llm.clearKey': 'Remove saved key',
  'llm.delete': 'Delete provider',
  'llm.confirmDelete':
    'Delete this provider and its saved key? If in use, FocusLoop will switch to local-only mode.',
  'llm.cancel': 'Cancel',
  'llm.selectedModel': 'Model to use',
  'llm.testHint':
    'Testing sends only a fixed short prompt to this model and may incur a small API charge. It does not enable the model.',
  'llm.test': 'Test connection',
  'llm.use': 'Use this model',
  'llm.verified': 'Connection verified in this run',
  'llm.unverified': 'Not verified',
  'llm.saveFirst': 'Save your changes before testing the connection.',
  'llm.working': 'Working…',
  'llm.privacy':
    'Local-only mode makes no model requests. When enabled, only the current request text goes to your chosen endpoint. Keys are encrypted separately and never returned to the interface.',
  'llm.failed':
    'Could not apply the change. Check the fields and secure credential storage, then try again.',
  'llm.saved': 'Configuration saved. Press “Save & use” to enable it.',
  'llm.keyRemoved': 'Saved key removed.',
  'llm.removed': 'Provider deleted.',
  'llm.localActive': 'Local-only mode is now active. Your provider configurations are kept.',
  'llm.activated': 'The selected model will be used for new requests.',
  'llm.test.ok': 'Connection verified.',
  'llm.test.not-configured': 'Configure an API key first.',
  'llm.test.offline': 'Could not reach the endpoint. Check its address and your network.',
  'llm.test.timeout': 'The model did not respond before the timeout.',
  'llm.test.unauthorized':
    'The provider rejected authentication. Check the key and account permissions.',
  'llm.test.rate-limited': 'The provider rate-limited the request. Try again later.',
  'llm.test.bad-response':
    'The model returned an invalid response. Check the model ID and API compatibility.',
  'llm.test.busy': 'Another connection test is already running.',

  // ----------------------------------------------------------- course map
  // The whole course as one picture, and the exercise of putting it back from memory.
  'map.title': 'Course map',
  'map.hint': 'What this course is made of, in the order you will meet it.',
  'map.recall.title': 'Draw it again from memory',
  'map.recall.hint':
    'Write the concepts you remember, in your own words. The order does not matter.',
  'map.recall.label': 'Your map',
  'map.recall.score': 'You recalled {recalled} of {total}.',
  'map.recall.done': 'That is the whole map. It stuck.',
  'map.recall.missed': 'Not back yet',
  // Micro-task kinds. These are vocabulary, not data: the learner reads them.
  'kind.read': 'read',
  'kind.practice': 'practice',
  'kind.quiz': 'quiz',

  // ---------------------------------------------------------------- focus
  'focus.eyebrow': 'Focus session',
  'focus.untitled': 'Session',
  'focus.end': 'End session',
  'focus.state': 'State',
  'focus.elapsed': 'Elapsed',
  'focus.progress': 'Progress',
  'focus.started': 'Started',
  'focus.currentTask': 'Current micro task',
  'focus.taskMeta': 'about {minutes} min',
  'focus.nextTask': 'Next small step',
  'focus.startThree': 'Start for 3 minutes',
  'focus.continueNext': 'Continue with this step',
  'focus.readyHint': 'A small start is enough.',
  'focus.completeEyebrow': 'One step done',
  'focus.completedTitle': 'Nice. Keep the thread.',
  'focus.showPlan': 'Show full plan',
  'focus.hidePlan': 'Hide the plan',
  'focus.timerAria': 'Focus timer',
  'focus.pause': 'Pause',
  'focus.resume': 'Continue',
  'focus.addMinute': '+1 minute',
  // ----------------------------------------------------------- ambient layer
  // Generated rather than shipped: nothing to license, nothing to download, and it stops with the
  // session. Off until the learner asks for it (#57).
  'focus.ambient.on': 'Quiet sound: on',
  'focus.ambient.off': 'Quiet sound: off',
  'focus.ambient.hint': 'Generated noise, under the task',
  'focus.stuck': "I'm stuck",
  'focus.stuck.aria': 'What kind of stuck?',
  'focus.stuck.cannot-start': "I can't see where to start",
  'focus.stuck.do-not-understand': "Reading it isn't making sense",
  'focus.stuck.too-big': "It's too much at once",
  'focus.stuck.went-wrong': 'I tried it and it came out wrong',
  'focus.stuck.cannot-recall': "I knew this and it's gone",
  'focus.stuck.tired': "I haven't got the energy for it",
  'focus.stuck.unsaid': "I'd rather not say",
  'focus.paused': 'paused',
  'focus.notice.aria': 'Focus notice',
  'focus.notice.show': 'Show notice',
  'focus.notice.fold': 'Fold away',
  'focus.complete': 'Complete task',
  /*
   * The step's answer, and the quiz it may ask instead (#…).
   *
   * The two halves of the interaction the app was missing: a place to say what you came up with, and a
   * question that tells you whether you got it right. The wording says what the box is *for* — an agent
   * reads it later — rather than asking for homework, because that is the reason it is worth typing.
   */
  'focus.answer.title': 'What you came up with',
  'focus.answer.hint': 'It stays with this step, so the agent knows what you learned.',
  'focus.answer.placeholder.read': 'Say it in your own words…',
  'focus.answer.placeholder.practice': 'Write what you did, or what you got…',
  'focus.answer.placeholder.quiz': 'Write your answer…',
  'focus.answer.placeholder.recall': 'Say what you still remember…',
  'focus.answer.tooLong': 'Keep it under {count} characters.',
  'focus.answer.check': 'Have the tutor check it',
  /*
   * Bringing the words with you.
   *
   * One button rather than two: the picker offers documents and images side by side, and the learner
   * knows what is in the file they are about to choose. The lines after it name the file and say which
   * reader produced the text — the OCR one also says to check it, because a recognised character can be
   * wrong and only the learner can tell.
   */
  'focus.answer.attach': 'Attach a file',
  'focus.answer.source.read': 'Read from {name}. Edit it as you like.',
  'focus.answer.source.ocr': 'Recognised from {name} — check the words before you use them.',
  'focus.answer.source.cut': 'The box holds the beginning of {name} only.',
  'focus.answer.source.unsupported': '{name} is not a file this can read.',
  'focus.answer.source.tooBig': '{name} is too large to read.',
  'focus.answer.source.unreadable': '{name} could not be read.',
  'focus.answer.source.empty': 'There was no text in {name}.',
  'focus.quiz.title': 'This step asks a question',
  'focus.quiz.options': 'Answers to choose from',
  'focus.quiz.check': 'Check my answer',
  'focus.quiz.correct': 'Right — that is the answer.',
  'focus.quiz.incorrect': 'Not this one. The right answer is marked.',
  'focus.quiz.why': 'Why',
  'focus.quiz.answered': 'Answered',
  'focus.noTask': 'No task in progress.',
  'focus.upNext': 'Up next',
  'focus.startTask': 'Start',
  'focus.allDone': 'Everything in this course is complete.',
  // The plan states the total so the learner does not have to add up the blocks.
  'focus.plan.remaining': 'about {time} left',
  // The estimate sits on every row, so the legend only has to say what the block and the number are.
  'focus.plan.legend': 'Each block is one task, and the minutes on its right are the estimate.',
  /*
   * Reordering the plan (#23). The name is the action, because a screen reader announces it out of
   * context in a list: "Reorder Binary search trees" is what the row is for.
   */
  'focus.plan.reorder': 'Reorder {title}',
  'focus.plan.gripHelp':
    'Enter or Space moves it down, with Shift up, or use the up and down arrow keys, or drag it.',
  'focus.plan.moved': 'Moved {title} to position {position} of {total}',
  'focus.none.title': 'No session running',
  'focus.none.body': 'Start a session from a course to enter the focus workspace.',
  'focus.none.browse': 'Browse courses',

  // ------------------------------------------------------------ dashboard
  'dashboard.eyebrow': 'Dashboard',
  'dashboard.noSession': 'No session yet',
  'dashboard.subtitle': 'Only the numbers that tell you whether continuation worked.',
  'dashboard.refresh': 'Refresh',

  // The window switcher.
  'dashboard.range.label': 'Time window',
  'dashboard.range.session': 'This session',
  'dashboard.range.today': 'Today',
  'dashboard.range.week': 'Last 7 days',
  'dashboard.range.all': 'All time',

  'dashboard.hero.total': 'Recorded time',
  'dashboard.hero.daily': 'Recorded per day',
  'dashboard.hero.over.one': 'across 1 active day',
  'dashboard.hero.over.other': 'across {days} active days',
  'dashboard.focusRatio': 'Focused',
  'dashboard.focusRatio.hint':
    'Shares are of recorded time: silence is counted neither as time nor as being away.',
  'dashboard.session.title': 'This session',
  'dashboard.states.title': 'Recorded time by state',
  'dashboard.activity.title': 'Daily activity',
  'dashboard.activity.hint': 'Darker means more recorded time that day.',
  'dashboard.activity.empty': 'Nothing recorded in this window yet.',
  'dashboard.activity.busiest': 'Busiest: {date} · {time}',
  'dashboard.window.tasks': 'Tasks done',
  'dashboard.window.interruptions': 'Interruptions',
  'dashboard.window.sessions': 'Sessions',
  'dashboard.courses.title': 'Recorded time by course',

  // Short unit labels for the chart legends.
  'unit.s': '{s}s',
  'unit.hm': '{h}h {m}m',
  'unit.m': '{m}m',

  // Index 0 is Sunday, to match `Date.getDay()`.
  'weekday.0': 'Sun',
  'weekday.1': 'Mon',
  'weekday.2': 'Tue',
  'weekday.3': 'Wed',
  'weekday.4': 'Thu',
  'weekday.5': 'Fri',
  'weekday.6': 'Sat',

  'dashboard.duration': 'Session duration',
  'dashboard.tasks': 'Micro tasks',
  'dashboard.interruptions': 'Interruptions',
  'dashboard.latency': 'Avg resume latency',
  /*
   * The two resume numbers have their own section: they answer what happened *after* an interruption,
   * which is a different question from how the session is going, and they are drawn from a different
   * set of events than the four beside them.
   */
  'dashboard.resume.title': 'Resume outcomes',
  'dashboard.reengageRate': 'Re-engagement after resume',
  'dashboard.reengageRate.sample':
    '{reengaged} of {evaluated} re-engaged · {stalled} stalled again · {pending} pending',
  'dashboard.progressRate': 'Progress after resume',
  'dashboard.progressRate.sample': '{progressed} of {evaluated} progressed · {pending} pending',

  /*
   * The record that is not a learning surface: the app's log and its connection to the browser
   * extension. Both live on the screen the dashboard links to rather than on the dashboard itself.
   */
  'dashboard.more': 'More data',
  'more.eyebrow': 'More data',
  'more.title': 'More data',
  'more.subtitle':
    'The week, the interventions, the browser bridge and the event log — what the dashboard leaves off.',
  'more.back': 'Back to the dashboard',
  'more.outcomes': 'Intervention outcomes',
  'more.outcomes.none': 'No intervention has been shown yet.',
  // The bar's own label, and the two things beside it: how often it was accepted, and the counts the
  // table used to carry. `N =` is written out because a row with one sample otherwise reads as a
  // 100% success rate.
  'more.outcomes.share': '{percent} accepted',
  'more.outcomes.shareAria': 'Accepted share for {action}',
  // What the bar reads out. `aria-valuetext` replaces `aria-valuenow` in the announcement, so it carries
  // the share and the sample size rather than the counts line, which is the paragraph below it.
  'more.outcomes.valueText': '{percent} accepted · N = {total}',
  'more.outcomes.counts':
    '{accepted} accepted · {dismissed} dismissed · {completed} completed the task afterwards · N = {total}',
  'more.rescues': 'How rescues went',
  'more.rescues.none': 'No rescue has been tried yet.',
  'more.rescues.rate': 'Helped {succeeded} of {evaluated}',
  'more.rescues.rateNone': 'Not judged yet',
  'more.rescues.counts':
    'Tried {accepted} · asked again {repeated} · no sign of progress {expired} · still open {pending}',
  'more.bridge': 'Browser bridge',
  'more.bridge.listening': 'Listening on {url} · protocol v{version} · {connections} connected',
  'more.bridge.hint':
    'Paste this token into the FocusLoop Bridge extension. It changes every launch and is only valid on this machine.',
  'more.bridge.reveal': 'Show connection details',
  'more.bridge.hide': 'Hide connection details',
  'more.bridge.stopped':
    'The bridge is not running. The Demo Event Simulator covers the same path.',
  'more.bridge.unavailable': 'Bridge status unavailable.',
  'more.events': 'Recent events',
  'more.events.none': 'No events recorded yet.',
  // No singular form: the badge only renders for a run of two or more.
  'more.events.times': '{count} times',

  /*
   * The history, in the learner's words rather than the log's. `EVENT_TYPE_KEYS` and
   * `EVENT_SOURCE_KEYS` are exhaustive over the closed vocabularies, so a new event type cannot ship
   * without wording here - and the row keeps the exact name on its `title` for the audit tail.
   */
  'event.type.SESSION_STARTED': 'Session started',
  'event.type.TASK_STARTED': 'Step started',
  'event.type.TASK_COMPLETED': 'Step finished',
  'event.type.HELP_REQUESTED': 'You asked for help',
  'event.type.QUIZ_CORRECT': 'Answer was right',
  'event.type.QUIZ_INCORRECT': 'Answer was wrong',
  'event.type.TAB_LEFT': 'You left this tab',
  'event.type.TAB_RETURNED': 'You came back to this tab',
  'event.type.IDLE_STARTED': 'You went quiet',
  'event.type.IDLE_ENDED': 'You were back',
  'event.type.RESUME_REQUESTED': 'You carried on',
  'event.type.RESUME_DISMISSED': 'You turned the resume down',
  'event.type.SESSION_ENDED': 'Session ended',
  'event.type.AGENT_PROPOSAL_EXECUTED': 'A suggested change was applied',
  'event.type.AGENT_PROPOSAL_PROPOSED': 'Change proposed',
  'event.type.TASKS_REORDERED': 'You changed the order',
  'event.type.TASK_ANSWERED': 'You wrote an answer',

  'event.source.user': 'you',
  'event.source.extension': 'browser extension',
  'event.source.simulator': 'demo simulator',
  'event.source.system': 'the app',
  'event.source.agent': 'the assistant',

  // --------------------------------------------------------- resume card
  'resume.aria': 'Resume where you left off',
  'resume.welcome': 'Welcome back',
  'resume.done': 'Done',
  'resume.nothingDone': 'Nothing completed yet — that is fine.',
  'resume.open': 'Still open',
  'resume.nothingOpen': 'Nothing flagged.',
  'resume.currentStep': 'You were on:',
  'resume.nextStep': 'Next step:',
  'resume.minutes': '{minutes} min',
  'resume.continue': 'Continue',
  'resume.dismiss': 'Dismiss',
  /*
   * The check-in on the card.
   *
   * "Before you go on" is deliberately not "test": the learner has just come back from being away, and
   * this asks them to put their own words down — which is what an agent reads later — rather than to
   * pass anything. The recorded line promises exactly what happened and nothing more.
   */
  'resume.recall.title': 'Before you go on',
  'resume.recall.hint': 'Say what you remember about this step. It is kept with it.',
  'resume.recall.save': 'Record it',
  'resume.recall.recorded': 'Recorded. It stays with this step.',

  // -------------------------------------------------------- agent panel
  'agent.suggesting': 'Suggestion',
  'agent.showMe': 'Show me',
  'agent.notNow': 'Not now',
  'agent.accept': 'Try this',
  'agent.continue': 'Continue',
  'agent.rescue.ready': 'A small plan',
  'agent.rescue.title': 'Start with this',
  'agent.rescue.plan': 'Rescue steps',
  'agent.rescue.from.concept-summary': 'The idea behind this step',
  'agent.rescue.from.concept-key-point': 'A key point of this concept',
  'agent.rescue.from.material-sentence': 'From your material',
  'agent.rescue.from.model-generated': 'Generated by your configured model',
  'agent.action.MICRO_START': 'Start with the smallest possible step',
  'agent.action.SIMPLIFY': 'Simplify the current task',
  'agent.action.HINT': 'Here is a hint',
  'agent.action.EXAMPLE': 'Here is a worked example',
  'agent.action.QUESTION': 'Ask yourself',
  'agent.action.BREAK': 'Take a short break',
  'agent.action.RESUME': 'Resume where you left off',
  'agent.action.NO_ACTION': 'No suggestion right now',

  // ----------------------------------------------------------- simulator

  // --------------------------------------------- domain-emitted messages
  // continuity — what to do next
  'action.session.finish': 'You finished this course. Close the loop while it is fresh.',
  'action.start.first': 'Start with the very first micro task.',
  'action.start.next': 'Pick up the next micro task.',
  'action.quiz.answer': 'Answer the quiz question: {title}',
  'action.practice.example': 'Work through the practice task: {title}',
  'action.read.summarise': 'Read it, then summarise it in one sentence: {title}',

  // continuity — the resume card's own wording
  'resume.title.course': 'Back to {course}',
  'resume.title.task': 'Back to: {task}',
  'resume.context.plain': 'You were working on {concept}. The goal was: {goal}',
  'resume.context.moment': 'You were working on {concept} a moment ago. The goal was: {goal}',
  'resume.context.away':
    'You were working on {concept} and stepped away for {duration}. The goal was: {goal}',
  'resume.refresher.long': 'The key idea behind this step: {idea}',
  // Deterministic AG2 rescue steps
  'rescue.microStart.first': 'Open the task and do the first visible action.',
  'rescue.simplify.identify': 'Name the one result this task asks for.',
  'rescue.simplify.first': 'Work only on the first part.',
  'rescue.simplify.check': 'Check that part before moving on.',
  'rescue.hint.action': 'Look for the rule or idea that applies here.',
  'rescue.hint.condition': 'Check what must be true before using it.',
  'rescue.example.pattern': 'Study one worked example and notice its steps.',
  'rescue.example.apply': 'Try the same first step on your task.',
  'rescue.break.pause': 'Step away from the task for a few minutes.',
  'rescue.break.return': 'When you return, start with one small action.',

  // intervention policy — why the agent decided what it decided
  'reason.budget': 'You have already used today’s interventions.',
  'reason.cooldown': 'A suggestion was just shown — pausing so it can land.',
  'reason.resume.dismissed': 'You asked to be left alone with this one.',
  'reason.resume.interruption': 'You were interrupted. Here is your way back in.',
  'reason.overloaded': 'That is a lot at once. Let us shrink it.',
  'reason.confused.example': '{count} misses in a row — an example usually unblocks this.',
  'reason.confused.hint': 'Something is not landing. A hint might help.',
  'reason.initiation': 'Starting is the hard part. One tiny step first.',
  'reason.simplify': 'This task is carrying too much at once.',
  'reason.question': 'A question to check your own understanding.',
  'reason.distracted': 'You have been away. No interruption — just noting it.',
  'reason.stuck.cannot-start': 'You said you could not see where to start.',
  'reason.stuck.do-not-understand': 'You said reading it was not making sense.',
  'reason.stuck.too-big': 'You said it was too much at once.',
  'reason.stuck.went-wrong': 'You said you tried and it came out wrong.',
  'reason.stuck.cannot-recall': 'You said you knew this and it had gone.',
  'reason.stuck.tired': 'You said you had not got the energy for it.',
  'reason.none': 'Nothing needs a suggestion right now.',
  // contextual tutor (AG3) — the learner's own question about the step in front of them
  'tutor.entry': 'Ask about this step',
  'tutor.title': 'Ask about this step',
  'tutor.close': 'Close',
  'tutor.placeholder': 'What do you want to ask about this step?',
  'tutor.placeholder.answer': 'Write or paste your answer, and the tutor will check it.',
  'tutor.ask': 'Ask',
  'tutor.asking': 'Asking…',
  'tutor.hint.mode': 'Pick one of the three above first, then press Ask.',
  'tutor.hint.question': 'Write your question in the box above, then press Ask.',
  'tutor.mode.EXPLAIN': 'Explain it',
  'tutor.mode.HINT': 'A hint',
  'tutor.mode.EXAMPLE': 'An example',
  'tutor.mode.SOCRATIC': 'Ask me something',
  'tutor.mode.CHECK_MY_ANSWER': 'Check my answer',
  'tutor.mode.SUMMARIZE': 'Summarise the section',
  'tutor.part.explanation': 'Explanation',
  'tutor.part.hint': 'Hint',
  'tutor.part.example': 'Example',
  'tutor.part.question': 'Question',
  'tutor.part.summary': 'Summary',
  'tutor.part.confirmed': 'What you had right',
  'tutor.part.missing': 'What was missing',
  'tutor.source': 'From the material',
  'tutor.sourceNone': 'This answer did not use a section of the material.',
  'tutor.noAnswer': 'No answer this time',
  'tutor.leftOut': 'Not included',
  'tutor.concept': 'Concept',
  'tutor.step': 'Step',
  'tutor.instructions': 'What this step asks',
  'tutor.unavailable.no-question':
    'There was no question in that message, so there was nothing to ask about.',
  'tutor.unavailable.request-too-long':
    'Your question and this step do not both fit. Try a shorter question.',
  'tutor.unavailable.no-model':
    'No model is connected, so there is no answer this time. Everything above is still yours to work from.',
  'tutor.unavailable.provider-failed':
    'The model could not be reached, so there is no answer right now. The step and material are still here.',
  'tutor.rejection.unparseable':
    'The model did not answer in the shape the tutor needs, and asking it once more did not help.',
  'tutor.rejection.unexpected-part':
    'The model gave a kind of answer this question does not allow, and asking it once more did not help.',
  'tutor.rejection.missing-part':
    'The model left out something this kind of question needs, and asking it once more did not help.',
  'tutor.rejection.unquoted-confirmation':
    'The model did not quote anything you wrote, so the tutor will not show a confirmation of it.',
  'tutor.rejection.not-from-the-material':
    'The model answered from a section that is not in front of you, so the tutor will not show it.',

  // Structural proposal envelope (AG4/AG8). A refusal is always a reason the learner can read.
  'proposal.refusal.unknown-proposal': 'That change is no longer available.',
  'proposal.refusal.wrong-session': 'This change belongs to a different session.',
  'proposal.refusal.expired': 'This change offer has expired. Ask for it again.',
  'proposal.refusal.state-changed':
    'Something changed after this change was prepared, so it was not applied. Review the new state and try again.',
  'proposal.refusal.hash-mismatch': 'This confirmation does not match the change that was shown.',
  'proposal.refusal.already-confirmed': 'This change is already confirmed.',
  'proposal.refusal.already-executed': 'This change has already been applied.',
  'proposal.refusal.already-refused': 'This change was already declined.',
  'proposal.refusal.not-confirmed': 'Confirm the change before it can run.',
  'proposal.refusal.forged-id': 'That change identifier is not valid.',
  // The confirmation dialog (#209). The level label names ADR 0003's matrix via `kind`.
  'proposal.level.structural-write': 'Needs your confirmation',
  'proposal.level.reversible-write': 'Needs a quick confirmation',
  'proposal.confirm.title': 'Confirm this change',
  'proposal.confirm.change': 'What will change',
  'proposal.confirm.why': 'Requested by',
  'proposal.confirm.apply': 'Confirm',
  'proposal.confirm.dismiss': 'Not now',
  // Tool call refusals (AG8.1). A refusal is always a reason the learner can read.
  'tool.refusal.unknown-tool': 'That action is not available, so nothing ran.',
  'tool.refusal.bad-schema': 'That action was not understood, so nothing ran.',
  'tool.refusal.wrong-session': 'That action belongs to a different session.',
  'tool.refusal.permission': 'That action needs your confirmation before it can run.',
  'tool.refusal.internal': 'That action could not run.',
  // Agent memory inspection (AG7.5): a refusal is a reason; everything else is metadata, never content.
  'memory.refusal.wrong-session': "That is a different session's memory.",
  'memory.refusal.no-session': 'No session is running, so there is nothing to inspect.',
  'app.data.memory.title': 'What the agent remembers',
  'app.data.memory.empty': 'Nothing is remembered for this session.',
  'app.data.memory.clear': 'Clear session memory',
  'app.data.memory.confirm.title': 'Clear what the agent remembers?',
  'app.data.memory.confirm.lose':
    'This removes what the agent remembers of this session — the conversation, the events, the checkpoints. It does not touch your course, tasks or results.',
  'app.data.memory.confirm.action': 'Clear memory',
  'app.data.memory.cleared': 'Cleared {at} by {actor}',
  'app.data.memory.clearedNotice': 'Session memory cleared.',
  'app.data.memory.clearFailed': 'Nothing was cleared — there is no running session.',
  // A stored preference as the panel lists it (AG7.4/7.6): the value, the window, whether it is confirmed.
  'app.data.preference.scope.task-size': 'Task size',
  'app.data.preference.scope.explanation': 'Explanation form',
  'app.data.preference.scope.intervention': 'Intervention',
  'app.data.preference.scope.resume': 'Resume',
  'app.data.preference.evidence': '{samples} samples · {from} – {to}',
  'app.data.preference.unconfirmed': 'not confirmed yet',
  'app.data.preference.expired': 'expired',
  // The weekly reflection (AG6.5): every line is a count with its rows behind it.
  'app.reflection.title': 'This week',
  'app.reflection.stats': 'What happened',
  'app.reflection.claims': 'What the agent believes',
  'app.reflection.suggestions': 'Worth confirming',
  'app.reflection.confirm': 'Review and confirm',
  'app.reflection.declined': 'Suggestion declined. No preference was saved.',
  'app.reflection.empty': 'Nothing was recorded this week.',
  'app.reflection.stat.interventions.shown': 'Help offered',
  'app.reflection.stat.interventions.accepted': 'Accepted',
  'app.reflection.stat.interventions.dismissed': 'Declined',
  'app.reflection.stat.resumes.accepted': 'Resumes accepted',
  'app.reflection.stat.resumes.dismissed': 'Resumes declined',
  'app.reflection.stat.checkpoints.taken': 'Checkpoints taken',
  'app.reflection.stat.tasks.completed': 'Steps finished',
  'app.data.preference.forget': 'Forget',
  'app.data.preference.deleted': 'Preference forgotten.',
  'app.data.memory.scope.working': 'Working',
  'app.data.memory.scope.episodic': 'Episodic',
  'app.data.memory.scope.preference': 'Preference',
  'app.data.memory.source.transcript': 'Tutor conversation',
  'app.data.memory.source.learning_events': 'Learning events',
  'app.data.memory.source.checkpoints': 'Checkpoints',
  'app.data.memory.source.interventions': 'Interventions',
  'app.data.memory.source.outcomes': 'Outcomes',
  'app.data.memory.source.resume_cards': 'Resume cards',
  'app.data.memory.source.agent_proposals': 'Proposals',
  'app.data.memory.source.learner_preferences': 'Preferences',
  'app.data.memory.impact.transcript': 'the turns of the tutor conversation',
  'app.data.memory.impact.learning_events': 'the event log of this session',
  'app.data.memory.impact.checkpoints': 'the checkpoints taken in this session',
  'app.data.memory.impact.interventions': 'the interventions offered in this session',
  'app.data.memory.impact.outcomes': 'the outcome records of this session',
  'app.data.memory.impact.resume_cards': 'the resume cards of this session',
  'app.data.memory.impact.agent_proposals': 'the proposals made in this session',
  'app.data.memory.impact.learner_preferences': 'preferences learned from this session',
} as const;

export default en;

/** Every key the interface can ask for, derived from the English wording. */
export type MessageKey = keyof typeof en;
