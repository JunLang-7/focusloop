# FocusLoop Learning Agent：AG1–AG10 逐功能完善方案

> 目标：把功能分类转成可验收的 Wiki/交付清单。本文按当前仓库已有边界设计：领域决策保持纯函数和可测试；Renderer 只通过已校验 IPC；Agent 不直接写数据库；所有用户可见文案由 i18n 渲染。
>
> **事实基线**：默认分支 `main` @ `e596d6f`。本文是**方案**，不是状态台账；逐项真实状态见
> [功能清单](./project-features.md) 的七级阶梯。
>
> **“领域层不产生句子”是一条被强制执行的硬规则**（见 `docs/architecture.md`）：领域包只返回
> `LocalizedMessage`（如 `{ key: 'reason.confused.hint', params: {} }`），`messages.zh.ts` 以
> `Record<MessageKey, string>` 约束，漏键即 typecheck 失败。**已知违反**：AG3 的
> `describeUnavailable` / `describeRejection` 在领域层返回英文句子，UI 直接渲染
> `{{ result.reason }}`，因此中文界面会出现英文；修复由独立 issue 跟踪，后续每个 AG 在评审时必须
> 检查这一条。

## 0. 统一实施模板

每个 AG 按以下顺序交付：

1. **Contract**：在 `packages/shared-types` 定义闭合集合、请求/响应和错误/降级状态。
2. **Domain**：在对应 package 实现纯策略/构建器；时间、ID、Provider、存储通过参数注入。
3. **Persistence**：新增 append-only migration；事件是事实，派生视图不作为第二事实源。
4. **IPC**：补 `IPC_CHANNELS`、payload parser、main handler、preload API，并覆盖 hostile input。
5. **UI**：Angular 组件 + `core/*-view.ts` 纯展示逻辑 + 中英 i18n；操作状态、错误、空态、键盘焦点齐全。
6. **Evidence**：单测、集成测试、IPC 安全测试、E2E golden path、性能/隐私回归；文档写明已知限制。

### 通用 Definition of Done

- 需求中的每个状态、动作和禁止行为都有可执行断言；没有“模型自行决定是否打断/改计划”的隐式逻辑。
- 正常 Provider、超时、错误、无网络/Mock 均可完成主流程；降级结果对用户可解释。
- 领域包不访问 DOM、Electron、数据库或系统时钟；所有持久化通过 `FocusLoopStore`，所有跨边界输入二次校验。
- 迁移可在空库和已有库执行，旧数据可读；事件、工具调用、用户确认可追溯。
- UI 支持中英文、无障碍名称/键盘操作、加载/错误/空态；不把诊断性标签写入用户画像。
- `pnpm test`、`pnpm typecheck`、关键 E2E 与隐私扫描通过；新增场景进入 AG10 eval 数据集。
- **E2E 是完成度的必要条件，不是可选项**：E2E 未通过时（无论原因是环境、时序还是产品缺陷），该切片最高只能标
  「CI 绿」，**不得标「完成」**。状态含义见 [功能清单 §1.1](./project-features.md)。
  （注：此处原先举的例子是“Electron 44 拒绝 Playwright 的 `--remote-debugging-port=0`”——该说法在
  2026-09-22 的实测中被推翻，见 #107。举例不等于事实，这正是本页要避免的写法。）

### 统一测试矩阵

| 维度                | 最低覆盖                                                 |
| ------------------- | -------------------------------------------------------- |
| P（pure）           | 正常、边界、重复事件、乱序/空值、确定性重放              |
| I（integration）    | engine + store + migration；事件→状态→派生结果           |
| B（bridge）         | 合法请求、未知枚举、超长文本、越权 session、重放/重复 id |
| U（UI/E2E）         | 主流程、空态、失败/降级、键盘/ARIA、中英切换             |
| S（safety/privacy） | 不越权写入、不发无关字段、不诊断、不静默改计划           |
| M（metrics）        | 延迟、token/上下文上限、接受/拒绝/完成率可重算           |

## AG1 Learning Context

**交付范围/基线**：保留现有 `AgentContext`、`buildAgentContext`、材料 1200 字符和最近 12 事件上限；补齐来源报告、隐私过滤和开发者 Inspector。

