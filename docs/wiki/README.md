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

| 能力                         | 在 `main` 上的状态 | 证据                                                           | 下一交付重点                                                                                      |
| ---------------------------- | ------------------ | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| AG1 Learning Context         | 已合并             | `63acc28` (#99)                                                | **未合并**：13 类事件投影 allowlist（`AgentContextEvent`）与敏感 payload 回归（`0f19c9f`，无 PR） |
| AG2 Stuck Rescue             | 已合并             | `534bc1c` (#100)                                               | **未合并**：Rescue 计划与评估器（`0f19c9f`）；动作层仍待 AG4/AG8                                  |
| AG3 Contextual Tutor         | **PR 已开**        | PR [#101](https://github.com/nianpingy-cpu/focusloop/pull/101) | 合并前先修领域层英文字符串（i18n 违规），另开 issue 处理                                          |
| AG4 Task Adaptation          | 设计完成           | 方案页 AG4                                                     | AdaptiveTask、提案/确认、持久化与恢复；依赖已改为 AG8                                             |
| AG5 Cognitive Resume         | 已合并             | `packages/continuity`（统一卡）                                | **未合并**：三档与指标（`0f19c9f`，无 PR）；指标口径需改名                                        |
| AG6 Learning Reflection      | 设计完成           | 方案页 AG6                                                     | 行为证据、最小样本、确认后偏好                                                                    |
| AG7 Memory                   | 设计完成           | 方案页 AG7                                                     | 先冻结删除语义，再谈 scope/retention                                                              |
| AG8 Tools & Actions          | 设计完成           | 方案页 AG8                                                     | Tool contract、权限、确认、幂等、审计                                                             |
| AG9 Model Runtime            | 设计完成           | `AIProvider` 抽象                                              | Runtime façade、可序列化请求、结构化输出、abort/stream/retry/budget                               |
| AG10 Evaluation & Guardrails | 分支完成           | `0f19c9f`（无 PR）                                             | 开 PR；评测只在开发者本机或 CI 中运行，不做生产遥测                                               |

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
