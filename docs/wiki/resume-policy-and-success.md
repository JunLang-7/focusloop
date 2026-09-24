# AG5 Resume 三档与重新参与指标

> **事实基线**：默认分支 `main` @ `e596d6f`。本页描述的三档与指标**只存在于分支
> `feat/agent-phase1-evals-rescue` @ `0f19c9f`，且该分支当前没有 PR**，因此状态是 **分支完成**；
> `main` 上只有统一版 Resume Card（不分档）。

## 本阶段目标

在不调用模型、不增加事件类型、不复制聚合数据的前提下，让 Resume Card 根据真实离开时长选择恢复强度，并回答“接受恢复后，学习者是否真的继续了当前任务”。

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

## 事件与窗口口径

观察窗口为接受卡片后的 5 分钟，表示为 `(acceptedAt, acceptedAt + 5min]`。

只有同一 Session、同一 checkpoint task 的以下事件可作证据（按当前实现，它们归入 `reengaged`）：

- `TASK_STARTED`
- `TASK_COMPLETED`
- `QUIZ_CORRECT` / `QUIZ_INCORRECT`
- `HELP_REQUESTED`

窗口内出现至少一条有效证据为 `succeeded`（**现实现 = `reengaged`**）；已接受但窗口尚未结束为 `pending`；
窗口结束仍无证据为 `expired`。已拒绝和尚未作出选择的卡片不进入分母。重复 event id 只计算一次。

汇总口径（**当前实现，尚未改名**）：

```text
rate = succeeded / (succeeded + expired)   // 需在合并前改成 reengageRate
```

`pending` 不进入分母，避免把仍在观察窗口内的恢复提前判失败。`progressed` 与 `stalledAgain`
**尚未实现**；在它们实现之前，Dashboard 不得把 `rate` 标成“恢复成功率”。

## 数据与重启一致性

不新增数据库迁移。`ResumeCardTiming`、`LearningCheckpoint` 和现有学习事件已经包含重算所需事实。Dashboard 每次从这些事实派生 `accepted/succeeded/expired/pending/rate`，因此应用重启后结果保持一致，也不会出现持久化聚合值与事件日志漂移。

## 验收边界

- 1 分钟和 10 分钟为 Short；15 分钟为 Medium；24 小时为 Long。
- Long 必须显示 30 秒回忆提示；Short 不展开两列历史列表。
- 时钟倒退、非法时间和缺失 gap 不崩溃。
- 其他任务、其他 Session、窗口外和接受瞬间之前的事件不计成功。
- 指标名必须区分 `reengaged` / `progressed` / `stalledAgain`；UI 文案不得用“成功率”描述 `reengaged`。
- “接受后立刻再次求助”必须能被识别为 `stalledAgain`，而不是成功。
- AG10 JSON 场景直接调用生产 `@focusloop/continuity` 纯函数，不维护第二套参考策略。
