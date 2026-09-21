# FocusLoop Learning Agent Wiki

本 Wiki 将 AG1–AG10 的产品分类映射到当前仓库事实、可执行的完善方案和交付顺序。判断“完成”时以端到端闭环和可验证证据为准，不以存在同名类型、按钮或文案为准。

## 从这里开始

- [AG1–AG10 逐功能完善方案](./agent-feature-completion-plan.md)：每项能力的范围、数据模型、API/UI、Definition of Done 和测试矩阵。
- [能力现状与实施调度](./delivery-roadmap.md)：当前完成度、主要缺口、依赖、风险、分阶段顺序和 fan-out 边界。
- [实施进度](./implementation-progress.md)：已完成切片、验收证据和下一切片。
- [Resume 三档与成功指标](./resume-policy-and-success.md)：AG5 Phase 1 的阈值、事件口径、派生指标和边界。
- [现有系统架构](../architecture.md)：包边界、状态机、持久化与安全边界。
- [测试策略](../testing.md)：当前测试层级和运行方式。
- [隐私边界](../privacy.md)：local-first、最小数据和浏览器扩展权限。

## 当前判断

| 能力                         | 当前状态       | 下一交付重点                                            |
| ---------------------------- | -------------- | ------------------------------------------------------- |
| AG1 Learning Context         | 已形成，待收口 | 字段级隐私 allowlist、恶意 payload 回归、Inspector 对齐 |
| AG2 Stuck Rescue             | 部分形成       | 把干预文案接成可执行微步骤，统一 outcome 口径           |
| AG3 Contextual Tutor         | 已形成，待收口 | 双语质量集、细粒度来源、Runtime 流式/取消               |
| AG4 Task Adaptation          | 未形成         | AdaptiveTask、提案/确认、持久化与恢复                   |
| AG5 Cognitive Resume         | 部分形成       | 三档与 success 已完成；继续补卡点证据、adaptive restore |
| AG6 Learning Reflection      | 未形成         | 行为证据、最小样本、确认后偏好                          |
| AG7 Memory                   | 部分形成       | scope/retention、偏好存储、检查与删除                   |
| AG8 Tools & Actions          | 未形成         | Tool contract、权限、确认、幂等、审计                   |
| AG9 Model Runtime            | 部分形成       | Runtime façade、结构化输出、abort/stream/retry/budget   |
| AG10 Evaluation & Guardrails | 部分形成       | 场景数据集、runner、质量与安全发布门槛                  |

## 交付顺序

1. 契约、ADR 和最小 Eval Harness。
2. 收口 AG1、AG2、AG3 与基础 AG5。
3. 先完成 AG9 Runtime，再完成 AG8 Tool 权限与确认。
4. 在安全写入底座上实现 AG4 Task Adaptation。
5. 完成 AG7 Memory，并补齐 AG5 的 adaptive resume。
6. 最后开放 AG6 Reflection 与长期偏好。

两条硬门槛：AG4 的结构性写入必须等待 AG8 confirmation/idempotency 通过；AG6 必须等待 AG7 preference inspection/delete 完成。

## 维护约定

- 能力状态只允许“未形成 / 部分形成 / 已形成，待收口 / 已形成”。
- 每次功能合并同步更新状态、证据路径、已知限制和验收结果。
- 每个 AG 至少维护正常、边界、失败或越权三类 Eval Scenario。
- `shared-types`、engine 集成和 E2E golden path 由单一 owner 串行收口；纯策略、fixture、UI 原型和评测场景可以 fan-out。
