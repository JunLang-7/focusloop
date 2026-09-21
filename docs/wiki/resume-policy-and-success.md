# AG5 Resume 三档与成功指标

## 本阶段目标

在不调用模型、不增加事件类型、不复制聚合数据的前提下，让 Resume Card 根据真实离开时长选择恢复强度，并回答“接受恢复后，学习者是否真的继续了当前任务”。

本阶段不包含 Tutor/救援卡点摘要、adaptive task 恢复、长期记忆或材料章节跳转。

## 三档策略

| 档位   | gap 范围                   | 展示策略                                                    |
| ------ | -------------------------- | ----------------------------------------------------------- |
| Short  | `0 <= gap < 15 分钟`       | 保留标题、上次上下文和下一步；隐藏展开式“已完成/未解决”列表 |
| Medium | `15 分钟 <= gap < 24 小时` | 展示完整但有界的已完成、未解决和下一步                      |
| Long   | `gap >= 24 小时`           | 在 Medium 内容前增加固定 30 秒快速回忆                      |

等于边界时进入更高档。阈值通过 `ResumePolicyConfig` 配置；无法可靠计算 gap 时返回 `gapMs = null`，保守使用 Medium。

gap 优先取最新有效 `TAB_RETURNED.awayMs` 或 `IDLE_ENDED.idleMs`。时间 tick 已生成卡片但尚无返回事件时，使用最近的 `TAB_LEFT` 或 `IDLE_STARTED` 到建卡时刻的差值。负数、非有限数和非法时间不进入计算。

## Success 口径

成功窗口为接受卡片后的 5 分钟，表示为 `(acceptedAt, acceptedAt + 5min]`。

只有同一 Session、同一 checkpoint task 的以下事件可作为成功证据：

- `TASK_STARTED`
- `TASK_COMPLETED`
- `QUIZ_CORRECT` / `QUIZ_INCORRECT`
- `HELP_REQUESTED`

窗口内出现至少一条有效证据为 `succeeded`；已接受但窗口尚未结束为 `pending`；窗口结束仍无证据为 `expired`。已拒绝和尚未作出选择的卡片不进入成功率分母。重复 event id 只计算一次。

汇总口径：

```text
rate = succeeded / (succeeded + expired)
```

`pending` 不进入分母，避免把仍在观察窗口内的恢复提前判失败。

## 数据与重启一致性

不新增数据库迁移。`ResumeCardTiming`、`LearningCheckpoint` 和现有学习事件已经包含重算所需事实。Dashboard 每次从这些事实派生 `accepted/succeeded/expired/pending/rate`，因此应用重启后结果保持一致，也不会出现持久化聚合值与事件日志漂移。

## 验收边界

- 1 分钟和 10 分钟为 Short；15 分钟为 Medium；24 小时为 Long。
- Long 必须显示 30 秒回忆提示；Short 不展开两列历史列表。
- 时钟倒退、非法时间和缺失 gap 不崩溃。
- 其他任务、其他 Session、窗口外和接受瞬间之前的事件不计成功。
- AG10 JSON 场景直接调用生产 `@focusloop/continuity` 纯函数，不维护第二套参考策略。