**数据模型**：`AgentContext`（session/concept/task/material/learningState/recentEvents/checkpoint）及 `AgentContextOmission[]`；不得携带完整课程、全量日志、浏览器 URL 或账号信息。

**API/UI 交付物**：复用 `focusloop:agent:context` / `getAgentContext()`；需要时增加按 `sessionId` 的只读 inspector 请求。完善 `AgentContextPanel` 的 omitted、截断长度、无 session 空态；开发模式显示当前上下文面板（组件 `fl-agent-context-panel`，`data-testid="agent-context-panel"`）。

- **DoD**：同一输入构建结果字节级稳定；无 session 返回 null；材料/事件超限有 omission 记录；敏感字段过滤在 main/domain 生效而非只靠 UI；Tutor、Rescue、Resume 使用同一个 builder。
- **Inspector 一致性只能是“两个视图各自一致”**（原表述自相矛盾，已修正）：
  - **Context Inspector** 显示 Agent **可访问**的数据，且必须与实际传给 builder 的输入一致；
  - **Outbound Request Inspector**（AG9 交付）显示这一次实际发给 Provider 的字符串，且必须与
    `sent.inputCharacters` 这类报告一致。
  - Context 与 Tutor 的 prompt 是两层：Tutor 会在 AG1 上下文之上再裁剪，因此两者**不可能相同**，
    Inspector 与送模内容也就不可能“完全一致”。验收只能要求“两个视图都存在、差异可解释”。

**测试矩阵**：P—截断、空材料、12/13 事件、checkpoint；I—课程/任务/材料/事件组装及重启后读取；B—不能由 renderer 注入 context；U—Inspector 展开、中文、键盘、空态；S—全量日志/URL/用户画像不出现在报告；M—context 字符和构建耗时上限。

## AG2 Stuck Rescue

**交付范围/基线**：复用 `StuckReason` 六类、`intervention-policy` 的确定性规则、`HELP_REQUESTED` 事件、`Intervention/Outcome`；补齐选择→干预→结果闭环。

**数据模型**：`StuckReason`；`InterventionDecision`（action/reason/estimatedMinutes/answersRequestId）；`InterventionOutcome`；必要时记录 `rescueAttempt` 的 requestId，不保存诊断或疲劳人格。

**API/UI 交付物**：复用 `dispatchEvent({type:'HELP_REQUESTED', payload:{reason}})`、`resolveIntervention`；补 `StuckPicker` 六项、MICRO_START/SIMPLIFY/HINT/EXAMPLE/BREAK 卡片及 Accept/Not now/Continue 动作；所有主动打断仍由 deterministic policy 决定。

**DoD**：每类 reason 映射唯一默认 action；无 reason 不强猜；连续帮助/过载只触发一次 BREAK 且有 cooldown；模型只生成内容，不决定是否主动弹出；用户确认后才执行动作；接受、拒绝、完成、quiz 结果均可追踪，干预后状态可重放。

**测试矩阵**：P—六类映射、无 reason、cooldown、优先级和重复 request；I—事件→state→decision→outcome→dashboard；B—未知 reason/action、伪造 interventionId、跨 session resolve；U—六选一、按钮焦点、短文案、失败/离线卡片；S—不诊断、不自动改 SessionPlan；M—帮助到接受/完成的延迟与成功率。

## AG3 Contextual Tutor

**交付范围/基线**：复用 `TutorMode` 六模式、`askTutor`、有界 prompt、主进程 transcript、结构化 `TutorPart`；收口 follow-up 生命周期、材料来源证据和拒答/降级一致性。

**数据模型**：`TutorAskRequest(sessionId, mode, question)`；`TutorTurn` 只在主进程短期保存；`TutorReply(parts, source/excerpt, omissions)`；禁止持久化未经同意的完整对话。

**API/UI 交付物**：复用 `focusloop:tutor:ask`；入口文案为 Ask about this step；模式按钮 EXPLAIN/HINT/EXAMPLE/SOCRATIC/CHECK_MY_ANSWER/SUMMARIZE；结果显示 source section、截断/省略说明、重试/离线 fallback；follow-up 必须仍绑定同一 session/task。

**DoD**：问题只能围绕当前 step；每模式只允许契约规定的 part；CHECK_MY_ANSWER 必须确认学习者原话并指出缺失条件（不能仅 Yes/No）；材料证据来自当前 excerpt；越权 session、过长/空问题被拒；Provider 失败不破坏学习流程且不伪造答案。

