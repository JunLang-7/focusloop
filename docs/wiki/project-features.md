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

| 分组    | 功能                           | 状态       | 证据                                                                                                                    | 当前边界                                                                                                 |
| ------- | ------------------------------ | ---------- | ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| A 学习  | 内置演示课程                   | E2E 验证   | golden path                                                                                                             | 用于演示与开发验证                                                                                       |
| A 学习  | 本机材料导入（`.txt` / `.md`） | E2E 验证   | `af2e74f` (#81)                                                                                                         | 不支持 PDF / Word / 网页抓取                                                                             |
| A 学习  | 课程与微任务生成               | CI 绿      | `micro-task-generator.ts`                                                                                               | 确定性规则，不是模型生成                                                                                 |
| A 学习  | 课程浏览                       | CI 绿      | 课程页 + store 读取                                                                                                     | 单人、本地课程为单位                                                                                     |
| A 学习  | Focus Session 计时             | E2E 验证   | golden path                                                                                                             | 计时由桌面 UI 管理                                                                                       |
| A 学习  | 任务生命周期（暂停/继续/延长） | E2E 验证   | `257efe0` (#76)、`2b4934f` (#75)                                                                                        | 计时结束后延长一分钟                                                                                     |
| B 干预  | 学习状态机（八态）             | CI 绿      | `packages/learning-state`                                                                                               | 确定性状态机，不做心理诊断                                                                               |
| B 干预  | 「我卡住了」六类原因           | E2E 验证   | `534bc1c` (#100)                                                                                                        | 原因先被记录，再决定行动                                                                                 |
| B 干预  | 干预策略（确定性 8 类 action） | CI 绿      | `packages/intervention-policy`                                                                                          | 模型不决定是否打断                                                                                       |
| B 干预  | 干预结果记录与 Dashboard 汇总  | CI 绿      | outcome 事件 + Dashboard                                                                                                | 记录展示/接受/拒绝/完成                                                                                  |
| B 干预  | Rescue 计划与成功评估器        | 已合并     | `ae1d690` (PR #124)                                                                                                     | 接受 MICRO_START 会真正缩小任务（#171）；SIMPLIFY 会拆成 1–5 分钟步骤（#172）                            |
| C 恢复  | Learning Checkpoint            | CI 绿      | `buildCheckpoint` + store                                                                                               | 内容主要从任务进度推导                                                                                   |
| C 恢复  | Resume Card（统一版）          | E2E 验证   | `packages/continuity` + Dashboard                                                                                       | 三档已上屏：短档 #196、长档 #203 的 e2e 钉在策略边界                                                     |
| C 恢复  | Resume 三档 + 重新参与指标     | E2E 验证   | `classifyResumeGap` / `ResumePolicyConfig` / `evaluateResumeOutcome`；`96ac295` (#119)                                  | reengaged/progressed/stalledAgain 已分列；见 §4.C3                                                       |
| D 观察  | Dashboard                      | CI 绿      | 当前 Session 与跨 Session 两类视图                                                                                      | 指标全部本地重算                                                                                         |
| D 观察  | Insights（四个时间窗）         | CI 绿      | 状态占比、日历、课程占比                                                                                                | 不依赖远端分析服务                                                                                       |
| D 观察  | 学习事件时间线                 | CI 绿      | 相邻重复事件折叠                                                                                                        | 是过程记录，不是能力评价                                                                                 |
| E 环境  | 浏览器 Bridge（MV3）           | CI 绿      | 扩展 + 本机 bridge                                                                                                      | 不读 URL / 标题 / 正文 / Cookie                                                                          |
| E 环境  | Demo Event Simulator           | CI 绿      | 开发版显示，打包版隐藏                                                                                                  | 仅开发模式                                                                                               |
| E 环境  | 中英文界面                     | E2E 验证   | `messages.en/zh.ts` + 编译期强制                                                                                        | 设置存本地                                                                                               |
| E 环境  | 主题（跟随系统 / 浅 / 深）     | CI 绿      | token 门禁（禁用字面色值）                                                                                              | 设置存本地                                                                                               |
| E 环境  | 离线运行                       | E2E 验证   | Mock Provider                                                                                                           | 无账号、无网络可完成核心流程                                                                             |
| E 环境  | 可选 DeepSeek Provider         | 已合并     | `packages/llm-provider`                                                                                                 | `main` 的正常 UI 流程不调用它                                                                            |
| E 环境  | Agent Context Inspector（AG1） | **已移除** | 原 `63acc28` (#99)，移除见 §E7                                                                                          | 面板、三个 IPC 通道与 outbound 缓冲一并删除；`AgentContext` 本身不变                                     |
| F Agent | AG1 Learning Context           | E2E 验证   | `63acc28` (#99)；投影穷举 `d938bb8` (#188)                                                                              | 投影与敏感 payload 回归均已合并，见 §4.F1                                                                |
| F Agent | AG2 Stuck Rescue               | E2E 验证   | `534bc1c` (#100)；`2677645` (#181)、`cd6e886` (#183)、`b0fabd8` (#184)                                                  | MICRO_START/SIMPLIFY 真正改写、HINT/EXAMPLE 有 grounding；provider 变体在 #205                           |
| F Agent | AG3 Contextual Tutor           | 已合并     | `107a30f` (#101)                                                                                                        | 领域层已只返回闭合码；`AgentContextOmission.detail` 仍是英文句子                                         |
| F Agent | AG4 Task Adaptation            | 设计完成   | 方案页 AG4；读时派生改写已合并（#171/#172）                                                                             | 无持久化 AdaptiveTask，计划级改写待 AG8 phase 2                                                          |
| F Agent | AG5 Cognitive Resume           | E2E 验证   | `6df7e08` 基线 + `9d2e55d` (#196)、`d9f1783` (#203)、`78555af` (#206)                                                   | 三档、指标分列、长档关键想法均已合并，见 §4.C3                                                           |
| F Agent | AG6 Learning Reflection        | 设计完成   | 方案页 AG6                                                                                                              | 无偏好模型，无复盘链路                                                                                   |
| F Agent | AG7 Agent Memory               | E2E 验证   | [ADR 0001](./adr/0001-agent-memory-deletion.md)、`6a4a0cf` (#129)、`5e3d764` (#221)、`cb2d33a` (#222)、`d40ba0a` (#223) | 三类边界、检查 UI、偏好单项删除、时间窗清理均已合并，见 §4.C3 与 §4.F                                    |
| F Agent | AG8 Tools & Actions            | E2E 验证   | 信封 `bf0844b` (#126)；确认屏 `b870e00` (#218)；`b624064` (#216)、`e59ea9b` (#217)、`d08790f` (#219)                    | contract / 四个读工具 / 权限矩阵 / 工具审计均已合并；写工具（AG8.3–8.5）与模型工具调用解析未实现，见 #93 |
| F Agent | AG9 Model Runtime              | 已合并     | `6c89f97`… 系列 #125/#147/#156/#161/#162；conformance `dc6b0de` (#165)                                                  | 结构化/流式/abort/重试/预算均已合并，见 §4.F9                                                            |
| F Agent | AG10 Evaluation & Guardrails   | E2E 验证   | `656bb70` (#118)、`dc6b0de` (#165)、`3bbcdae` (#186)、`394c061` (#220)                                                  | runner 与场景数据集已合并；剩 AG10.6 = #212                                                              |

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
7. **已知限制**：`MICRO_START`/`SIMPLIFY` 已能真正缩小、拆分当前任务（#171/#172，读时派生，不写课程）；其余动作与计划级改写仍属 AG4。
8. **依赖**：A5；其余动作与计划级改写依赖 AG4 + AG8。
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

#### B5 Rescue 计划与成功评估器 — 已合并（PR #124）

1. **定位**：把「换个说法」变成「下一步做什么」，并回答救援有没有起作用。
2. **用户怎么用**：接受建议后看到具体微步骤；Dashboard 看救援结果。
3. **何时发生**：确定性：`decideIntervention` → `buildRescuePlan` → `evaluateRescueSuccess`（三者均已合并；后两者在 `ae1d690`／PR #124）。
4. **永不做什么**：不复制一套 reason/action 参考表（eval 直接驱动生产纯函数）。
5. **数据与边界**：`shared-types/src/rescue.ts` + `intervention-policy/src/rescue.ts`；事件落本机。
6. **状态与证据**：已合并 — `ae1d690`（PR #124）；engine 派发、Dashboard 汇总与 18 个 AG2 JSON 场景均在 `main`。
7. **已知限制**：`MICRO_START` 已把当前任务缩成首步 + 2 分钟（#171），`SIMPLIFY` 已把任务拆成 1–5 分钟的步骤（#172）；其余动作要真正改写任务前需要 AG4/AG8 的动作契约；六类 E2E 仍缺（AG2.8）。
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
2. **用户怎么用**（`main`，三档已上屏）：Short 直接继续；Medium 看完整回顾；Long 先展示所在概念的关键想法（取自上下文，非生成，#193）；短档 e2e `9d2e55d` (#196)、长档 e2e `d9f1783` (#203)。
3. **何时发生**（分支）：确定性：`gapMs` 决定档位（15 分钟、24 小时两个边界）。
4. **永不做什么**：不新增事件类型、不复制聚合数据、不把 pending 当作失败。
5. **数据与边界**（`main`）：`variant` / `gapMs` / `refresher` 由 gap 派生；阈值集中在 `ResumePolicyConfig`（15 分钟 / 24 小时，类型在 `shared-types`），`classifyResumeGap` 的 spec 钉住三档与两条边界。
6. **状态与证据**：**已合并** — 三档与阈值（`shared-types` + `continuity`）、指标分列 `96ac295` (#119)、短/长档 e2e `9d2e55d` (#196) 与 `d9f1783` (#203)、长档关键想法 `78555af` (#206)；九个 AG5 评测场景在 `packages/agent-evals/src/scenarios/ag5/`。
7. **已知限制**：未合并；且现有「成功率」口径过宽（求助也算成功），必须按
   [Resume 策略与指标](./resume-policy-and-success.md) 拆成 `reengaged` / `progressed` / `stalledAgain`。
8. **依赖**：C1、C2；adaptive 恢复依赖 AG4。
9. **怎么验证**：9 个 AG5 JSON 场景，直接驱动生产 continuity 纯函数。

### D. 观察与复盘

#### D1 Dashboard — CI 绿

1. **定位**：让学习者（和开发者）看到过程，而不是只看结果。
2. **用户怎么用**：查看 Session 时长、**有记录时长**、完成任务、中断次数、恢复延迟、干预结果。
3. **何时发生**：读取时从事件重算。
4. **永不做什么**：不把统计写成能力或人格评价；**不把没观测到的时间写成「离开」**。
5. **数据与边界**：全部来自本机事件与 Session，无远端分析服务。状态占比与「有记录时长」的分母都只包含有证据的时间（见 §D2 §5）。
6. **状态与证据**：CI 绿 — `dashboard.page.ts` + 重算逻辑单测。
7. **已知限制**：长间隔 refresher 之外无未交付项；长档的 "三十秒回忆" 措辞已按 #193 的决策 C 改为「点出关键想法」，epic 与代码一致。
8. **依赖**：事件契约。
9. **怎么验证**：desktop 单测（重算一致性）。

#### D2 Insights（四个时间窗） — CI 绿

1. **定位**：把单次 Session 之外的趋势也看得到。
2. **用户怎么用**：当前 Session / 今天 / 近 7 天 / 全部时间四个窗口切换。
3. **何时发生**：读取时派生。
4. **永不做什么**：不做跨用户比较，不做能力排名。
5. **数据与边界**：状态时间分布、活动日历、课程占比；全部本机重算。**时长只计有证据的时间**：每个事件之后最多一个 idle 阈值（2 分钟）归给当时的状态；`TAB_LEFT`／idle 这类真实事件才算「离开中」；事件之间的静默既不推断状态也不计入时长；未结束的会话，尾部同样只到「最后一个事件 + 一个阈值」为止——因此「有记录时长」是能被证据支持的时长，不等于会话窗口的墙钟时间。
6. **状态与证据**：CI 绿 — insights 组件 + 派生函数单测。
7. **已知限制**：窗口固定，不可自定义。**时长口径**：对外显示的是「有记录时长」（有证据支持的时长），不是会话时长——一段两小时的安静专注只计 2 分钟；如果要把会话时长本身显示出来（并把无法描述的部分单独列一档），那是另一种口径，需要先定下来再改。**尾部到哪里为止**：未结束的会话，尾部只到「最后一个事件 + 一个阈值」；已结束的会话，尾部到「结束会话」那一刻——停止会话本身就是一次在场的动作，所以它的时间戳是尾部值得信任的终点，不需要另外的在场证据。**但重放读到的日志不是无限的**：`listEvents` 默认只取每个会话**最早的 500 条**事件，而 `getInsights` 不传上限，因此事件数超过 500 的会话只会重放到第 500 条，已结束会话的尾部就变成从第 500 条一路算到 `endedAt`——中间那段无人见证的墙钟时间会按当时的引擎状态整段计入（若当时是 `TAB_LEFT`／idle，就是整段「离开中」），正是本规则要消除的那种虚数，只是门槛更高。库里没有任何按时间裁剪日志的策略，唯一的删除是整会话清空（`clearSessionEpisodic`），所以情况不会随时间变坏，但会表现为一段很长的「离开中」。修法有两条：让重放有界地读到会话结束，或给会话一个「多久没动静就算结束」的规则——都要先定下来再改。
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
7. **已知限制**：AG3 的 fallback 已随 `107a30f` (#101) 改为闭合码，由渲染期查表翻译；
   **同类缺口仍在**——`AgentContextOmission.detail` 仍是领域层生成的英文句子（§4.F1），按同一规则待修（§4.F3）。
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

#### E7 Agent Inspector — 已移除

1. **定位**：曾经用于在开发模式查看「Agent 现在能看到什么」（Context）与「这一次实际发给 Provider
   什么」（Outbound），#219 又在同一面板上加了第三个 Tab（工具审计）。
2. **状态**：**三个 Tab 一起移除**（面板 `fl-agent-context-panel`、`core/inspector-visibility.ts`、
   `core/tool-call-view.ts`、三个 IPC 通道 `getAgentContext` / `getOutboundRequest` /
   `listToolCalls`、引擎里的 outbound 缓冲与全部 `agent.inspector.*` 文案，中英各一套）。
   不是隐藏，是删除：没有任何调用方之后，留着通道与文案只是同一件事的半份。
3. **为什么移除**：它不是产品功能，而是开发期调试视图；AG1 的边界与 omission 已经有单测与
   AG1 场景覆盖，出站字符数也已经由 Tutor 预算与 `engine.spec` 的
   `inputCharacters = system.length + prompt.length` 断言保证，因此这块界面没有它自己的读者。
4. **保留了什么**：`AgentContext` 与 `buildAgentContext` 一字节未动——那是 Agent 真正的输入，
   Tutor / Rescue / Resume / 工具契约都读它；`engine.getAgentContext()` 也保留（工具契约内部使用）。
   工具审计的**数据与查询**同样保留（`tool_calls` 表、写前脱敏、`store.listToolCalls` 的 join 与其
   测试）——被删掉的是它的屏幕视图与那条只读通道，不是审计本身。
5. **隐私影响**：`docs/privacy.md` 已同步——「实际发出去的内容」不再有屏幕视图，验证方式回到
   阅读 `deepseek-provider.ts` 的请求体。工作记忆（ADR 0001）从「transcript + 最后一个 outbound
   prompt」变为只有 transcript：该 ADR 的表格与失效表已更新，`AGENT_MEMORY_SOURCES` 从九项减到
   八项，面板上的 `source.outbound` / `impact.outbound` 文案一并删除。
6. **依赖**：无（移除后不阻塞任何能力）。
7. **怎么验证**：删除后 `pnpm test`、四道 gate、以及 desktop e2e 全绿即证明没有遗留读者。

### F. Agent 能力（AG1–AG10）

#### F1 AG1 Learning Context — 已合并

1. **定位**：给 Agent 一个有界、可解释的「当前时刻」视图。`main` 上**有界且做字段级剥离**：事件按 `AgentContextEvent` 的逐类型 allowlist 投影，#188 起为穷举——新增事件类型而不写投影是编译错误，不再可能悄悄从每个上下文里消失。
2. **用户怎么用**：间接（Tutor / Rescue / Resume / 工具契约都读它）。**没有屏幕视图**——AG1 的调试面板（Context 与 Outbound 两个 tab）已整体移除，见 §E7。
3. **何时发生**：每次需要上下文时由同一个 builder 构建（`agent-core/src/agent-context.ts`，对 `AgentContextSource` 纯函数）。
4. **永不做什么**：不带其他课程内容、完整日志、密钥、URL。事件投影后只保留 `type/at/source/payload`——`id` 与 `sessionId` 不进上下文，`TAB_LEFT` 的 payload 为空（origin 在内的所有字段丢弃），未知字段在边界被拒绝；反例由 `sensitive-content-adversarial.json` 在评测层钉住。
5. **数据与边界**：材料 1200 字符、最近 12 条事件、checkpoint 为有界摘要（`AgentContextCheckpoint`：文本/条目/参数上限同在 `AGENT_CONTEXT_LIMITS`），超限记为 omission；非法与超长输入被拒绝且有测试（#97、#188）。
6. **状态与证据**：已合并 — schema 与跨桥契约 `63acc28` (#99)；逐类型投影穷举与敏感 payload 回归 `d938bb8` (#188)；`shared-types/src/agent-context.ts` + `agent-core/src/agent-context.ts`；评测层 `packages/agent-evals/src/scenarios/ag1/`（含隐私类场景，#220）。
7. **已知限制**：原「两个 Inspector 视图」的验收已随面板移除而作废（见 §E7）——Context 显示 Agent 可访问的数据、Outbound 显示本次实际发送的内容，而 Tutor 会在 AG1 之上再裁剪一次，因此两者永不相同；现在这条断言落在引擎侧（`engine.spec`：`inputCharacters = system.length + prompt.length`），不再有界面可核对。
8. **依赖**：事件契约、store、material parser、IPC。

#### F2 AG2 Stuck Rescue — 已合并（动作层未闭环）

1. **定位**：学习者说清卡点后，给一个能立刻做的动作，并记录结果。
2. **用户怎么用**：六选一 → 接受/忽略建议 → 继续任务。
3. **何时发生**：原因 + 状态 + 确定性策略。
4. **永不做什么**：不猜原因；不自动改计划；不静默升级打扰频率。
5. **数据与边界**：原因、建议、结果都作为事件落本机。
6. **状态与证据**：已合并 — `534bc1c` (#100)；Rescue 计划与成功评估器同样已合并（`ae1d690`，PR #124）；`MICRO_START` 接受后真正缩小任务（#171）、`SIMPLIFY` 接受后真正拆成步骤（#172）：确认 + 幂等提案，课程只在读时派生。
7. **已知限制**：其余动作要真正改写任务前需要 AG4/AG8 的动作契约。
8. **依赖**：F1；可执行动作依赖 AG8。
9. **怎么验证**：`intervention-policy` 单测 + AG2 JSON 场景 34 个（18 rescue + 8 rewrite + 8 grounding，已合并，`packages/agent-evals`）+ `golden path`。

#### F3 AG3 Contextual Tutor — 已合并（#101）

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
6. **状态与证据**：**已合并** — `107a30f` (PR [#101](https://github.com/nianpingy-cpu/focusloop/pull/101))；
   必需检查在 `main` 上通过。
7. **已知限制**：**i18n 违规已修复** — 领域层只返回闭合码（`TutorFallbackReason`），
   `describeUnavailable` / `describeRejection` 已不存在，渲染端用 `TUTOR_FALLBACK_KEYS` 出句子，
   中文界面不会再出现英文 fallback。**同类缺口仍在**：`AgentContextOmission.detail` 仍然由
   `agent-core` 拼成英文句子（`agent-context.ts`、`tutor.ts`、`tutor-ask.ts`、`engine.ts` 多处），
   并在 ~~Inspector 与~~ tutor 报告里原样渲染——已开 issue 按同一规则修。
8. **依赖**：F1（上下文）、AG9（abort/流式），质量基线依赖 AG10。
9. **怎么验证**：`tutor.spec.ts`、`tutor-ask.spec.ts`、`tutor-view.spec.ts` + `golden path` 里的中文
   tutor 断言（fallback 文案为中文）与 Escape / 跨步骤存的断言。

#### F4 AG4 Task Adaptation — 设计完成

1. **定位**：任务太大或形式不合适时，**提议**一个更小的任务，而不是替学习者决定。
2. **用户怎么用**：看到前后对比（时长、内容、原因）→ 接受或保持原样。
3. **何时发生**：确定性 builder 提议；模型不直接执行。
4. **永不做什么**：未确认不写结构性变更；不生成无关内容；不破坏进度与位置语义。
5. **数据与边界**（计划）：`AdaptiveTask`、`AdaptationProposal`、`SessionPlanRevision`；
   子任务 1–5 分钟且保留 parent 关系。
6. **状态与证据**：设计完成 — 方案页 AG4；`main` 上有 `MICRO_START`/`SIMPLIFY` 的读时派生改写（#171/#172），但没有持久化的 `AdaptiveTask`/`SessionPlanRevision`。
7. **已知限制**：计划级改写完全没有实现（无持久化任务、无前后对比预览、无 plan revision）。**依赖顺序已修正**：AG4 只依赖 AG8 的
   confirmation/idempotency primitive；原先「依赖 AG7 episodic schema」的写法会造成依赖倒置（AG7 排在
   AG4 之后），已改为「如需 episodic 查询，拆出 AG7a 并提前」。
8. **依赖**：AG8 确认/幂等；AG10 安全场景。
9. **怎么验证**：待实现；验收要求见方案页 AG4 测试矩阵。

#### F5 AG5 Cognitive Resume — 已合并（三档在分支）

1. **定位**：中断之后最短路径回到原来的任务。
2. **用户怎么用**：Resume Card 三档（见 §4.C3）。
3. **何时发生**：确定性（gap 分档 + interruption 检测）。
4. **永不做什么**：不重复讲解（短离开）；不恢复到「下一个未完成任务」而不是 checkpoint 的位置。
5. **数据与边界**：`LearningCheckpoint`、`ResumeCardTiming`、`ResumePolicyConfig`（均在 `main`）——阈值集中在 `ResumePolicyConfig`，15 分钟 / 24 小时两条边界由 `classifyResumeGap` 的 spec 钉住。
6. **状态与证据**：**已合并** — `packages/continuity`；三档在 `main`，指标分列 `96ac295` (#119)（reengaged / progressed / stalledAgain），Dashboard `resumeOutcomes`，九个 AG5 评测场景。
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

#### F7 AG7 Agent Memory — 已合并（ADR 0001，#129）

1. **定位**：记忆分层且**可检查、可删除**，不是黑箱画像。
2. **用户怎么用**（计划）：隐私页查看 scope、来源、时间与删除影响；清除前确认。
3. **何时发生**：Working 从当前 session 派生；Episodic 是已有事实的查询；Preference 走 AG6 确认。
4. **永不做什么**：不复制完整日志或材料；不存诊断/智力/人格/心理健康推断。
5. **数据与边界**（计划）：`getMemorySummary` / `listMemory` / `deletePreference` /
   `clearAgentMemory`；每类有 purpose、来源、保留期、读取者。
6. **状态与证据**：**已合并** — [ADR 0001](./adr/0001-agent-memory-deletion.md)（#110，`6a4a0cf`）；`clearAgentMemory` +
   `agent_memory_clears` 审计与 write→clear→query 回归测试已在 `main` 的 `agent-core` / `persistence` 里；episodic 行本身已存在（events / checkpoints /
   outcomes / resume_cards / `agent_proposals`），清除会连同该 session 的 proposal 行一起删。
7. **已知限制**：**删除语义已按 ADR 0001 冻结**（物理删除；Dashboard 不得使用被清除行；
   审计仅 opaque id + 时间 + actor）。未交付：scope 检查 UI、preference 删除、按时间窗的批量清理。
8. **依赖**：ADR 0001、persistence migrations。
9. **怎么验证**：`agent-core/src/memory-clear.spec.ts`（每类写→清→查空，含 dashboard/context/transcript）
   - `persistence` store 单测。

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

#### F9 AG9 Model Runtime — 已合并

1. **定位**：把「用哪个模型、超时怎么办、降级成什么」收进一层，业务不再关心 Provider。
2. **用户怎么用**（计划）：Runtime Info 显示 provider / model / offline / degraded。
3. **何时发生**：skill 只依赖 runtime 接口。
4. **永不做什么**：日志不记 prompt 原文；Provider 不接收未授权字段；abort 后不提交迟到结果。
5. **数据与边界**（计划）：`RuntimeResult { status, output, provider, usage, latency, degraded,
failure }`、`ProviderHealth`。
6. **状态与证据**：**已合并** — `AgentRuntime`（`llm-provider/src/runtime.ts`）：请求/信号拆分 #111、取消与总截止 #142→#147、预算 #143→#156、流式 #144→#161、重试与回退 #145→#162、AG9 一致性与 provider-failure 场景 `dc6b0de` (#165)；conformance 证据记于 `docs/ag9-conformance.md`，ADR 见 [ADR 0002](./0002-runtime-execution-boundary.md)。
7. **已知限制**：数据模型按分析（原 #10）拆为可序列化的 `RuntimeRequestData` 与仅进程内的 `RuntimeExecutionOptions { signal }`（#111，已合并）；「流式文本」与「最终结构化结果」分别定义（`executeStructured` / `executeStructuredViaStream`）。**尚无 skill 调用结构化门**——`ag9-conformance.md` 如实记为 outstanding，是 AG8 工具调用要进的门。
8. **依赖**：共享 provider 契约；AG10 一致性测试。
9. **怎么验证**：待实现；需要 conformance suite（成功/超时/401/限流/坏 JSON → fallback）。

#### F10 AG10 Evaluation & Guardrails — 已合并

1. **定位**：把「这次改得好不好」变成可重放、可在 CI 阻断合并的证据。
2. **用户怎么用**：无感（开发者与 CI 使用）。
3. **何时发生**：开发/CI 时运行固定场景。
4. **永不做什么**：不从生产应用上报评测数据；场景不得含真实用户数据。
5. **数据与边界**（`main`）：`packages/agent-evals`——版本化场景、受限路径解析、确定性 runner、结果与隐私
   断言。JSON 场景按能力分目录，共 **30** 个：AG1 ×8（含隐私类 3）、AG2 ×9（含 grounding 类 3、干预恰当性类 3）、
   AG3 ×3（follow-up）、AG5 ×9、AG9 ×1；每类 ≥3 个场景，覆盖正常 / 边界 / 失败或越权。
6. **状态与证据**：**已合并** — runner 与 AG1 投影场景 `656bb70`（#118）、AG9 provider-failure `dc6b0de`（#165）、
   rewrite/grounding cases `3bbcdae`（#186）；follow-up、干预恰当性、grounding、隐私四类场景补齐（#211）。
7. **已知限制**：仍是 deterministic、同步、JSON-only runner，不含真实模型评测；工具安全套件（AG10.6）等 AG8 的
   工具契约落地。**遥测口径已选定 (A)**：评测报告仅在开发者本机或 CI 中生成；生产应用不做遥测、
   分析或崩溃上报（见 `docs/privacy.md` 决策节与 #115）。选项 (B) 已否决，除非先改隐私文档。
8. **依赖**：横切全阶段。
9. **怎么验证**：`pnpm test`（`agent-evals` 项目）+ 仓库级 required checks；场景数 = 各能力目录的 JSON 文件数。

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
