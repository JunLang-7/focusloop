# Agent 实施进度

## 2026-09-21：Phase 0 / Slice 1

状态：完成。

### 本切片范围

- AG10：建立最小 deterministic scenario harness。
- AG1：将最近事件从完整持久化事件改为字段级运行时 allowlist 投影。
- AG1：将持久化 checkpoint 改为有界认知摘要，隔离数据库标识符。
- 明确排除：AG4、AG6、真实模型评测、Tool/Runtime 扩建。

### 已交付

- 新增独立 `@focusloop/agent-evals` 包：版本化场景、受限路径解析、确定性 runner、结果与隐私断言。
- 新增 6 个 AG1 固定 JSON 场景：正常上下文、无 Session、材料/事件边界、跨课程隔离、恶意 payload、URL/密钥/表单等敏感哨兵。
- 新增 `AgentContextEvent` 闭集合同：13 类事件逐类型投影。
- Agent Context 不再携带事件 id、session id、`TAB_LEFT.origin` 或未知 payload 字段。
- Agent Context checkpoint 不再携带 checkpoint/session/concept/task 持久化 id；文本、列表和消息参数均有显式上限。
- 非法事件、错误类型、负数/非有限时长、超长事件标识被拒绝并记录 omission。
- Inspector 与 Tutor 增加上下文边界说明；隐私文档区分本地持久化、AG1 报告和 Tutor 送模内容。

### 验收证据

- AG1 固定场景：全部通过，重复运行结果一致。
- `@focusloop/agent-evals`：9 项测试通过；typecheck、lint 通过。
- `@focusloop/agent-core`：227 项测试通过；typecheck、lint 通过。
- `@focusloop/shared-types`：13 项测试通过；typecheck、lint 通过。
- Desktop typecheck 通过。
- 仓库级 test、typecheck、lint、build、文档校验和格式校验通过。

### 下一切片

按实施路线进入 Phase 1：AG5 Resume 三档策略与 resume success metric；同时扩充 AG10 的 AG5 deterministic scenarios。暂不引入新 LLM 能力。

## 2026-09-21：Phase 1 / Slice 2

状态：完成。

### 本切片范围

- AG5：Short/Medium/Long 三档 Resume 策略与 30 秒长期离开回忆步骤。
- AG5：接受恢复后 5 分钟 success evaluator 与 Dashboard 汇总。
- AG10：直接驱动生产 continuity 纯函数的 AG5 deterministic scenarios。
- 明确排除：Tutor/Rescue 卡点摘要、adaptive task、材料章节跳转、长期记忆、新 LLM 能力。

### 已交付

- `ResumePolicyConfig` 集中管理 15 分钟、24 小时和 5 分钟成功窗口；边界等于阈值时进入更高档。
- `ResumeCard` 返回 `variant/gapMs/refresher`；缺失或非法 gap 保守使用 Medium。
- Short UI 不展开历史列表；Long UI 展示专用 30 秒快速回忆提示。
- success 从 timing、checkpoint、events 和当前时间纯派生；pending 不进入成功率分母，dismissed/未选择不进入样本。
- Store 提供按 Session 稳定排序的 Resume timing 读取；无需数据库迁移，重启后可重算。
- Dashboard 展示成功率、已评估样本和 pending 数量。
- AG10 增加 9 个 AG5 固定场景，覆盖 1/10/15 分钟、24 小时、缺失 gap、成功、过期、pending 和重复事件。

### 验收证据

- 仓库级 737 项测试通过。
- `@focusloop/continuity`：41 项测试通过；`@focusloop/agent-core`：230 项测试通过；`@focusloop/persistence`：48 项测试通过。
- `@focusloop/agent-evals`：12 项测试通过，其中 AG5 场景重复运行结果一致。
- 全仓库 typecheck、lint、build、文档、Prettier 和 diff whitespace 校验通过。
- Desktop E2E 在启动应用前被当前 Electron/Playwright 组合阻断：Electron 拒绝 Playwright 注入的 `--remote-debugging-port=0`；没有执行到产品断言，单独作为测试基础设施问题处理。

### 下一切片

按路线收口 AG2 Stuck Rescue：把干预文案接成可执行微步骤，统一 outcome 口径，并继续补 AG10 正常/边界/越权场景。AG5 的 Tutor/Rescue 卡点证据与 adaptive restore 留到其依赖能力形成后完成。