**测试矩阵**：P—六模式 schema、非法 part、未引用原话、材料外 section、prompt 总长；I—连续 follow-up 的上下文、session 结束后拒绝、provider retry/fallback；B—注入 label/fence、超长问题、伪造 transcript；U—模式切换、流式/失败/来源显示、键盘/ARIA；S—仅发送必要 context，不落库敏感 transcript；M—prompt 字符/token、首 token/完整响应延迟。

## AG4 Task Adaptation

**交付范围**：新增 Adaptive Task 与“提案优先、确认后变更”流程；覆盖 SHRINK_TASK、SPLIT_TASK、CHANGE_MODALITY、计划重排、生成练习。

**数据模型**：`AdaptiveTask {id, parentTaskId, sessionId, title, instructions, kind, estimatedMinutes, rationale, source, status}`；`AdaptationProposal {operations, expiresAt, requiresConfirmation}`；`SessionPlanRevision {before, after, confirmedBy, at}`。所有变更以 domain command + event 落库。

**API/UI 交付物**：建议新增 `proposeAdaptation/getAdaptation/confirmAdaptation/rejectAdaptation` IPC；命令包含 `createAdaptiveTask`、`splitTask`、`changeModality`、`reorderPlan`。UI 显示前后对比、预计时长、原因和 Accept/Keep current；不确认不写结构性变更。

**DoD**：每个子任务 1–5 分钟且保留 parent 关系；建议可过期/撤销/幂等；计划重排和 skip/create 必须确认；生成任务引用当前 concept/material，不引入无关内容；接受后事件、progress、resume、dashboard 一致，拒绝不改变计划。

**测试矩阵**：P—拆分数量/时长、幂等、提案过期、模态合法性；I—确认前后 session plan/progress/checkpoint；B—伪造 proposal、跨 session、未确认 structural command；U—diff/确认/撤销/错误恢复；S—不可静默改计划、不可越过权限；M—生成延迟、任务完成率、改后继续率。

## AG5 Cognitive Resume

**交付范围/基线**：复用 `LearningCheckpoint`、`buildCheckpoint`、`ResumeCard`、accept/dismiss 和 latency 记录；补短/中/长三档摘要、adaptive task 恢复和成功率指标。

**数据模型**：保留 checkpoint 的 mastered/unresolved/currentTask/currentStep/frictionState/nextBestAction；扩展 `ResumeVariant = short|medium|long`、`gapMs`、`refresher: LocalizedMessage | null`（由 gap 派生，不重复存事实）；`ResumeCardTiming` 记录 shown/accepted/dismissed/latency。

**API/UI 交付物**：复用 `getResumeCard/acceptResume/dismissResume`；按离开时长返回 short/medium/long；Long 增加 30 秒快速回忆；恢复 adaptive task、回到 material section；ResumeCard 显示“已完成/未解决/下一步”，接受后发 `RESUME_REQUESTED`。

**DoD**：同一 interruption 幂等生成一个 checkpoint；短暂离开不重复讲解，长间隔先 recap；恢复到 checkpoint 的 task/step 而非“下一个未完成任务”；接受/拒绝可重放且不丢失位置；latency、resume success 有明确口径。

**测试矩阵**：P—1/15/24h 分档、无事件/重复事件、checkpoint idempotency；I—离开→checkpoint→重启→resume→task state；B—未知/他人 checkpoint、重复 accept、篡改 taskId；U—短中长卡片、快速回忆、键盘、空态；S—不显示未授权历史/材料；M—卡片生成/显示延迟、接受率、恢复后 5 分钟内继续率。

## AG6 Learning Reflection

**交付范围**：跨 Session 仅基于学习行为生成周复盘，推导任务大小/解释形式/干预/Resume 偏好；所有长期偏好显式确认后保存。

**数据模型**：`LearnerPreference {id, key, value, source:'explicit'|'observed', confidence, confirmedAt, updatedAt, deletedAt?}`；`ReflectionPeriod {from,to,metrics,evidence[]}`；禁止 ADHD severity、智力、人格、心理健康推断。

