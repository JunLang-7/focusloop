/**
 * Simplified Chinese wording.
 *
 * Typed as `Record<MessageKey, string>`, so leaving a key out is a TypeScript
 * error — the CI typecheck is what keeps the two languages in step. The
 * placeholders must match the English ones exactly.
 */
import type { MessageKey } from './messages.en';

export const zh: Record<MessageKey, string> = {
  // ------------------------------------------------------------ application
  'app.tagline': '让学习不断线',
  'app.nav.home': '首页',
  'app.nav.focus': '专注会话',
  'app.nav.dashboard': '数据面板',
  'app.connecting': '连接中…',
  'app.mode.offline': '离线模式',
  'app.mode.network': '联网模式',
  'app.language': '语言',
  'app.language.switch': '切换界面语言',
  'app.theme': '主题',
  'app.theme.switch': '切换主题',

  // The theme preference, not the resolved theme.
  'theme.system': '自动',
  'theme.light': '亮',
  'theme.dark': '暗',

  // --------------------------------------------------------- learning state
  'state.READY': '就绪',
  'state.INITIATION_FRICTION': '启动困难',
  'state.FOCUSED': '专注中',
  'state.CONFUSED': '困惑',
  'state.OVERLOADED': '过载',
  'state.DISTRACTED': '离开中',
  'state.INTERRUPTED': '被打断',
  'state.RESUMING': '正在恢复',

  // ----------------------------------------------------------------- home
  'home.eyebrow': '首页',
  'home.title': '让你的学习一直连得上',
  'home.subtitle': 'FocusLoop 帮你从「思路断掉的地方」接着走，而不是从「刷到哪一页」接着滑。',
  'home.current.title': '当前会话',
  'home.current.untitled': '未命名课程',
  'home.current.meta': '已完成 {completed} / {total} 个微任务 · 用时 {elapsed} · 状态 {state}',
  'home.current.continue': '继续会话',
  'home.empty': '当前没有进行中的会话。从下面挑一门课程开始吧。',
  'home.courses.title': '课程',
  'home.courses.meta': '{concepts} 个概念 · {tasks} 个微任务',
  'home.courses.view': '查看课程',
  'home.courses.start': '开始会话',
  'home.courses.none': '还没有课程。',
  'home.import.title': '导入学习材料',
  'home.import.hint': '仅支持纯文本与 Markdown。所有内容都只留在这台电脑上。',
  'home.import.fileName': '文件名',
  'home.import.content': '内容',
  'home.import.action': '导入',
  'home.import.placeholder': '笔记.md',
  'home.import.result': '{title}：{concepts} 个概念，{tasks} 个微任务',

  // --------------------------------------------------------------- course
  'course.eyebrow': '课程',
  'course.start': '开始会话',
  'course.concepts': '概念',
  'course.tasks': '微任务',
  'course.col.order': '序号',
  'course.col.task': '任务',
  'course.col.kind': '类型',
  'course.col.estimate': '预计用时',
  'course.col.status': '状态',
  'course.minutes': '{minutes} 分钟',
  'course.status.done': '已完成',
  'course.status.open': '未开始',
  'course.notFound': '没有找到这门课程。',
  'course.back': '返回首页',

  // Micro-task kinds. These are vocabulary, not data: the learner reads them.
  'kind.read': '阅读',
  'kind.practice': '练习',
  'kind.quiz': '测验',

  // ---------------------------------------------------------------- focus
  'focus.eyebrow': '专注会话',
  'focus.untitled': '会话',
  'focus.end': '结束会话',
  'focus.state': '状态',
  'focus.elapsed': '已用时',
  'focus.progress': '进度',
  'focus.started': '开始时间',
  'focus.currentTask': '当前微任务',
  'focus.taskMeta': '约 {minutes} 分钟',
  'focus.complete': '完成任务',
  'focus.needHelp': '我需要帮助',
  'focus.noTask': '当前没有进行中的任务。',
  'focus.upNext': '接下来',
  'focus.startTask': '开始',
  'focus.allDone': '这门课程的所有任务都已完成。',
  'focus.none.title': '当前没有进行中的会话',
  'focus.none.body': '从一门课程开始会话，即可进入专注工作区。',
  'focus.none.browse': '浏览课程',

  // ------------------------------------------------------------ dashboard
  'dashboard.eyebrow': '数据面板',
  'dashboard.noSession': '还没有会话',
  'dashboard.subtitle': '只保留能回答「续接到底有没有用」的数字。',
  'dashboard.refresh': '刷新',

  // The window switcher.
  'dashboard.range.label': '时间范围',
  'dashboard.range.session': '本次',
  'dashboard.range.today': '今日',
  'dashboard.range.week': '近 7 天',
  'dashboard.range.all': '全部',

  'dashboard.hero.total': '总时长',
  'dashboard.hero.daily': '日均',
  'dashboard.hero.over.one': '1 天有记录',
  'dashboard.hero.over.other': '共 {days} 天有记录',
  'dashboard.focusRatio': '专注占比',
  'dashboard.session.title': '本次会话',
  'dashboard.states.title': '学习状态占比',
  'dashboard.activity.title': '每日活动',
  'dashboard.activity.hint': '颜色越深，当天学习越久。',
  'dashboard.activity.empty': '这个区间还没有记录。',
  'dashboard.activity.busiest': '最多的一天：{date} · {time}',
  'dashboard.window.tasks': '完成任务',
  'dashboard.window.interruptions': '打断次数',
  'dashboard.window.sessions': '会话数',
  'dashboard.outcomes.none': '还没有展示过干预。',
  'dashboard.courses.title': '课程时长占比',

  // Chinese does not space a number from its unit, so these carry no padding.
  'unit.s': '{s}秒',
  'unit.hm': '{h}小时{m}分',
  'unit.m': '{m}分钟',

  // Index 0 is Sunday, to match `Date.getDay()`.
  'weekday.0': '周日',
  'weekday.1': '周一',
  'weekday.2': '周二',
  'weekday.3': '周三',
  'weekday.4': '周四',
  'weekday.5': '周五',
  'weekday.6': '周六',

  'dashboard.duration': '会话时长',
  'dashboard.tasks': '微任务',
  'dashboard.interruptions': '打断次数',
  'dashboard.latency': '平均恢复耗时',
  'dashboard.outcomes': '干预结果',
  'dashboard.col.action': '动作',
  'dashboard.col.shown': '展示',
  'dashboard.col.accepted': '接受',
  'dashboard.col.dismissed': '忽略',
  'dashboard.col.completed': '随后完成任务',
  'dashboard.bridge': '浏览器桥接',
  'dashboard.bridge.listening': '正在监听 {url} · 协议 v{version} · 已连接 {connections} 个',
  'dashboard.bridge.hint':
    '把这个令牌粘贴到 FocusLoop Bridge 扩展里。它每次启动都会更换，且只在本机有效。',
  'dashboard.bridge.stopped': '桥接服务未在运行。演示事件模拟器覆盖了同一条链路。',
  'dashboard.bridge.unavailable': '暂时拿不到桥接状态。',
  'dashboard.events': '最近事件',
  'dashboard.events.none': '还没有记录到事件。',

  // --------------------------------------------------------- resume card
  'resume.aria': '从你停下的地方继续',
  'resume.welcome': '欢迎回来',
  'resume.done': '已完成',
  'resume.nothingDone': '还没有完成的内容——这很正常。',
  'resume.open': '仍未解决',
  'resume.nothingOpen': '没有标记出的疑点。',
  'resume.nextStep': '下一步：',
  'resume.minutes': '{minutes} 分钟',
  'resume.continue': '继续',
  'resume.showContext': '查看依据',
  'resume.dismiss': '先不用',
  'resume.context.checkpoint': '检查点：{id}',
  'resume.context.shownAt': '展示时间：{at}',
  'resume.context.completed': '已完成：{items}',
  'resume.context.unresolved': '未解决：{items}',
  'resume.context.next': '下一步：{action}',
  'resume.context.empty': '—',

  // -------------------------------------------------------- agent panel
  'agent.suggesting': '建议',
  'agent.showMe': '给我看看',
  'agent.notNow': '稍后再说',
  'agent.action.MICRO_START': '从最小的一步开始',
  'agent.action.SIMPLIFY': '把当前任务拆小',
  'agent.action.HINT': '这里有个提示',
  'agent.action.EXAMPLE': '这里有个示例',
  'agent.action.QUESTION': '问自己一个问题',
  'agent.action.BREAK': '短暂休息一下',
  'agent.action.RESUME': '从你停下的地方继续',
  'agent.action.NO_ACTION': '暂时没有建议',

  // ----------------------------------------------------------- simulator
  'sim.aria': '演示事件模拟器',
  'sim.label': '模拟器',
  'sim.distraction': '分心',
  'sim.return': '返回',
  'sim.confusion': '卡住',
  'sim.overload': '过载',
  'sim.success': '答对',

  // --------------------------------------------- domain-emitted messages
  // continuity — what to do next
  'action.session.finish': '这门课程你已经学完了。趁热打铁，把这一轮收个尾。',
  'action.start.first': '从第一个微任务开始。',
  'action.start.next': '接着做下一个微任务。',
  'action.quiz.answer': '回答这道测验题：{title}',
  'action.practice.example': '动手做这个练习：{title}',
  'action.read.summarise': '读完之后，用一句话把它概括出来：{title}',

  // continuity — the resume card's own wording
  'resume.title.course': '回到《{course}》',
  'resume.title.task': '回到：{task}',
  'resume.context.plain': '你当时正在处理「{concept}」。目标是：{goal}',
  'resume.context.moment': '你刚刚还在处理「{concept}」。目标是：{goal}',
  'resume.context.away': '你当时正在处理「{concept}」，中间离开了 {duration}。目标是：{goal}',

  // intervention policy — why the agent decided what it decided
  'reason.budget': '今天的干预额度已经用完了。',
  'reason.cooldown': '刚刚已经给过一条建议——先留点时间让它起作用。',
  'reason.resume.dismissed': '你说了这一条想自己处理。',
  'reason.resume.interruption': '你被打断了。这条是回到原路的入口。',
  'reason.overloaded': '一次塞进来的东西太多了，我们把它缩小一点。',
  'reason.confused.example': '连续错了 {count} 次——看个例子通常就能解开。',
  'reason.confused.hint': '有个地方没接上。给个提示可能会有帮助。',
  'reason.initiation': '开始是最难的部分。先只做最小的一步。',
  'reason.simplify': '这个任务一次承载得太多了。',
  'reason.question': '用一个问题来检查你自己的理解。',
  'reason.distracted': '你离开了一段时间。不打断你，只是记一下。',
  'reason.none': '现在不需要任何建议。',
};
