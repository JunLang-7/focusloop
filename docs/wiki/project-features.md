# FocusLoop 功能清单：逐项说明与状态

> **事实基线**：默认分支 `main` @
> [`e596d6f`](https://github.com/nianpingy-cpu/focusloop/commit/e596d6fd0e4e33e3810744811272eccd9a580437)，
> 核对日期 2026-09-22。
>
> 本页是唯一的「当前能力台账」。只存在于功能分支的实现标为「分支完成」，只开了 PR 的标为
> 「PR 已开」，两者都不算可用。这里不写愿景，只写能被链接复核的事实。

## 1. 怎么读这一页

### 1.1 状态阶梯（七级，不得越级）

```text
设计完成 → 分支完成 → PR 已开 → 已合并 → CI 绿 → E2E 验证 → 已发布
```

| 状态     | 含义                                                   | 最低证据                                             |
| -------- | ------------------------------------------------------ | ---------------------------------------------------- |
| 设计完成 | 范围、契约、DoD 已写入方案页                           | 方案页链接                                           |
| 分支完成 | 代码在功能分支上完成并通过本地门禁                     | 分支名 + commit                                      |
| PR 已开  | 已开 PR，等待 CI                                       | PR 编号                                              |
| 已合并   | 该能力已进入 `main`（能力口径）                        | merge commit                                         |
| CI 绿    | 该能力在 `main` 上的必需检查已通过（运行链接见本节末） | `main` 的 workflow run 链接；可另附实现文件或 commit |
| E2E 验证 | golden path 里有该能力的用户可见断言并通过             | e2e 测试名 + `main` 上的 CI run                      |
| 已发布   | 出现在已发布的 Release 中（草稿 Release 不算）         | Release tag                                          |

五条硬规则：

1. **不得越级**。E2E 被环境阻塞时，最高只能标到「CI 绿」，且必须在“已知限制”写明阻塞原因。
2. **测试数量不是证据**。「N 项测试通过」无法复核，证据必须是 commit、PR 或 CI run 链接。
3. **同名不等于可用**。存在同名类型、按钮或文案，不等于该能力已经闭环。
4. **状态是能力口径，不是 PR 口径**：`已合并` 与 `CI 绿` 都指该能力已经在 `main` 上，而不是某个 PR 的
   检查通过；某个 PR 的结果只写在该 PR 对应的那一行里。
5. **一个能力被拆成“已合并部分 + 分支部分”时，状态只描述已合并部分**，分支部分必须在“已知限制”里点名。
   例：AG1 的边界与 omission 已合并，13 类事件投影仍在分支。本节凡是 `CI 绿` 都引用 `main` @
   `e596d6f` 的必需检查：[CI](https://github.com/nianpingy-cpu/focusloop/actions/runs/35619326202)、
   [Coverage](https://github.com/nianpingy-cpu/focusloop/actions/runs/35619326180)、
   [Code scanning](https://github.com/nianpingy-cpu/focusloop/actions/runs/35619326187)。

### 1.2 每个功能交代的九个重点

| #   | 重点       | 要回答的问题                                               |
| --- | ---------- | ---------------------------------------------------------- |
| 1   | 定位       | 一句话说清它是什么，不含术语                               |
| 2   | 用户怎么用 | 入口在哪、按什么顺序操作、看到什么                         |
| 3   | 何时发生   | 谁决定它发生：确定性策略 / 用户主动 / 模型只生成内容       |
| 4   | 永不做什么 | 不变量：不诊断、不静默改计划、不直连数据库、不上传原始内容 |
| 5   | 数据与边界 | 读什么、写什么、存在哪、什么会离开本机、各项上限           |
| 6   | 状态与证据 | 按 1.1 的状态 + commit / PR / CI / E2E 链接                |
| 7   | 已知限制   | 现在做不到什么，以及为什么（含开放问题）                   |
| 8   | 依赖       | 上游必须先有什么，下游等它什么                             |
| 9   | 怎么验证   | 测试文件、e2e 测试名、可复现的手动演示路径                 |

## 2. 产品定位与核心闭环

FocusLoop 是一个本地优先的学习连续性工具，面向在**开始任务**、**维持注意力**和**中断后重新进入**
时有困难的学习者。它不是聊天机器人：核心目标是维护一条可恢复的学习链路。

```text
导入材料 → 生成课程与微任务 → 开始 Focus Session
→ 记录学习事件与当前位置 → 识别卡住或中断
→ 低打扰建议或 Resume Card → 回到原任务
→ 在 Dashboard / Insights 查看过程与结果
```

FocusLoop 不做 ADHD、智力、人格或心理健康诊断，也不根据行为生成临床结论。

## 3. 功能总览表

| 分组    | 功能                           | 状态        | 证据                                                           | 当前边界                                      |
| ------- | ------------------------------ | ----------- | -------------------------------------------------------------- | --------------------------------------------- |
| A 学习  | 内置演示课程                   | E2E 验证    | golden path                                                    | 用于演示与开发验证                            |
| A 学习  | 本机材料导入（`.txt` / `.md`） | E2E 验证    | `af2e74f` (#81)                                                | 不支持 PDF / Word / 网页抓取                  |
| A 学习  | 课程与微任务生成               | CI 绿       | `micro-task-generator.ts`                                      | 确定性规则，不是模型生成                      |
| A 学习  | 课程浏览                       | CI 绿       | 课程页 + store 读取                                            | 单人、本地课程为单位                          |
| A 学习  | Focus Session 计时             | E2E 验证    | golden path                                                    | 计时由桌面 UI 管理                            |
| A 学习  | 任务生命周期（暂停/继续/延长） | E2E 验证    | `257efe0` (#76)、`2b4934f` (#75)                               | 计时结束后延长一分钟                          |
| B 干预  | 学习状态机（八态）             | CI 绿       | `packages/learning-state`                                      | 确定性状态机，不做心理诊断                    |
| B 干预  | 「我卡住了」六类原因           | E2E 验证    | `534bc1c` (#100)                                               | 原因先被记录，再决定行动                      |
| B 干预  | 干预策略（确定性 8 类 action） | CI 绿       | `packages/intervention-policy`                                 | 模型不决定是否打断                            |
| B 干预  | 干预结果记录与 Dashboard 汇总  | CI 绿       | outcome 事件 + Dashboard                                       | 记录展示/接受/拒绝/完成                       |
| B 干预  | Rescue 计划与成功评估器        | 分支完成    | `0f19c9f`（无 PR）                                             | 未合并；SHRINK/SPLIT 仍未实现                 |
| C 恢复  | Learning Checkpoint            | CI 绿       | `buildCheckpoint` + store                                      | 内容主要从任务进度推导                        |
| C 恢复  | Resume Card（统一版）          | E2E 验证    | `packages/continuity` + Dashboard                              | 只有一档，不区分离开时长                      |
| C 恢复  | Resume 三档 + 重新参与指标     | 分支完成    | `0f19c9f`（无 PR）                                             | 未合并；指标口径需按 §4.C3 改名               |
| D 观察  | Dashboard                      | CI 绿       | 当前 Session 与跨 Session 两类视图                             | 指标全部本地重算                              |
| D 观察  | Insights（四个时间窗）         | CI 绿       | 状态占比、日历、课程占比                                       | 不依赖远端分析服务                            |
| D 观察  | 学习事件时间线                 | CI 绿       | 相邻重复事件折叠                                               | 是过程记录，不是能力评价                      |
| E 环境  | 浏览器 Bridge（MV3）           | CI 绿       | 扩展 + 本机 bridge                                             | 不读 URL / 标题 / 正文 / Cookie               |
| E 环境  | Demo Event Simulator           | CI 绿       | 开发版显示，打包版隐藏                                         | 仅开发模式                                    |
| E 环境  | 中英文界面                     | E2E 验证    | `messages.en/zh.ts` + 编译期强制                               | 设置存本地                                    |
| E 环境  | 主题（跟随系统 / 浅 / 深）     | CI 绿       | token 门禁（禁用字面色值）                                     | 设置存本地                                    |
| E 环境  | 离线运行                       | E2E 验证    | Mock Provider                                                  | 无账号、无网络可完成核心流程                  |
| E 环境  | 可选 DeepSeek Provider         | 已合并      | `packages/llm-provider`                                        | `main` 的正常 UI 流程不调用它                 |
| E 环境  | Agent Context Inspector（AG1） | 已合并      | `63acc28` (#99)                                                | 见 §4.F1 的两视图说明                         |
| F Agent | AG1 Learning Context           | 已合并      | `63acc28` (#99)                                                | 边界与 omission 已合并；13 类事件投影在分支上 |
| F Agent | AG2 Stuck Rescue               | 已合并      | `534bc1c` (#100)                                               | 动作仍是文案，未真正改写任务                  |
| F Agent | AG3 Contextual Tutor           | **PR 已开** | PR [#101](https://github.com/nianpingy-cpu/focusloop/pull/101) | 未合并；i18n 违规待修（见 §4.F3）             |
| F Agent | AG4 Task Adaptation            | 设计完成    | 方案页 AG4                                                     | 只有一个 commit 的动作，无 AdaptiveTask       |
| F Agent | AG5 Cognitive Resume           | 已合并      | 统一卡；三档在 `0f19c9f`                                       | 见 §4.C3                                      |
| F Agent | AG6 Learning Reflection        | 设计完成    | 方案页 AG6                                                     | 无偏好模型，无复盘链路                        |
| F Agent | AG7 Agent Memory               | 设计完成    | 方案页 AG7                                                     | episodic 数据已有，无 scope/删除语义          |
| F Agent | AG8 Tools & Actions            | 设计完成    | 方案页 AG8                                                     | 无 tool contract / 权限 / 确认                |
| F Agent | AG9 Model Runtime              | 设计完成    | `AIProvider` 抽象                                              | 无结构化输出 / abort / 流式                   |
| F Agent | AG10 Evaluation & Guardrails   | 分支完成    | `0f19c9f`（无 PR）                                             | `main` 上只有工程测试，无场景数据集           |

> 「CI 绿」指该能力所在 PR 的全部必需检查在 `main` 上通过（`quality` ×3 OS、`golden path` ×2、
> `coverage`、`package (smoke)`、CodeQL、`analyze`）。「E2E 验证」表示 `golden path` 里有对应的
> 用户可见断言。

## 4. 逐项说明

### A. 核心学习流程

#### A1 内置演示课程 — E2E 验证

1. **定位**：不导入任何材料也能走完整条学习链路。
2. **用户怎么用**：Home 的课程卡片（`查看` / `开始`）→ 进入课程页；内置演示课程与导入的课程走同一条渲染路径。
3. **何时发生**：用户主动。
4. **永不做什么**：不联网获取课程；不覆盖用户自己导入的课程。
5. **数据与边界**：演示材料是仓库内固定文本，首次启动写入本机 SQLite。
6. **状态与证据**：E2E 验证 — `golden path` 第一个测试；`main @ e596d6f`。
7. **已知限制**：只用于演示与开发验证，不代表任意材料的生成质量。
8. **依赖**：无（是其他一切功能的入口）。
9. **怎么验证**：`pnpm e2e`（`apps/desktop-e2e/tests/golden-path.spec.ts`）。

#### A2 本机材料导入 — E2E 验证

1. **定位**：把学习者自己的 `.txt` / `.md` 变成课程，而不是手打。
2. **用户怎么用**：Home → 选择文件或直接粘贴内容 → 确认文件名 → 生成课程。
3. **何时发生**：用户主动，一次性动作。
4. **永不做什么**：不上传文件；不读文件系统里未选择的内容；不抓取网页。
5. **数据与边界**：内容走 IPC 校验后写入本机 SQLite；文件名有长度与字符规则。
6. **状态与证据**：E2E 验证 — `af2e74f` (#81)，含 `663a121` (#80) 的文件名规则修正。
7. **已知限制**：仅 `.txt` / `.md`；不支持 PDF、Word、网页。
8. **依赖**：IPC 白名单 + material parser。
9. **怎么验证**：`golden path` 的导入用例；`apps/desktop/electron/ipc/validate.spec.ts`。

#### A3 课程与微任务生成 — CI 绿

1. **定位**：把材料按章节转成概念 + 可执行的小任务，**确定性**且可复现。
2. **用户怎么用**：导入后自动生成，课程页看到概念、阅读/练习任务与预计时长。
3. **何时发生**：导入时由纯函数执行，无模型参与。
4. **永不做什么**：不调用模型生成任务；不对同一材料产生随机结果。
5. **数据与边界**：只读取材料文本；最多选取有限章节；结果全部本机持久化。
6. **状态与证据**：CI 绿 — `packages/agent-core/src/micro-task-generator.ts` 及其单测。
7. **已知限制**：不是模型生成，因此不理解语义；测验只在满足条件时生成。
8. **依赖**：material parser。
9. **怎么验证**：`agent-core` 单测；对同一材料重复生成结果一致。

#### A4 课程浏览 — CI 绿

1. **定位**：看清一门课的整体结构，以及自己走到哪一步。
2. **用户怎么用**：课程页查看概念摘要、材料原文、任务顺序、预计时长与完成状态。
3. **何时发生**：读取时派生，不产生新事实。
4. **永不做什么**：不在浏览时改写任务或进度。
5. **数据与边界**：从 SQLite 读取课程/任务/进度；材料正文是否显示由设置决定。
6. **状态与证据**：CI 绿 — 课程页组件 + store 读取。
7. **已知限制**：以单人、本地课程为单位；无共享或多设备视图。
8. **依赖**：A3。
9. **怎么验证**：desktop 单测 + `golden path`。

#### A5 Focus Session 计时 — E2E 验证

1. **定位**：一次专注的最小单位，有开始、有结束、有当前位置。
2. **用户怎么用**：课程页开始 Session → 计时器运行 → 结束 Session。
3. **何时发生**：用户主动开始/结束；空闲与标签事件由系统侧产生。
4. **永不做什么**：不在 Session 之外记录学习事件；不静默结束 Session。
5. **数据与边界**：Session 起止时间、任务进度、事件写入本机 SQLite。
6. **状态与证据**：E2E 验证 — `golden path`。
7. **已知限制**：计时主要由桌面 UI 管理，跨设备/跨进程不可靠。
8. **依赖**：A4。
9. **怎么验证**：`pnpm e2e`。

#### A6 任务生命周期 — E2E 验证

1. **定位**：把「做不动」拆成可以按一下的小动作。
2. **用户怎么用**：开始任务；暂停/继续计时；计时结束后加一分钟；完成并进入下一个任务。
3. **何时发生**：由用户动作或确定性计时规则触发。
4. **永不做什么**：不自动跳过任务；不在用户未确认时改变任务内容。
5. **数据与边界**：任务状态与事件写本机；完成动作只发一次事件。
6. **状态与证据**：E2E 验证 — `2b4934f` (#75)、`257efe0` (#76)。
7. **已知限制**：`SIMPLIFY` 等建议**不会**真正改写任务，仍属 AG4。
8. **依赖**：A5；真正的改写依赖 AG4 + AG8。
9. **怎么验证**：`golden path` 的任务推进断言；`learning-state` 单测。

### B. 学习状态与干预

#### B1 学习状态机（八态） — CI 绿

1. **定位**：用可解释的机器状态，回答「现在处在哪种学习情境」。
2. **用户怎么用**：不直接操作；状态驱动干预选择与 Dashboard 分布。
3. **何时发生**：完全由事件驱动，确定性转移，无模型参与。
4. **永不做什么**：不做心理诊断；不把情境状态写成长期人格标签。
5. **数据与边界**：输入为任务开始/完成、答题结果、求助、标签离开/返回、系统 idle。
6. **状态与证据**：CI 绿 — `packages/learning-state`，八态：`READY`、`INITIATION_FRICTION`、
   `FOCUSED`、`CONFUSED`、`OVERLOADED`、`DISTRACTED`、`INTERRUPTED`、`RESUMING`。
7. **已知限制**：状态质量取决于事件质量；浏览器侧事件需要扩展或模拟器。
8. **依赖**：事件契约 + store。
9. **怎么验证**：`learning-state` 单测（含乱序、重复事件、确定性重放）。

#### B2 「我卡住了」六类原因 — E2E 验证

1. **定位**：让学习者用一个词说清卡在哪，而不是打一段话。
2. **用户怎么用**：Focus 页点「我卡住了」→ 六选一。
3. **何时发生**：用户主动；原因决定随后走哪条确定性规则。
4. **永不做什么**：不猜原因（无原因不等于默认某个原因）；原因不进入长期画像。
5. **数据与边界**：原因以 `HELP_REQUESTED` 事件落库；六项闭合集合：`cannot-start`、`too-big`、
   `do-not-understand`、`went-wrong`、`cannot-recall`、`tired`。
6. **状态与证据**：E2E 验证 — `534bc1c` (#100)，PR #100。
7. **已知限制**：原因被记录后，真正「改写任务」的动作仍未实现（AG4）。
8. **依赖**：B1。
9. **怎么验证**：`packages/shared-types/src/stuck.ts` 的闭合枚举 + IPC 校验拒绝未知值。

#### B3 干预策略（确定性） — CI 绿

1. **定位**：什么时候该安静、什么时候给一个具体动作，由规则决定。
2. **用户怎么用**：建议以卡片出现，可接受或忽略。
3. **何时发生**：确定性策略；**模型只生成内容，不决定是否打断**。
4. **永不做什么**：不在冷却期内反复打断；不因连续求助而升级为诊断性判断。
5. **数据与边界**：action 为闭合集合，共 8 个，其中第一个就是“安静”：`NO_ACTION`、`MICRO_START`、
   `SIMPLIFY`、`HINT`、`EXAMPLE`、`QUESTION`、`BREAK`、`RESUME`。`NO_ACTION` 不是占位——engine 在它上面
   分支，UI 不显示卡片，outcome 不把它计入接受率分母：它就是“不打扰”这条产品的实现。
6. **状态与证据**：CI 绿 — `packages/intervention-policy`。
7. **已知限制**：多数建议仍是文案层，未接到可执行动作（AG8）。
8. **依赖**：B1。
9. **怎么验证**：`intervention-policy` 单测（映射唯一性、冷却、优先级）。

#### B4 干预结果记录 — CI 绿

1. **定位**：记下建议被展示、接受、拒绝还是导致完成，供后续评估。
2. **用户怎么用**：无感；结果出现在 Dashboard。
3. **何时发生**：由用户对建议的动作触发。
4. **永不做什么**：不把结果当成能力评价，不生成画像。
5. **数据与边界**：`InterventionOutcome` 事件落本机；保存 requestId 关联，不保存诊断性字段。
6. **状态与证据**：CI 绿 — engine 派发 + Dashboard 汇总。
7. **已知限制**：「成功」的定义在 Rescue 评估器里才统一（§4.C3、B5）。
8. **依赖**：B3。
9. **怎么验证**：engine 单测 + Dashboard 断言。

#### B5 Rescue 计划与成功评估器 — 分支完成

1. **定位**：把「换个说法」变成「下一步做什么」，并回答救援有没有起作用。
2. **用户怎么用**（分支 `0f19c9f`）：接受建议后看到具体微步骤；Dashboard 看救援结果。
3. **何时发生**（分支）：确定性：`decideIntervention`（已合并）→ `buildRescuePlan` → `evaluateRescueSuccess`（后两者在 `0f19c9f`）。
4. **永不做什么**：不复制一套 reason/action 参考表（eval 直接驱动生产纯函数）。
5. **数据与边界**：`shared-types/src/rescue.ts` + `intervention-policy/src/rescue.ts`；事件落本机。
6. **状态与证据**：**分支完成** — `feat/agent-phase1-evals-rescue` @ `0f19c9f`，**当前没有 PR**。
7. **已知限制**：未合并；桌面链路与 BREAK 计时器的 E2E **在本机未通过**（`main` 上 `golden path` 为绿），归因见 #107。
8. **依赖**：B2、B3、B4；完整六类 e2e 依赖 AG4/AG8 的动作契约。
9. **怎么验证**：18 个 AG2 JSON 场景（happy/edge/adversarial）重复运行结果一致。

### C. 中断与恢复

#### C1 Learning Checkpoint — CI 绿

1. **定位**：跨过中断保存「我在哪、下一步是什么」。
2. **用户怎么用**：无感；恢复时读到的就是它。
3. **何时发生**：检测到标签离开或 idle 超阈值时，由确定性规则创建。
4. **永不做什么**：不保存诊断性结论；同一 interruption 不重复建卡。
5. **数据与边界**：当前课程/概念/任务/步骤、已掌握、未解决、下一步；写本机 SQLite。
6. **状态与证据**：CI 绿 — `buildCheckpoint` + 幂等持久化 + 重启后可读。
7. **已知限制**：内容主要从任务进度推导，尚未纳入 Tutor/救援产生的具体卡点。
8. **依赖**：事件契约 + store。
9. **怎么验证**：`continuity` 单测（幂等、重启一致）。

#### C2 Resume Card（统一版） — E2E 验证

1. **定位**：回来时不用重新想「我刚才在干什么」。
2. **用户怎么用**：返回后看到卡片 → 继续 或 忽略。
3. **何时发生**：中断结束后由确定性规则展示。
4. **永不做什么**：不显示未授权历史；不因离开就重讲一遍。
5. **数据与边界**：卡片内容来自 checkpoint；记录展示/接受/忽略时间与恢复延迟。
6. **状态与证据**：E2E 验证 — `packages/continuity/src/resume.ts` + `golden path`。
7. **已知限制**：只有一档，不区分离开 1 分钟还是 1 天。
8. **依赖**：C1。
9. **怎么验证**：`continuity` 单测 + `golden path`。

#### C3 Resume 三档与重新参与指标 — 分支完成

1. **定位**：离开越久，回来的门槛就越高，需要不同的开场。
2. **用户怎么用**（分支 `0f19c9f`；`main` 只有统一卡，不分档）：Short 直接继续；Medium 看完整回顾；Long 先做 30 秒快速回忆。
3. **何时发生**（分支）：确定性：`gapMs` 决定档位（15 分钟、24 小时两个边界）。
4. **永不做什么**：不新增事件类型、不复制聚合数据、不把 pending 当作失败。
5. **数据与边界**（分支）：`variant` / `gapMs` / `refresher` 由 gap 派生；阈值集中在 `ResumePolicyConfig`——这个类型与 15 分钟/24 小时阈值在 `0f19c9f` 上，**`main` 上不存在**。
6. **状态与证据**：**分支完成** — `0f19c9f`，**无 PR**。
7. **已知限制**：未合并；且现有「成功率」口径过宽（求助也算成功），必须按
   [Resume 策略与指标](./resume-policy-and-success.md) 拆成 `reengaged` / `progressed` / `stalledAgain`。
8. **依赖**：C1、C2；adaptive 恢复依赖 AG4。
9. **怎么验证**：9 个 AG5 JSON 场景，直接驱动生产 continuity 纯函数。

### D. 观察与复盘

#### D1 Dashboard — CI 绿

1. **定位**：让学习者（和开发者）看到过程，而不是只看结果。
2. **用户怎么用**：查看 Session 时长、完成任务、中断次数、恢复延迟、干预结果。
3. **何时发生**：读取时从事件重算。
4. **永不做什么**：不把统计写成能力或人格评价。
5. **数据与边界**：全部来自本机事件与 Session，无远端分析服务。
6. **状态与证据**：CI 绿 — `dashboard.page.ts` + 重算逻辑单测。
7. **已知限制**：`0f19c9f` 里新增的 success/pending 展示未合并。
8. **依赖**：事件契约。
9. **怎么验证**：desktop 单测（重算一致性）。

#### D2 Insights（四个时间窗） — CI 绿

1. **定位**：把单次 Session 之外的趋势也看得到。
2. **用户怎么用**：当前 Session / 今天 / 近 7 天 / 全部时间四个窗口切换。
3. **何时发生**：读取时派生。
4. **永不做什么**：不做跨用户比较，不做能力排名。
5. **数据与边界**：状态时间分布、活动日历、课程占比；全部本机重算。
6. **状态与证据**：CI 绿 — insights 组件 + 派生函数单测。
7. **已知限制**：窗口固定，不可自定义。
8. **依赖**：D1。
9. **怎么验证**：desktop 单测 + `golden path`。

#### D3 学习事件时间线 — CI 绿

1. **定位**：可追溯的事件记录，是其他一切派生结果的唯一事实源。
2. **用户怎么用**：在 Dashboard 查看任务、求助、中断、恢复等事件。
3. **何时发生**：每次领域动作产生一条。
4. **永不做什么**：事件不可变；派生视图不得成为第二事实源。
5. **数据与边界**：append-only，写本机 SQLite；相邻重复事件在展示层折叠。
6. **状态与证据**：CI 绿 — event log + 折叠逻辑单测。
7. **已知限制**：展示层折叠不改变底层事实，导出时仍是原始条数。
8. **依赖**：persistence migrations。
9. **怎么验证**：`persistence` 单测（append-only、重启后一致）。

### E. 环境与集成

#### E1 浏览器 Bridge（MV3 扩展） — CI 绿

1. **定位**：让「切走标签」这类真实分心信号进入桌面应用。
2. **用户怎么用**：可选安装扩展；不装也能用模拟器。
3. **何时发生**：扩展侧检测活动标签与 idle，向本机发送元数据。
4. **永不做什么**：不申请页面访问权限，因此读不到 URL、标题、正文、输入框、Cookie、历史。
5. **数据与边界**：只发活动/离开/返回/时长/防重放事件 id；bridge 只监听 `127.0.0.1`，token 每次
   启动重生成，并校验协议版本、消息大小、事件类型与 payload。
6. **状态与证据**：CI 绿 — 扩展目录 + bridge 单测。
7. **已知限制**：只覆盖 Chrome/Edge。
8. **依赖**：IPC bridge。
9. **怎么验证**：bridge 单测（拒绝未知协议/超大消息/伪造事件）。

#### E2 Demo Event Simulator — CI 绿

1. **定位**：不装扩展也能演示分心、返回、困惑、过载与成功。
2. **用户怎么用**：开发版界面上按按钮产生事件。
3. **何时发生**：用户主动。
4. **永不做什么**：不在打包版本出现。
5. **数据与边界**：产生与扩展同一套核心事件，无额外字段。
6. **状态与证据**：CI 绿 — 打包版隐藏由构建期开关控制。
7. **已知限制**：只覆盖已建模的事件类型。
8. **依赖**：事件契约。
9. **怎么验证**：desktop 单测 + 打包 smoke。

#### E3 中英文界面 — E2E 验证

1. **定位**：中英文都能用，且不会漏翻。
2. **用户怎么用**：设置里切换语言。
3. **何时发生**：渲染期查表；领域层不参与。
4. **永不做什么**：**领域包不产生用户可见句子**（架构硬规则）。
5. **数据与边界**：`messages.en.ts` 定义键集，`messages.zh.ts` 是
   `Record<MessageKey, string>`，漏一个键即 typecheck 失败；占位符一致性有专门测试。
6. **状态与证据**：E2E 验证 — i18n 目录 + 占位符测试 + `golden path` 中文断言。
7. **已知限制**：**AG3 的 fallback 文案目前由领域层返回英文句子**（分支 `d1e6b03`，PR #101，未合并），违反本规则，待修（§4.F3）。
8. **依赖**：`shared-types` 的闭合键词汇表。
9. **怎么验证**：`pnpm typecheck`（漏键即失败）+ 占位符测试。

#### E4 主题 — CI 绿

1. **定位**：跟随系统或固定浅色/深色。
2. **用户怎么用**：设置里选择。
3. **何时发生**：读取时应用。
4. **永不做什么**：不在样式里写死颜色值。
5. **数据与边界**：设置存本机；样式只允许用设计 token（门禁校验）。
6. **状态与证据**：CI 绿 — token 门禁 `verify:tokens`。
7. **已知限制**：无自定义配色。
8. **依赖**：`styles.css` 的 token 定义。
9. **怎么验证**：`pnpm verify:tokens`。

#### E5 离线运行 — E2E 验证

1. **定位**：没有网络、没有账号、没有 API Key，核心流程一样能走完。
2. **用户怎么用**：什么都不配置，直接用。
3. **何时发生**：始终；远端 Provider 是可选增强。
4. **永不做什么**：不在离线时伪装成有模型回答。
5. **数据与边界**：Mock Provider 只用于确定性离线路径；无中央业务服务器。
6. **状态与证据**：E2E 验证 — `golden path`。**注意一处尚未达成的封闭性**：`main` 的 e2e 启动不会清除
   `FOCUSLOOP_DEEPSEEK_API_KEY`（`golden-path.spec.ts` 只传 `FOCUSLOOP_DEV`），所以如果开发机导出了这个变量，
   这条路径就在跑真实 Provider，而不是它声称的离线路径。
7. **已知限制**：离线时没有模型级问答。
8. **依赖**：llm-provider 的 provider 选择。
9. **怎么验证**：`pnpm e2e`（即上条注明的封闭性问题修复后，才算验证了离线路径）。

#### E6 可选 DeepSeek Provider — 已合并

1. **定位**：想用远端模型时才加载它，默认不存在。
2. **用户怎么用**：设置 `FOCUSLOOP_DEEPSEEK_API_KEY` 等环境变量；界面显示当前运行模式。
3. **何时发生**：启动时根据环境变量决定。
4. **永不做什么**：不写 Key 到仓库或数据库；不在 `main` 的 UI 流程里静默调用。
5. **数据与边界**：基础 URL 规范化和错误归类在 `llm-provider`；当前 `main` 的正常 UI 流程**不会**
   发问给模型（Tutor 才需要，见 §4.F3）。
6. **状态与证据**：已合并 — `packages/llm-provider`；`b3822b5` (#70) 修过 CodeQL ReDoS。
7. **已知限制**：无结构化输出、无 abort、无流式、无 token 预算（AG9）。
8. **依赖**：AG9 才能成为统一 Runtime。
9. **怎么验证**：`llm-provider` 单测（错误归类、URL 规范化）。

#### E7 Agent Inspector (Context + Outbound) — Outbound 已交付

1. **定位**：看清「Agent 现在能看到什么」（Context）与「这一次实际发给 Provider 什么」（Outbound）。
2. **用户怎么用**：开发模式打开面板，切换 Context / Outbound 两个 Tab。
3. **何时发生**：Context 每次刷新读取；Outbound 在每次 Tutor ask 之后更新（仅内存）。
4. **永不做什么**：不是完整数据库视图；Outbound 内容不落库、不写日志；打包构建不显示面板。
5. **数据与边界**：Context 展示 AG1 报告（omission 与截断）；Outbound 展示 system+prompt 原文与
   `system.length + prompt.length` 字符数（与预算公式一致）；未发送时显示空态。
6. **状态与证据**：Context 已合并 — `63acc28` (#99)；Outbound — 本 issue (#112)。
7. **已知限制**：两层报告，差异可解释（Tutor 在 AG1 之上再裁剪）；离线/无模型时 Outbound 为空是预期。
8. **依赖**：AG1、AG3（有出站才可看）。
9. **怎么验证**：engine 单测（字符数 = 实际交给 provider 的字符串长度）+ IPC `parseSessionId` +
   e2e 空态/Tab 切换。

### F. Agent 能力（AG1–AG10）

#### F1 AG1 Learning Context — 已合并

1. **定位**：给 Agent 一个有界、可解释的「当前时刻」视图。`main` 上它**有界但不做字段级剥离**；字段级受控的投影在分支 `0f19c9f`。
2. **用户怎么用**：间接（Tutor / Rescue / Resume 都读它）；开发模式可在 Inspector 查看。
3. **何时发生**：每次需要上下文时由同一个 builder 构建。
4. **永不做什么**：不带其他课程内容、完整日志、密钥、URL。**注意 `main` 的限制**：事件是作为完整 `LearningEvent` 传递的，因此 `id`、`sessionId` 与 `payload`（含 `TAB_LEFT.origin`）会随上下文进入模型；剥离它们与拒绝未知字段是分支 `0f19c9f` 的投影做的事。
5. **数据与边界**：材料 1200 字符、最近 12 条事件，超限记为 omission。**checkpoint 在 `main` 上是原样传递的**（`shared-types/src/agent-context.ts` 的注释就是这么写的）；有界摘要与“非法/超长输入被拒绝”都在分支 `0f19c9f`。
6. **状态与证据**：已合并 — `63acc28` (#99)；`shared-types/src/agent-context.ts` +
   `agent-core/src/agent-context.ts`。
7. **已知限制**：其一，**Inspector 一致性必须按两个视图理解**——「Agent Context Inspector」显示
   Agent 可访问的数据，「Outbound Request Inspector」**已交付**（#112）显示这次实际发给 Provider 的内容。
   二者不可能相同，因为 Tutor 会在 AG1 上下文之上再裁剪。方案页原先要求「完全一致」的表述已修正。
   其二，`main` 上只有边界与 omission；**13 类事件的逐类型投影 allowlist
   （`AgentContextEvent`）只存在于分支 `0f19c9f`**，未合并。
8. **依赖**：事件契约、store、material parser、IPC。
9. **怎么验证**：AG1 deterministic 场景（正常、无 session、材料/事件边界、跨课程隔离、恶意 payload、
   敏感哨兵）——**场景在分支 `0f19c9f`（`packages/agent-evals`），`main` 上只能用 `agent-core`/IPC 单测验证。**

#### F2 AG2 Stuck Rescue — 已合并（动作层未闭环）

1. **定位**：学习者说清卡点后，给一个能立刻做的动作，并记录结果。
2. **用户怎么用**：六选一 → 接受/忽略建议 → 继续任务。
3. **何时发生**：原因 + 状态 + 确定性策略。
4. **永不做什么**：不猜原因；不自动改计划；不静默升级打扰频率。
5. **数据与边界**：原因、建议、结果都作为事件落本机。
6. **状态与证据**：已合并 — `534bc1c` (#100)；Rescue 计划与评估器在 `0f19c9f`（分支完成）。
7. **已知限制**：`SIMPLIFY` / `MICRO_START` 仍是文案，未真正缩小或拆分任务；这是 AG4 的活。
8. **依赖**：F1；可执行动作依赖 AG8。
9. **怎么验证**：`intervention-policy` 单测 + 18 个 AG2 场景（分支上）+ `golden path`。

#### F3 AG3 Contextual Tutor — PR 已开（#101）

1. **定位**：围绕**当前这一步**问六个具体问题，而不是「随便问」。
2. **用户怎么用**：Focus 页 → 打开 Tutor → 选模式（EXPLAIN / HINT / EXAMPLE / SOCRATIC /
   CHECK_MY_ANSWER / SUMMARIZE）→ 提问。
3. **何时发生**：用户主动提问；模型只生成内容，是否打断与是否记录学习事件由确定性规则决定
   （**提问不产生学习事件**）。
4. **永不做什么**：渲染进程不能提供对话历史（只能发 `sessionId` + `mode` + `question`，避免把字塞进
   模型嘴里）；`CHECK_MY_ANSWER` 不得只说 Yes/No；不伪造材料来源；不越权访问其他 session。
5. **数据与边界**：`TUTOR_LIMITS` 关闭集合——保留 8 轮、问题 2000 字符、答案保留 600 字符、每个 part
   600 字符、上下文块每字段 800 字符，整个 prompt 以一个**总量**上界约束；transcript 只在主进程内
   存续，`endSession` 时遗忘。
6. **状态与证据**：**PR 已开** — [#101](https://github.com/nianpingy-cpu/focusloop/pull/101)，
   head `feat/ag3-contextual-tutor` @ `d1e6b03`；9 项必需检查全绿。
7. **已知限制**：**未合并**。另有一个已确认的架构违规：`agent-core/src/tutor-ask.ts` 的
   `describeUnavailable` / `describeRejection` 返回英文句子，`tutor-panel.component.ts` 直接渲染
   `{{ result.reason }}`，因此中文界面会出现英文——违反「领域层不产生句子」。已开 issue 单独修
   （不在 #101 内解决，避免让已评审的 PR 反复改写）。
8. **依赖**：F1（上下文）、AG9（abort/流式），质量基线依赖 AG10。
9. **怎么验证**：`tutor.spec.ts`、`tutor-ask.spec.ts`、`tutor-view.spec.ts` + `golden path` 第 18 个
   测试（提问、fallback、Escape 关闭、答案不跨步骤存活）。

#### F4 AG4 Task Adaptation — 设计完成

1. **定位**：任务太大或形式不合适时，**提议**一个更小的任务，而不是替学习者决定。
2. **用户怎么用**：看到前后对比（时长、内容、原因）→ 接受或保持原样。
3. **何时发生**：确定性 builder 提议；模型不直接执行。
4. **永不做什么**：未确认不写结构性变更；不生成无关内容；不破坏进度与位置语义。
5. **数据与边界**（计划）：`AdaptiveTask`、`AdaptationProposal`、`SessionPlanRevision`；
   子任务 1–5 分钟且保留 parent 关系。
6. **状态与证据**：设计完成 — 方案页 AG4；`main` 上只有 `SIMPLIFY` 这个动作名。
7. **已知限制**：完全没有实现。**依赖顺序已修正**：AG4 只依赖 AG8 的
   confirmation/idempotency primitive；原先「依赖 AG7 episodic schema」的写法会造成依赖倒置（AG7 排在
   AG4 之后），已改为「如需 episodic 查询，拆出 AG7a 并提前」。
8. **依赖**：AG8 确认/幂等；AG10 安全场景。
9. **怎么验证**：待实现；验收要求见方案页 AG4 测试矩阵。

#### F5 AG5 Cognitive Resume — 已合并（三档在分支）

1. **定位**：中断之后最短路径回到原来的任务。
2. **用户怎么用**：Resume Card 三档（见 §4.C3）。
3. **何时发生**：确定性（gap 分档 + interruption 检测）。
4. **永不做什么**：不重复讲解（短离开）；不恢复到「下一个未完成任务」而不是 checkpoint 的位置。
5. **数据与边界**：`LearningCheckpoint`、`ResumeCardTiming`（已在 `main`）——阈值集中在 `ResumePolicyConfig`（**分支** `0f19c9f`；`main` 上不存在这个类型）。
6. **状态与证据**：已合并（统一卡）— `packages/continuity`；三档与指标在 `0f19c9f`（分支完成）。
7. **已知限制**：指标口径必须改名（§4.C3）；adaptive 恢复与材料定位未做。
8. **依赖**：C1；adaptive 恢复依赖 AG4。
9. **怎么验证**：`continuity` 单测 + 9 个 AG5 场景（分支上）+ `golden path`。

#### F6 AG6 Learning Reflection — 设计完成

1. **定位**：一周之后回头看，哪些做法对自己有效——以证据说话。
2. **用户怎么用**（计划）：看复盘卡 → 每项建议能看到样本量与时间窗 → 确认 / 保持 / 删除。
3. **何时发生**：只从行为事实统计，不推断人格。
4. **永不做什么**：不输出诊断或能力标签；观察到的偏好不得自动成为长期存储。
5. **数据与边界**（计划）：`LearnerPreference`、`ReflectionPeriod`；偏好只在显式确认后保存。
6. **状态与证据**：设计完成 — 方案页 AG6。
7. **已知限制**：未实现；硬门槛是 AG7 的 preference 检查/删除先交付。
8. **依赖**：AG7。
9. **怎么验证**：待实现。

#### F7 AG7 Agent Memory — 设计完成

1. **定位**：记忆分层且**可检查、可删除**，不是黑箱画像。
2. **用户怎么用**（计划）：隐私页查看 scope、来源、时间与删除影响；清除前确认。
3. **何时发生**：Working 从当前 session 派生；Episodic 是已有事实的查询；Preference 走 AG6 确认。
4. **永不做什么**：不复制完整日志或材料；不存诊断/智力/人格/心理健康推断。
5. **数据与边界**（计划）：`getMemorySummary` / `listMemory` / `deletePreference` /
   `clearAgentMemory`；每类有 purpose、来源、保留期、读取者。
6. **状态与证据**：设计完成 — 方案页 AG7；episodic 数据本身已存在（events / checkpoints /
   outcomes / resume_cards）。
7. **已知限制**：**删除语义尚未冻结**（分析发现 #9）。必须在实现前明确定义：物理删除 / 软删除 /
   访问 tombstone、Dashboard 是否仍可使用、审计日志是否保留被删对象标识、缓存与派生结果如何失效。
   否则「数据还在但 Agent 看不到」只是一句愿望。
8. **依赖**：隐私 ADR、persistence migrations。
9. **怎么验证**：待实现；需包含删除后不可回流的回归测试。

#### F8 AG8 Tools & Actions — 设计完成

1. **定位**：让模型能**请求**动作，但永远不能直接动数据。
2. **用户怎么用**（计划）：结构性变更弹出待确认参数、影响与撤销入口。
3. **何时发生**：LLM 结构化 tool call → 校验 → 领域命令 → 学习事件。
4. **永不做什么**：LLM 永不直写 SQLite；不能传 SQL 或任意 IPC channel。
5. **数据与边界**（计划）：`AgentTool`、`ToolCall`、`ToolAudit`；工具分 Safe Read /
   Reversible Write / Structural Write 三类权限。
6. **状态与证据**：设计完成 — 方案页 AG8；`main` 上只有既有领域命令，没有 tool contract。
7. **已知限制**：未实现；它的 confirmation/idempotency 是 AG4 的硬门槛。
8. **依赖**：AG9 结构化输出。
9. **怎么验证**：待实现；需含越权、重放、TOCTOU 与坏 schema 的对抗用例。

#### F9 AG9 Model Runtime — 设计完成

1. **定位**：把「用哪个模型、超时怎么办、降级成什么」收进一层，业务不再关心 Provider。
2. **用户怎么用**（计划）：Runtime Info 显示 provider / model / offline / degraded。
3. **何时发生**：skill 只依赖 runtime 接口。
4. **永不做什么**：日志不记 prompt 原文；Provider 不接收未授权字段；abort 后不提交迟到结果。
5. **数据与边界**（计划）：`RuntimeResult { status, output, provider, usage, latency, degraded,
failure }`、`ProviderHealth`。
6. **状态与证据**：设计完成 — `main` 上只有 `AIProvider` 抽象、Mock/DeepSeek 与简单 fallback。
7. **已知限制**：**数据模型需要拆分**（分析发现 #10）：`AbortSignal` 不能跨 IPC 序列化，也不能进持久
   化层，必须拆成可序列化的 `RuntimeRequestData` 与仅进程内存在的
   `RuntimeExecutionOptions { signal }`。另外「流式」与「严格结构化输出」不是天然兼容，应分别定义
   「流式文本」与「最终结构化结果」的接口，而不是笼统要求同时支持。
8. **依赖**：共享 provider 契约；AG10 一致性测试。
9. **怎么验证**：待实现；需要 conformance suite（成功/超时/401/限流/坏 JSON → fallback）。

#### F10 AG10 Evaluation & Guardrails — 分支完成

1. **定位**：把「这次改得好不好」变成可重放、可在 CI 阻断合并的证据。
2. **用户怎么用**：无感（开发者与 CI 使用）。
3. **何时发生**：开发/CI 时运行固定场景。
4. **永不做什么**：不从生产应用上报评测数据；场景不得含真实用户数据。
5. **数据与边界**（分支 `0f19c9f`）：`packages/agent-evals`——版本化场景、受限路径解析、确定性 runner、结果与隐私
   断言；AG1 ×6、AG2 ×18、AG5 ×9 个 JSON 场景。
6. **状态与证据**：**分支完成** — `0f19c9f`，**无 PR**；`main` 上只有工程测试与 CI 门禁。
7. **已知限制**：未合并；仍是 deterministic、同步、JSON-only runner，不含真实模型评测、provider 或
   工具安全套件。评测报告仅在开发者本机或 CI 中生成；生产应用不做遥测、分析或崩溃上报，
   与 `docs/privacy.md` 一致。
8. **依赖**：横切全阶段。
9. **怎么验证**：`pnpm test`（`agent-evals` 项目，分支上）+ 仓库级 required checks。

### G. 工程与质量护栏（精简）

| 能力                 | 状态   | 说明与证据                                                                            |
| -------------------- | ------ | ------------------------------------------------------------------------------------- |
| Monorepo / pnpm / Nx | 已合并 | `pnpm-workspace.yaml`、`nx.json`；包边界由 eslint 约束                                |
| CI 必需检查          | CI 绿  | `quality` ×3 OS、`golden path` ×2、`package (smoke)`；运行链接见 §1.1                 |
| 分支保护             | 已合并 | **（仓库设置，无法从 checkout 校验）** strict、“不允许绕过上述设置”、无 auto-merge    |
| IPC 信任边界         | CI 绿  | Electron sandbox + `contextIsolation` + 白名单 channel + 二次校验；`main` 检查同 §1.1 |
| 持久化迁移           | CI 绿  | append-only migrations + 空库/旧库测试；`main` 检查同 §1.1                            |
| i18n 编译期强制      | CI 绿  | 漏键即 typecheck 失败；占位符一致性测试；`main` 检查同 §1.1                           |
| 主题 token 门禁      | CI 绿  | `verify:tokens` 禁止字面色值；`main` 检查同 §1.1                                      |
| 文档与工作流门禁     | CI 绿  | `verify:docs`、`verify:workflows`、`verify:scaffolding`；`main` 检查同 §1.1           |
| Release 流程         | 已合并 | `release.yml`；当前只有一个 **Draft** `v0.1.0-demo`，未正式发布                       |

> G 区（工程与质量护栏）是基线能力：没有“引入 monorepo”这样的单一 merge commit 可引，所以这几行的
> 证据指向实现它的文件，并统一引用 §1.1 里 `main` 的必需检查；门禁行同时给出实现它的脚本名。
> AG1–AG10 的每一行则必须给出 commit 或 PR，**不适用本节的放宽**。唯一的例外是“分支保护”：它是
> 仓库设置，任何 checkout 都无法校验，已在行内标明。

## 5. 当前明确不支持

以下不得被描述为当前产品功能：

- PDF / Word / 网页材料导入、移动端、多人协作、云端账号与同步；
- 自动诊断 ADHD 或其他心理/认知状态；摄像头、麦克风、眼动、屏幕录制；
- Agent 自动或静默改写学习计划；长期学习者画像；
- 模型直接访问数据库、文件系统或任意 Electron IPC；
- 已发布的 Contextual Tutor、Task Adaptation、Reflection、完整 Agent Tool System、
  已合并的 Agent Eval 门禁；
- 任何形式的遥测、分析或崩溃上报（见 §4.F10）。

## 6. 维护约定

- 本页与 [实施进度](./implementation-progress.md) 的状态只允许使用 §1.1 的七级阶梯，**不得越级**。
- 每次功能合并同步更新：状态、证据链接、已知限制、验收结果。
- 未合并分支的成果只能标「分支完成」，并在“已知限制”里写明分支名与 commit。
- 分支被合并、关闭或重写后，本页必须同步更新；否则本页不再具备台账资格。
