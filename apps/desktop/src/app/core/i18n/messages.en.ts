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
  'focus.complete': 'Complete task',
  'focus.needHelp': 'Need help',
  'focus.noTask': 'No task in progress.',
  'focus.upNext': 'Up next',
  'focus.startTask': 'Start',
  'focus.allDone': 'Everything in this course is complete.',
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
  'agent.action.MICRO_START': 'Start with the smallest possible step',
  'agent.action.SIMPLIFY': 'Simplify the current task',
  'agent.action.HINT': 'Here is a hint',
  'agent.action.EXAMPLE': 'Here is a worked example',
  'agent.action.QUESTION': 'Ask yourself',
  'agent.action.BREAK': 'Take a short break',
  'agent.action.RESUME': 'Resume where you left off',
  'agent.action.NO_ACTION': 'No suggestion right now',

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
  'reason.none': 'Nothing needs a suggestion right now.',
} as const;

export default en;

/** Every key the interface can ask for, derived from the English wording. */
export type MessageKey = keyof typeof en;