**API/UI 交付物**：新增 `getReflection(period)`、`proposePreference()`、`confirmPreference()`、`deletePreference()` IPC；设置页/复盘卡显示证据样本、适用范围、Confirm/Keep/Forget；偏好读取只影响任务生成/解释选择，不改变学习事实。

**DoD**：统计可由事件重算；每项建议列出样本量与时间窗；观察到的偏好不能自动转长期存储；确认、编辑、删除立即生效且可审计；无足够样本明确显示 insufficient data；文案只描述行为，不贴标签。

**测试矩阵**：P—窗口边界、样本不足、偏好冲突、删除/重建；I—历史事件→指标→建议→确认→后续任务；B—越权 period、注入偏好 key/value、重复确认；U—证据、确认、编辑、删除、无数据；S—禁止诊断字段/敏感推断，导出最小化；M—统计查询耗时、建议接受率、确认后行为变化。

## AG7 Agent Memory

**交付范围**：正式化三级 Memory：Working（session）、Episodic（多 session 事件/结果）、Learner Preference（显式可编辑）。Working/Episodic 为事实或派生查询，Preference 走 AG6 确认。

**数据模型**：`WorkingMemoryView` 从当前 session/context 派生，不新建持久化副本；复用 events/checkpoints/outcomes/resume_cards 作为 episodic source；`learner_preferences`（AG6 schema）。不额外复制完整日志或材料。

**API/UI 交付物**：`getMemorySummary(sessionId)`、`listMemory(scope)`、`deletePreference(id)`、`clearAgentMemory(scope)`；隐私设置页显示 scope、来源、时间、删除影响；清除前确认，清除后不可被 context/tutor 查询。

**DoD**：scope、TTL、权限明确；working 自动过期，episodic 可按 session/time window 查询；删除单项和清空全部可验证且不删课程/学习事实（除非用户明确要求）；所有 memory 访问有审计；AgentContext 只读取最小窗口。

- **删除语义必须在写代码前冻结**（原文只有“清除后不可被查询”这一句愿望）：清除是物理删除、软删除还是
  tombstone？Dashboard 是否仍能使用？审计日志是否保留被删对象标识、保留多久？缓存、checkpoint 与派生
  结果如何失效？四个问题都有答案之前，“数据还在但 Agent 看不到”不成立。

**测试矩阵**：P—scope 隔离、TTL、分页、删除幂等；I—session 重启/多 session 查询/清除后 context；B—跨用户/跨 session、未知 scope、批量删除保护；U—检查、单项删除、全部清除确认/空态；S—敏感字段 schema denylist、日志脱敏、数据库残留扫描；M—查询上限、清除耗时。

## AG8 Tool & Action System

**交付范围/基线**：建立 LLM → Structured Tool Call → Validation → Domain Command → Learning Event；LLM 永不直写 SQLite。工具分 Safe Read、Reversible Write、Structural Write。

**数据模型**：`AgentTool {name, version, inputSchema, permission, idempotencyKey}`；`ToolCall {id, sessionId, tool, args, status, confirmation, error, at}`；`ToolAudit` 记录调用者、校验结果、领域事件关联。

**API/UI 交付物**：注册 `readCurrentTask/readConcept/readMaterial/readCheckpoint`、`start/pause/resume/completeTask`、`extendTimer/createAdaptiveTask/reorderSessionPlan/saveCheckpoint/startBreak/openMaterialSection`；Structural Write 统一 `propose→confirm→execute`；UI 显示待确认参数、影响、撤销入口和失败原因。

**DoD**：输入 schema/权限/当前 session 校验在 main；读工具无副作用；可逆写有 undo/幂等；结构写未确认不得执行；命令成功必有事件，失败不产生半写；工具审计可查询，模型不能传 SQL/任意 channel。

**测试矩阵**：P—schema、权限、幂等、重试/回滚；I—tool→command→event→state/store；B—未知 tool、原型污染/SQL 注入、跨 session、重复 call、伪造确认；U—确认弹窗/撤销/失败；S—renderer 无数据库权限、结构写强制确认、审计脱敏；M—工具执行/回滚延迟。

## AG9 Model Runtime

**交付范围/基线**：统一 `AgentRuntime → ProviderRegistry`，Provider 对 Skill 隐藏；支持 Mock、远端 Provider、本地模型；结构化输出、streaming、abort、timeout/retry、fallback、token/context budget。

