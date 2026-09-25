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
  'app.connecting': 'connecting…',
  'app.mode.offline': 'offline mode',
  'app.mode.network': 'network mode',
  'app.language': 'Language',
  'app.language.switch': 'Switch interface language',
  'app.theme': 'Theme',
  'app.theme.switch': 'Switch theme',

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
  'home.courses.title': 'Courses',
  'home.courses.meta': '{concepts} concepts · {tasks} micro tasks',
  'home.courses.view': 'View course',
  'home.courses.start': 'Start session',
  'home.courses.none': 'No courses yet.',
  'home.import.title': 'Import material',
  'home.import.hint': 'Plain text and Markdown only. Everything stays on this machine.',
  'home.import.fileName': 'File name',
  'home.import.content': 'Content',
  'home.import.action': 'Import',
  'home.import.placeholder': 'notes.md',
  'home.import.result': '{title}: {concepts} concepts, {tasks} micro tasks',
  'home.import.needFileName': 'Give the file a name first.',
  'home.import.pick': 'Choose a file',
  'home.import.pasteSummary': 'Or paste the text instead',
  'home.import.reject.tooLarge': 'That file is over {limit}.',
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

  // ----------------------------------------------------------- course map
  // The whole course as one picture, and the exercise of putting it back from memory.
  'map.title': 'Course map',
  'map.hint': 'What this course is made of, in the order you will meet it.',
  'map.recall.title': 'Draw it again from memory',
  'map.recall.hint':
    'Write the concepts you remember, in your own words. The order does not matter, and you can dictate instead of typing.',
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
  'focus.timeUp': 'time is up',
  'focus.complete': 'Complete task',
  'focus.noTask': 'No task in progress.',
  'focus.upNext': 'Up next',
  'focus.startTask': 'Start',
  'focus.allDone': 'Everything in this course is complete.',
  // The plan states the total so the learner does not have to add up the blocks.
  'focus.plan.remaining': 'about {time} left',
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

  'dashboard.hero.total': 'Total time',
  'dashboard.hero.daily': 'Daily average',
  'dashboard.hero.over.one': 'across 1 active day',
  'dashboard.hero.over.other': 'across {days} active days',
  'dashboard.focusRatio': 'Focused',
  'dashboard.session.title': 'This session',
  'dashboard.states.title': 'Time by state',
  'dashboard.activity.title': 'Daily activity',
  'dashboard.activity.hint': 'Darker means more time that day.',
  'dashboard.activity.empty': 'Nothing recorded in this window yet.',
  'dashboard.activity.busiest': 'Busiest: {date} · {time}',
  'dashboard.window.tasks': 'Tasks done',
  'dashboard.window.interruptions': 'Interruptions',
  'dashboard.window.sessions': 'Sessions',
  'dashboard.outcomes.none': 'No intervention has been shown yet.',
  'dashboard.courses.title': 'Time by course',

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
  'dashboard.reengageRate': 'Re-engagement after resume',
  'dashboard.reengageRate.sample':
    '{reengaged} of {evaluated} re-engaged · {stalled} stalled again · {pending} pending',
  'dashboard.progressRate': 'Progress after resume',
  'dashboard.progressRate.sample': '{progressed} of {evaluated} progressed · {pending} pending',
  'dashboard.outcomes': 'Intervention outcomes',
  'dashboard.col.action': 'Action',
  'dashboard.col.shown': 'Shown',
  'dashboard.col.accepted': 'Accepted',
  'dashboard.col.dismissed': 'Dismissed',
  'dashboard.col.completed': 'Task then completed',
  'dashboard.bridge': 'Browser bridge',
  'dashboard.bridge.listening':
    'Listening on {url} · protocol v{version} · {connections} connected',
  'dashboard.bridge.hint':
    'Paste this token into the FocusLoop Bridge extension. It changes every launch and is only valid on this machine.',
  'dashboard.bridge.stopped':
    'The bridge is not running. The Demo Event Simulator covers the same path.',
  'dashboard.bridge.unavailable': 'Bridge status unavailable.',
  'dashboard.events': 'Recent events',
  'dashboard.events.none': 'No events recorded yet.',
  // No singular form: the badge only renders for a run of two or more.
  'dashboard.events.times': '{count} times',

  // --------------------------------------------------------- resume card
  'resume.aria': 'Resume where you left off',
  'resume.welcome': 'Welcome back',
  'resume.done': 'Done',
  'resume.nothingDone': 'Nothing completed yet — that is fine.',
  'resume.open': 'Still open',
  'resume.nothingOpen': 'Nothing flagged.',
  'resume.nextStep': 'Next step:',
  'resume.minutes': '{minutes} min',
  'resume.continue': 'Continue',
  'resume.showContext': 'Show context',
  'resume.dismiss': 'Dismiss',
  'resume.context.checkpoint': 'checkpoint: {id}',
  'resume.context.shownAt': 'shown at: {at}',
  'resume.context.completed': 'completed: {items}',
  'resume.context.unresolved': 'unresolved: {items}',
  'resume.context.next': 'next: {action}',
  'resume.context.empty': '—',

  // -------------------------------------------------------- agent panel
  'agent.suggesting': 'Suggestion',
  'agent.showMe': 'Show me',
  'agent.notNow': 'Not now',
  'agent.accept': 'Try this',
  'agent.continue': 'Continue',
  'agent.rescue.ready': 'A small plan',
  'agent.rescue.title': 'Start with this',
  'agent.rescue.plan': 'Rescue steps',
  'agent.action.MICRO_START': 'Start with the smallest possible step',
  'agent.action.SIMPLIFY': 'Simplify the current task',
  'agent.action.HINT': 'Here is a hint',
  'agent.action.EXAMPLE': 'Here is a worked example',
  'agent.action.QUESTION': 'Ask yourself',
  'agent.action.BREAK': 'Take a short break',
  'agent.action.RESUME': 'Resume where you left off',
  'agent.action.NO_ACTION': 'No suggestion right now',
  'agent.inspector.title': 'What the agent sees',
  'agent.inspector.state': 'State',
  'agent.inspector.concept': 'Concept',
  'agent.inspector.task': 'Task',
  'agent.inspector.material': 'Material',
  'agent.inspector.events': 'Recent events',
  'agent.inspector.omitted': 'Not included',
  'agent.inspector.none': 'No session is running.',
  'agent.inspector.of': 'of',
  'agent.inspector.truncated': 'truncated',
  'agent.inspector.chars': 'chars',

  // ----------------------------------------------------------- simulator
  'sim.aria': 'Demo event simulator',
  'sim.label': 'Simulator',
  'sim.distraction': 'Distraction',
  'sim.return': 'Return',
  'sim.confusion': 'Confusion',
  'sim.overload': 'Overload',
  'sim.success': 'Success',

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
  'resume.refresher.long': 'Take {seconds} seconds to recall the key idea before continuing.',
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
} as const;

export default en;

/** Every key the interface can ask for, derived from the English wording. */
export type MessageKey = keyof typeof en;
