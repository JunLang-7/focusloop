# FocusLoop Learning Agent Wiki

> **事实基线**：默认分支 `main` @
> [`e596d6f`](https://github.com/nianpingy-cpu/focusloop/commit/e596d6fd0e4e33e3810744811272eccd9a580437)，
> 核对日期 2026-09-22。本页标注的状态只对应该 commit；`main` 前进后必须同步复核。
>
> **状态只允许七级阶梯**：设计完成 → 分支完成 → PR 已开 → 已合并 → CI 绿 → E2E 验证 → 已发布。
> 未进入 `main` 的实现不得标「已合并」及以上；E2E 被环境阻塞时不得标「完成」。定义与证据要求见
> [功能清单 §1](./project-features.md)。
>
> **测试数量不是证据**。证据是 commit、PR 或 CI run 链接；「N 项测试通过」无法复核。

本 Wiki 将 AG1–AG10 的产品能力映射到当前仓库事实、逐项完善方案、交付顺序和验收证据。

## 从这里开始

- [功能清单：逐项说明与状态](./project-features.md)：每个功能的九个重点（定位、用户怎么用、何时发生、永不做什么、数据与边界、状态与证据、已知限制、依赖、怎么验证）。**判断可用与否只看这一页。**
- [AG1–AG10 逐功能完善方案](./agent-feature-completion-plan.md)：每项能力的范围、数据模型、API/UI、Definition of Done 和测试矩阵。
- [能力现状与实施调度](./delivery-roadmap.md)：当前完成度、主要缺口、依赖、风险、分阶段顺序和 fan-out 边界。
- [实施进度](./implementation-progress.md)：已完成切片、验收证据和下一切片。
- [Resume 三档与成功指标](./resume-policy-and-success.md)：AG5 Phase 1 的阈值、事件口径、派生指标和边界。
- [现有系统架构](../architecture.md)：包边界、状态机、持久化与安全边界。
- [测试策略](../testing.md)：当前测试层级和运行方式。
- [隐私边界](../privacy.md)：local-first、最小数据和浏览器扩展权限。

## 当前判断

| 能力                         | 在 `main` 上的状态 | 证据                                                                             | 下一交付重点                                                                                      |
| ---------------------------- | ------------------ | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| AG1 Learning Context         | E2E 验证           | `63acc28` (#99)；投影穷举 `d938bb8` (#188)                                       | 投影与敏感 payload 回归均已合并；`AgentContextOmission.detail` 仍是英文句子（§4.F3）              |
| AG2 Stuck Rescue             | E2E 验证           | `534bc1c` (#100)；`2677645` (#181)、`cd6e886` (#183)、`b0fabd8` (#184)           | MICRO_START/SIMPLIFY 真正改写、HINT/EXAMPLE 有 grounding；provider 变体在 #205                    |
| AG3 Contextual Tutor         | 已合并             | `107a30f` (#101)                                                                 | 领域层已只返回闭合码；`AgentContextOmission.detail` 仍是英文句子，按同一规则修                    |
| AG4 Task Adaptation          | 设计完成           | 方案页 AG4                                                                       | AdaptiveTask、提案/确认、持久化与恢复；依赖已改为 AG8                                             |
| AG5 Cognitive Resume         | E2E 验证           | `6df7e08` 基线 + `9d2e55d` (#196)、`d9f1783` (#203)、`78555af` (#206)            | 三档、指标分列、长档关键想法均已合并（§4.C3）                                                     |
| AG6 Learning Reflection      | 设计完成           | 方案页 AG6                                                                       | 行为证据、最小样本、确认后偏好                                                                    |
| AG7 Memory                   | E2E 验证           | ADR 0001、`6a4a0cf` (#129)、`5e3d764` (#221)、`cb2d33a` (#222)、`d40ba0a` (#223) | 三类边界、检查 UI、偏好单项删除、时间窗清理均已合并；偏好的产生路径属 AG6                         |
| AG8 Tools & Actions          | E2E 验证           | `e59ea9b` (#217)、`b624064` (#216)、`d08790f` (#219)、确认屏 `b870e00` (#218)    | contract / 四个读工具 / 权限矩阵 / 审计已合并；写工具（AG8.3–8.5）与模型工具调用解析未实现（#93） |
| AG9 Model Runtime            | 已合并             | `6c89f97`… 系列 #125/#147/#156/#161/#162；conformance `dc6b0de` (#165)           | 结构化/流式/abort/重试/预算均已合并（§4.F9）                                                      |
| AG10 Evaluation & Guardrails | E2E 验证           | `656bb70` (#118)、`dc6b0de` (#165)、`3bbcdae` (#186)、`394c061` (#220)           | runner 与场景数据集已合并；剩 AG10.6 = #212                                                       |

> 一眼可见的问题：`main` 上十项 Agent 能力里，只有 AG1、AG2 和基础 AG5 真正落地，AG3 卡在 PR，
> AG10 的评测框架与 AG5/AG2 的切片停在分支上且**没有 PR**。分支成果在开 PR 之前不会进入任何绿状态。

## 交付顺序

1. 契约、ADR 和最小 Eval Harness（AG10 的 deterministic runner 已在分支上完成，缺 PR 与 ADR）。
2. 收口 AG1、AG2、AG3 与基础 AG5：**先把已完成的切片合并进 `main`**，否则台账无法标绿。
3. 先完成 AG9 Runtime，再完成 AG8 Tool 权限与确认。
4. 在安全写入底座上实现 AG4 Task Adaptation。
5. 完成 AG7 Memory，并补齐 AG5 的 adaptive resume。
6. 最后开放 AG6 Reflection 与长期偏好。

依赖关系的一条修正：AG4 **不再依赖完整的 AG7**。AG4 需要的是“确认 + 幂等”这一原始能力，它属于
AG8；原先写“AG4 依赖 AG7 episodic schema”会造成依赖倒置（AG4 排在 AG7 之前）。如果 AG4 确实需要
episodic 查询，就把该查询拆成 **AG7a** 并提前交付，完整的 Memory 检查/删除仍留在后面。

两条硬门槛：AG4 的结构性写入必须等待 AG8 confirmation/idempotency 通过；AG6 必须等待 AG7
preference inspection/delete 完成。

## 维护约定

- **唯一可编辑事实源是仓库的 `docs/wiki/`**，GitHub Wiki 是它的发布副本。任何状态改动走 PR 评审，
  由 `wiki-sync` workflow 发布；不要在 GitHub Wiki 网页上直接编辑（那正是本页此前漂移的原因）。
- 能力状态只允许七级阶梯，**不得越级**；分支成果写清分支名与 commit，并在“已知限制”解释为何未合并。
- 每次功能合并同步更新状态、证据路径、已知限制和验收结果。
- 每个 AG 至少维护正常、边界、失败或越权三类 Eval Scenario。
- `shared-types`、engine 集成和 E2E golden path 由单一 owner 串行收口；纯策略、fixture、UI 原型和评测场景可以 fan-out。