- **数据模型**：拆成两个类型（原设计把 `AbortSignal` 放进数据模型，它不能跨 IPC 序列化，也不适合进入 shared contract 或持久化层）：
  - `RuntimeRequestData { skill, schema, contextBudget, tokenBudget, deadlineMs }`：可序列化。
  - `RuntimeExecutionOptions { signal }`：仅进程内存在，不进 `shared-types` 的持久化路径。
  - **流式文本**与**最终结构化结果**分别定义：前者面向增量显示（可中断、可丢弃尾部），后者面向
    schema 校验（完整结果才校验，失败才重试/降级）；笼统要求“同时支持”会变成不可测试的承诺。
- `RuntimeResult {status, output, provider, usage, latency, degraded, failure}`；`ProviderHealth` 只存运行指标，不存 prompt 原文。

**API/UI 交付物**：扩展 `AIProvider.complete()` 或新增 runtime façade；统一错误枚举/重试预算/取消；Runtime Info 显示 provider/model/offline/degraded；Rule Engine 提供 MICRO_START/SIMPLIFY/HINT/BREAK 等 deterministic fallback。

**DoD**：Skill 只依赖 runtime 接口；结构化输出校验失败可重试一次后降级；超时/取消释放资源；主 Provider 失败自动 fallback 且用户可见；离线仍可完成关键干预；所有 prompt/context/token 有上限和 usage 记录。

**测试矩阵**：P—路由、schema、token 计算、retry budget、abort；I—成功/超时/401/限流/坏 JSON→fallback；B—恶意 Provider 输出、超大 prompt、错误 provider 配置；U—流式增量、取消、降级提示、无网络；S—Provider 不接收未授权字段、日志不记原文；M—首 token/总延迟、token 上限、fallback 成功率。

## AG10 Evaluation & Guardrails

**交付范围**：建立固定 Scenario Dataset 与可重放 Eval Suite，覆盖 relevance、grounding、action correctness、intervention appropriateness、concision、continuity、privacy；把回归场景绑定 CI。

**数据模型**：`EvalScenario {id, context, input, expected, forbidden, rubric, version}`；`EvalRun {scenarioId, provider, output, toolCalls, scores, violations, latency, at}`；`GuardrailPolicy` 定义 schema、权限、隐私和打断规则。

- **API/UI 交付物**：开发/CI CLI `agent-eval run --suite ...`、本地或 CI 内的报告 JSON/HTML；Inspector 显示命中规则/违规原因。
- **隐私边界**：评测结果只在开发者本机或 CI 中生成，不由生产应用上报；无遥测、无分析、无崩溃上报，与 `docs/privacy.md` 一致。场景只使用合成数据，不包含真实用户学习内容。

**DoD**：至少覆盖 confused、overloaded、cannot-start、follow-up、resume、provider failure、越权 tool、敏感字段八类；每 scenario 有 Expected 与 Forbidden；结构化输出/工具权限/不主动打断由 deterministic tests gate；grounding 要能指出 excerpt/source；隐私回归扫描通过；阈值失败阻断合并。

**测试矩阵**：P—policy、schema、枚举、不可打断规则；I—scenario→engine→provider/mock→tool/store；B—prompt injection、越权写、材料冲突、隐私字段；U—golden path、长回复/空回复/降级；S—发送字段 allowlist、日志脱敏、删除后不可回流；M—建议初始门槛：结构化/权限/隐私 100%，grounding ≥95%，相关性 ≥90%，P95 runtime 延迟与 token 上限纳入报告。

## 依赖与发布节奏

1. **现有 MVP 收口**：AG1、AG2、AG3、基础 AG5，并同步建立 AG10 最小回归集。
2. **安全动作底座**：AG9 Runtime → AG8 Read/Reversible Write → AG8 Structural Write；结构写入的 confirmation 与 idempotency 通过后才进入下一阶段。
3. **自适应闭环**：AG4 Shrink/Split/Modality → 计划重排与 adaptive practice → AG5 adaptive resume。
4. **长期能力**：AG7 三级 Memory → AG6 Reflection/Preference；未经确认的观察结果不得进入长期记忆。

每个 AG 完成后必须新增至少 3 个 eval scenario（正常、边界、失败/越权），并在 Wiki 记录：版本、迁移号、IPC 变更、DoD 证据、已知限制和回滚方案。
