# AG5 Resume 三档与结果指标

> **状态**：本页的结果指标由 PR #119 实现；三档卡片由后续 PR #122 实现。合并状态以各 PR 为准。

## 本阶段目标

在不调用模型、不增加事件类型、不复制聚合数据的前提下，让 Resume Card 根据真实离开时长选择恢复强度，并回答三个分开的问题：接受恢复后是否**再参与**、是否**真的进步**、是否**再次停滞**。

本阶段不包含 Tutor/救援卡点摘要、adaptive task 恢复、长期记忆或材料章节跳转。

## 指标改名（2026-09-22 修正）

原来的口径叫“成功率”，但它的证据里包含 `HELP_REQUESTED`——也就是说 **用户接受恢复后立刻再次求助，
也算“恢复成功”**。这个指标只能说明“重新参与了”，不能说明“恢复成功”。因此拆成三个：

| 指标           | 含义                   | 窗口内证据（同一 Session、同一 checkpoint task）         |
| -------------- | ---------------------- | -------------------------------------------------------- |
| `reengaged`    | 重新产生了当前任务行为 | `TASK_STARTED`、`TASK_COMPLETED`、答题、`HELP_REQUESTED` |
| `progressed`   | 真的往前走了           | `TASK_COMPLETED`、步骤推进、`QUIZ_CORRECT`               |
| `stalledAgain` | 短期又卡住/又离开      | 窗口内再次 `HELP_REQUESTED`、再次中断，或结束 Session    |

Dashboard 若不区分这三者，“成功率”会系统性虚高。**改名与拆分必须在实现进入 `main` 之前完成。**

## 三档策略

| 档位   | gap 范围                   | 展示策略                                                    |
| ------ | -------------------------- | ----------------------------------------------------------- |
| Short  | `0 <= gap < 15 分钟`       | 保留标题、上次上下文和下一步；隐藏展开式“已完成/未解决”列表 |
| Medium | `15 分钟 <= gap < 24 小时` | 展示完整但有界的已完成、未解决和下一步                      |
| Long   | `gap >= 24 小时`           | 在 Medium 内容前增加固定 30 秒快速回忆                      |

等于边界时进入更高档。阈值通过 `ResumePolicyConfig` 配置；无法可靠计算 gap 时返回 `gapMs = null`，保守使用 Medium。

gap 优先取最新有效 `TAB_RETURNED.awayMs` 或 `IDLE_ENDED.idleMs`。时间 tick 已生成卡片但尚无返回事件时，使用最近的 `TAB_LEFT` 或 `IDLE_STARTED` 到建卡时刻的差值。负数、非有限数和非法时间不进入计算。

> 三档卡片 UI 若尚未合入 main，不影响下方结果指标——指标只依赖 timing、checkpoint 与事件。

## 结果指标口径（原「成功率」改名）

观察窗口为接受卡片后的 5 分钟，表示为 `(acceptedAt, acceptedAt + 5min]`。

同一 Session、同一 checkpoint task 的证据分为三类，**互不合并成一个 success 标志**：

| 指标           | 含义             | 窗口内证据                                                                          |
| -------------- | ---------------- | ----------------------------------------------------------------------------------- |
| `reengaged`    | 当前任务行为恢复 | `TASK_STARTED`、`TASK_COMPLETED`、`QUIZ_*`、`HELP_REQUESTED`                        |
| `progressed`   | 真正往前走       | `TASK_COMPLETED`、`QUIZ_CORRECT`                                                    |
| `stalledAgain` | 短期回退         | 再次 `HELP_REQUESTED`、再次打断（`TAB_LEFT`/`IDLE_STARTED`）、或窗口内 Session 结束 |

这里的 **step** 是课程中的一个 `MicroTask`，不是微任务内部的子步骤；当前事件模型没有独立的
`STEP_ADVANCED`。因此需求中的「step advance」以完成 checkpoint 所在微任务的
`TASK_COMPLETED` 表示；仅开始下一任务不会被误算为当前任务的进步。若将来引入任务内部步骤，
应先定义其持久化事件，再扩充本指标，不能从 `TASK_STARTED` 猜测进步。

汇总类型为 `ResumeOutcomeSummary`（字段 `reengaged` / `progressed` / `stalledAgain` / `expired` / `pending`，比率 `reengageRate` / `progressRate`）。**不再存在** `succeeded` / `rate` / `resumeSuccess` 这类把再参与称作成功的名字。

- 窗口内有再参与或停滞证据 → 计入对应计数，`status = observed`。
- 窗口关闭仍无证据 → `expired`。
- Session 在窗口内结束 → `stalledAgain`，**不是**静默 `expired`。
- 已拒绝（`dismissed`）与尚未决定的卡片不进入分母。
- `pending` 不进入任何比率分母。
- 同一 checkpoint 只评估一次；重复 event id 只计一次。
- 一张卡可以同时 `reengaged` 与 `stalledAgain`（接受后立刻再求助即是如此）。

```text
evaluated = accepted - pending
reengageRate = reengaged / evaluated   （evaluated = 0 时为 null）
progressRate = progressed / evaluated
```

**验收场景**（`packages/agent-evals`）：`ag5-accept-then-help-again` — 接受后窗口内立刻再次求助，断言 `reengaged = true` 且 `progressed = false`；旧口径会把它算成成功。

## 数据与重启一致性

不新增数据库迁移（`listResumeTimings` 只读已有 `resume_cards` 行）。`ResumeCardTiming`、`LearningCheckpoint` 和现有学习事件已经包含重算所需事实。Dashboard 每次从这些事实派生 `accepted/reengaged/progressed/stalledAgain/expired/pending` 与两个比率，因此应用重启后结果保持一致，也不会出现持久化聚合值与事件日志漂移。

## 验收边界

- 1 分钟和 10 分钟为 Short；15 分钟为 Medium；24 小时为 Long。
- Long 必须显示 30 秒回忆提示；Short 不展开两列历史列表。
- 时钟倒退、非法时间和缺失 gap 不崩溃。
- 其他任务、其他 Session、窗口外和接受瞬间之前的事件不计证据。
- 接受后立刻再次求助：`reengaged` 而非 `progressed`。
- 指标名必须区分 `reengaged` / `progressed` / `stalledAgain`；UI 文案不得用“成功率”描述 `reengaged`。
- “接受后立刻再次求助”必须能被识别为 `stalledAgain`，而不是成功。
- AG10 JSON 场景直接调用生产 `@focusloop/continuity` 纯函数，不维护第二套参考策略。
