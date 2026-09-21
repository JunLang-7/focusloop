# FocusLoop Agent 能力完善与实施调度

> 状态：实施基线；基于 2026-09-21 仓库静态审查。本文不把“已有同名 UI/类型”自动视为能力完成，而按端到端闭环判定。

## 1. Wiki 信息架构

建议将 `docs/wiki/` 作为“当前产品与工程事实”，现有 `docs/architecture.md`、`docs/testing.md` 等继续作为稳定基线文档。Wiki 首页按以下结构导航：

```text
Home
├─ 00 Product
│  ├─ Product Positioning（不是聊天机器人；学习连续性 Agent）
│  ├─ Core Loop（Context → Trigger → Policy → Skill → Tool → Memory → Eval）
│  ├─ UX Principles（低打扰、行为语言、确认后写入、local-first）
│  └─ Demo Journeys（卡住恢复、当前步骤辅导、中断续接）
├─ 10 Domain
│  ├─ Learning State & Events
│  ├─ Course / Concept / Micro Task / Material
│  ├─ Checkpoint & Resume
│  └─ Intervention & Outcome
├─ 20 Agent Capabilities
│  ├─ AG1 Learning Context
│  ├─ AG2 Stuck Rescue
│  ├─ AG3 Contextual Tutor
│  ├─ AG4 Task Adaptation
│  ├─ AG5 Cognitive Resume
│  └─ AG6 Learning Reflection
├─ 30 Agent Infrastructure
│  ├─ AG7 Memory
│  ├─ AG8 Tools & Actions
│  ├─ AG9 Model Runtime
│  └─ AG10 Evaluation & Guardrails
├─ 40 Architecture & Contracts
│  ├─ Package Boundaries
│  ├─ Context / Prompt Data Flow
│  ├─ Tool Permission Model
│  ├─ Persistence & Migrations
│  └─ IPC / Extension Trust Boundaries
├─ 50 Delivery
│  ├─ Capability Matrix（本文第 2 节）
│  ├─ Roadmap & Dependency Graph
│  ├─ ADR Index
│  ├─ Release Readiness
│  └─ Known Risks / Debt
└─ 60 Quality & Operations
   ├─ Test Strategy
   ├─ Agent Eval Scenarios
   ├─ Privacy & Data Inventory
   ├─ Observability / Audit
   └─ Runbooks（provider failure、migration、release）
```

每个 AG 页面统一使用六段模板：目标与非目标、用户旅程、契约/数据、当前证据、验收场景、开放问题。这样 Wiki 是可验收的事实库，不是另一份愿景文档。

## 2. AG1–AG10 能力矩阵

状态含义：**已形成** = 主链路存在且有测试；**部分形成** = 有核心部件但未闭环；**未形成** = 仅有邻近能力或设计意图。

### AG1 Learning Context — 已形成，需收口

- 当前证据：`shared-types/agent-context.ts` 定义边界和 omission；`agent-core/agent-context.ts` 构建当前 session/concept/task/material/state/events/checkpoint；材料 1200 字符、事件 12 条；Electron IPC 暴露只读报告；桌面有 “What the Agent sees” 面板；有单元、engine、IPC 测试。
- 差距：隐私规则尚未形成独立、可审计的字段级 allowlist 文档；Agent Context 与 Tutor 实际 prompt 是两层报告，调试体验需说明差异；缺少面向恶意/敏感事件 payload 的固定回归语料。
- 验收标准：任意 session 只包含当前课程路径所需数据；材料、事件、总 prompt 均在声明上限内；所有裁剪都有 omission；不得出现其他课程内容、完整日志、密钥、URL path/query、表单内容；Inspector 与实际送模输入有可追溯对应；无 session 返回显式空上下文。
- 依赖：现有 domain types、store、material parser、IPC。
- 风险：事件 payload 将来扩展后绕过过滤；字符预算与真实 token 预算偏差；Inspector 让开发者误以为它等于完整 Tutor prompt。
- 实施步骤：写 Context Data Contract → 建字段 allowlist/denylist → 加敏感 payload fixtures → 统一 context/prompt inspection 导航 → 加预算与跨课程隔离回归测试。

### AG2 Stuck Rescue — 部分形成（分类/政策闭环已成，动作仍偏文案）

- 当前证据：六类 `StuckReason`；UI picker；reason→action 确定性映射；`MICRO_START/SIMPLIFY/HINT/EXAMPLE/BREAK` 等 intervention；cooldown、预算、升级规则与 outcome 记录均有测试。
- 差距：多数“skill”仍是 intervention descriptor/文案，未生成可执行临时步骤或真正缩小任务；救援成功的定义未形成统一窗口指标；“换一种解释/例子”与 AG3 Tutor 的复用边界需固定。
- 验收标准：六类原因逐一触发预期 action；主动打断只能由 deterministic policy 决定；所有展示均可接受/拒绝并记录；接受后能进入具体下一步；在规定窗口内以“开始/完成下一微步、无重复求助”计算 outcome；离线仍可完成每类基础救援。
- 依赖：AG1；AG8 的动作合同（对可执行救援）；AG10 scenario harness。
- 风险：同一求助重复消费；干预过频；把“疲劳”固化为长期画像；SIMPLIFY 名义完成但任务不变。
- 实施步骤：定义 RescueResult 与成功窗口 → 固定 AG2/AG3 路由 → 将 MICRO_START/SIMPLIFY 接到临时任务工具 → 完成 outcome evaluator → 做六类 E2E。

### AG3 Contextual Tutor — 已形成，需产品化收口

- 当前证据：六种 TutorMode 全部建模；当前步骤入口；主进程保存有界 transcript；结构化 parts 校验；格式失败可重试；回答与用户原话引用校验；材料 section grounding 与 source 展示；provider 失败有本地 fallback；大量边界测试。
- 差距：真实 provider 下的质量基线与双语场景数据不足；当前“source”是所给 excerpt，不是细粒度引用定位；流式/取消属于 AG9 未完成；会话 transcript 未持久化且缺少用户可清除入口（需明确这是隐私选择还是缺口）。
- 验收标准：六模式只产生允许的 parts；问题自动绑定当前 task；切换 task/session 不串答；follow-up 不越过上下文预算；无材料依据时不伪造来源；错误格式、provider failure、offline 均有可理解降级；中英文核心场景通过固定 eval。
- 依赖：AG1、AG9；AG10 grounding/quality eval。
- 风险：结构正确但教学质量差；引用标题匹配不等于事实支持；多轮对话造成 prompt injection/成本增长。
- 实施步骤：冻结 Tutor contract → 建中英场景集 → 增加精确 section anchor → 接 runtime abort/stream → 明确 transcript 生命周期与清除策略 → E2E 覆盖六模式中的关键三模式。

### AG4 Task Adaptation — 未形成（只有静态任务生成与 SIMPLIFY 建议）

- 当前证据：课程导入时有 micro-task generator；policy 能选择 `SIMPLIFY`；既有 session plan UI/任务生命周期可作为接入点。
- 差距：没有 `AdaptiveTask` schema、SHRINK/SPLIT/CHANGE_MODALITY 服务、plan reorder proposal、adaptive practice persistence、确认式结构写入；现有 SIMPLIFY 不等于真实任务变更。
- 验收标准：生成的 adaptive task 绑定来源 task/concept/reason，单步 1–5 分钟且可恢复；结构性变更必须先展示 diff 并由用户确认；拒绝不改变 plan；接受后持久化并发出事件；重复提交幂等；离线至少能模板化 shrink/split。
- 依赖：先完成 AG8 工具/权限；AG7 episodic schema；AG10 safety tests。
- 风险：破坏 progress 语义和 task position；生成重复/循环任务；模型越权静默改计划；迁移后旧 session 不兼容。
- 实施步骤：ADR 定义 temporary step vs persistent adaptive task → schema/migration → 纯函数 proposal builder → confirmation UI → command/event/persistence → restore/resume → eval/E2E。

### AG5 Cognitive Resume — 部分形成（三档恢复与成功指标已形成）

- 当前证据：checkpoint builder、idempotent persistence、interruption detection、接受/拒绝、latency 均已存在；ResumeCard 已按 15 分钟/24 小时边界形成 Short/Medium/Long 三档，Long 提供 30 秒快速回忆；Dashboard 从 timing/checkpoint/events 重算 5 分钟 resume success，AG10 使用生产 continuity 纯函数覆盖固定场景。
- 差距：checkpoint 内容主要由任务进度推导，尚未捕获 Tutor/救援产生的“具体卡点”；adaptive task 状态无法恢复；恢复后尚不能直接定位 material section；真实用户阈值仍需产品数据校准。
- 验收标准：按离开时长确定三档且边界可配置、确定性可测；卡点来自最新有效学习证据；同一 interruption 只生成一 checkpoint/card；adaptive 子步骤可恢复；记录 latency，并在恢复后的窗口内记录 success/failure；跨日返回提供 30 秒 refresher 而非直接开长任务。
- 依赖：AG2 outcome、AG4 adaptive state、AG7 episodic query、AG10 resume eval。
- 风险：过时 checkpoint；时区/系统时钟异常；resume card 太长反而增加重启成本；长期卡点包含不必要敏感文本。
- 实施步骤：已完成 gap bands → 三档纯策略 → refresher → success evaluator；后续为 checkpoint 纳入有界 Tutor/Rescue evidence → material 定位 → adaptive restore → 完整三档 E2E。

### AG6 Learning Reflection — 未形成

- 当前证据：已有 dashboard/insights、events、outcomes，可作为统计输入；没有学习偏好模型或 reflection 产品链路。
- 差距：AG6.1–AG6.7 基本均未实现；现有 UI settings 只含语言/主题/材料显示，不是 learner preference。
- 验收标准：只从最小样本量以上的行为事实形成建议；展示证据窗口和不确定性；永不输出诊断/能力标签；偏好只有用户确认后才存；可编辑、撤销、删除；建议应用后能测量效果且不自动无限强化。
- 依赖：AG7 preference store、AG8 confirmed preference tool、AG10 fairness/privacy scenarios。
- 风险：小样本伪规律；把情境行为当人格；确认疲劳；反馈循环；跨课程偏好错误泛化。
- 实施步骤：先写伦理/语言规范 → 定义统计特征和最小样本 → reflection proposal（只读）→ confirmation → preference store/UI → 效果对照 → weekly summary。

### AG7 Memory — 部分形成（情节数据已有，统一 Memory 能力未形成）

- 当前证据：当前 session/context 是 working-memory 等价物；events/checkpoints/interventions/outcomes 是 episodic 数据；SQLite local-first 且有迁移与 round-trip 测试。
- 差距：没有明确 Memory scopes API；没有按目的/保留期查询与删除；没有 learner-preference schema/store/inspection；Tutor transcript 是进程内临时状态且生命周期未在产品层说明。
- 验收标准：Working/Episodic/Preference 三类边界清晰；每类有 purpose、来源、保留期、读取者；偏好显式、可编辑、可单项删/全清；清除后上下文与反思不再引用；禁止存储诊断、智力、人格、心理健康推断；所有 query 有数量/时间窗上限。
- 依赖：privacy ADR、persistence migrations；AG6/AG4 消费其能力。
- 风险：删除不彻底（派生表/缓存）；scope creep；长期日志增长；同步功能未来破坏 local-first 假设。
- 实施步骤：Data Inventory → MemoryPolicy/Query contract → episodic bounded queries → preference migration/repository → inspection & delete UI → cache invalidation tests → privacy regression。

### AG8 Tool & Action — 未形成（已有 domain commands，但不是 Agent Tool 系统）

- 当前证据：engine、IPC 已有 start/pause/resume/complete、事件分发等应用命令；输入验证和事件日志可复用。
- 差距：没有统一 `AgentTool` contract/registry；没有 safe-read/reversible-write/structural-write 权限；没有 model tool-call 解析/验证；没有通用 proposal-confirm-execute；没有专用 tool audit record。
- 验收标准：LLM 永不直接访问 store；每个 tool 有 typed input/output、权限、idempotency、precondition；safe reads 可自动执行，reversible writes 明示反馈，structural writes 必须逐次确认；确认绑定精确 proposal hash/版本且过期失效；执行产生 domain event 和 audit；未知/畸形/越权 tool call 被拒绝。
- 依赖：AG9 structured output；现有 engine/IPC；AG10 tool safety harness。
- 风险：prompt injection 越权；确认后状态已变化（TOCTOU）；重试导致重复写；把 IPC 方法直接暴露为模型工具造成攻击面过大。
- 实施步骤：Tool ADR/权限矩阵 → read-only registry → proposal envelope → confirmation UI → reversible commands → structural commands → audit log → adversarial tests。

### AG9 Model Runtime — 部分形成

- 当前证据：`AIProvider` 抽象、Mock/DeepSeek、provider selection 和 deterministic fallback；DeepSeek 有超时/错误归类；Tutor 层有结构化 reader、格式重试和字符预算。
- 差距：尚无独立 AgentRuntime；structured output 能力不在 provider contract；无 streaming/abort；无通用 retry/backoff；fallback 是 primary→mock 而非可配置 provider chain；只有 Mock/DeepSeek；预算是字符而非 token/成本；skills 仍知道 completion 细节。
- 验收标准：统一 runtime 请求支持 schema、timeout、abort、stream events、retry policy、provider chain、预算；一次请求可追踪 provider/model/耗时/重试/降级但不记录敏感 prompt；超时或断网在 UX 时限内转 rule fallback；abort 后不得提交迟到结果；结构化结果在边界验证。
- 依赖：shared provider contracts；AG10 runtime conformance tests。
- 风险：多 provider 行为不一致；streaming 与 schema 校验冲突；重试放大成本；本地模型能力不足导致隐藏降级。
- 实施步骤：ADR 分离 Provider 与 AgentRuntime → runtime contract → abort/timeout → structured adapter → retry/backoff → provider chain → token estimator/budget → optional adapters → conformance suite。

### AG10 Evaluation & Guardrails — 部分形成（工程测试强，Agent Eval Suite 未形成）

- 当前证据：当前基线共有 703 个通过的 Vitest 测试；state/policy/continuity/persistence/engine/IPC 测试较完善，并有 Electron + Playwright golden path；Tutor 有格式、模式、引用、grounding、预算 guardrail；隐私边界已有文档和若干测试。
- 差距：没有版本化 scenario dataset、统一 evaluator、expected/allowed/forbidden 断言、真实模型抽样评测、质量趋势报告；没有系统的 tool safety、跨语言、干扰度、resume quality 与 privacy regression 套件。
- 验收标准：每个 AG 至少有 happy/edge/adversarial 场景；deterministic gates 100% 稳定；LLM eval 固定模型/参数并报告通过率与方差；发布门槛含 grounding、tool correctness、privacy zero-tolerance、concision、continuity；场景不得含真实用户数据；失败能定位到 capability/runtime/provider。
- 依赖：应横切全阶段，不能等功能全部完成。
- 风险：用字符串匹配冒充质量；eval 数据泄漏进 prompt；在线模型漂移导致 CI 抖动；只测英文。
- 实施步骤：定义 JSON scenario schema/runner → 迁移现有 fixtures → 先建 AG1/2/3/5 deterministic suite → tool safety suite → 中英 model eval（非阻塞起步）→ 基线报告 → 逐步设 release gate。

## 3. 分阶段调度、依赖和 fan-out 边界

### Phase 0：冻结事实与契约（先做，1 个短迭代）

1. 建 Capability Matrix、Data Inventory、术语表。
2. 写 4 个 ADR：Memory scopes、AdaptiveTask 身份/生命周期、Tool permission/confirmation、AgentRuntime。
3. 建 AG10 scenario schema 与最小 runner，不接真实模型也可开始。

可 fan-out：四个 ADR 可并行起草；Data Inventory 与 scenario schema 可并行。不可拆散：术语表与 shared-types 命名最终由单一 owner 收口，避免 `CognitiveCheckpoint/LearningCheckpoint`、`temporary step/adaptive task` 双词漂移。

### Phase 1：收口现有 MVP（AG1 + AG2 + AG3 + AG5 + AG10）

1. AG1 字段 allowlist、敏感 payload 回归、Inspector 说明。
2. AG2 outcome 成功窗口与六类 E2E。
3. AG3 中英场景、section anchor、transcript 生命周期。
4. AG5 gap-band 与 resume success（先不依赖 adaptive restore）。
5. 每一项同步进入 scenario dataset。

可 fan-out：AG1 privacy fixtures、AG2 outcome evaluator、AG3 bilingual eval、AG5 gap policy 是四个互不改同一业务核心的工作包。集成点集中在 shared-types/engine 时必须串行合并；E2E 文件由单 owner 维护，避免并发改同一 golden path。

### Phase 2：建立安全动作底座（AG9 → AG8 → AG10）

1. 先落 AgentRuntime 最小合同（structured + timeout + abort + fallback）。
2. 再落 read-only tools 和 registry。
3. 再落 proposal/confirmation envelope、权限与 audit。
4. 最后才开放 reversible/structural write。

可 fan-out：runtime conformance tests、read tool definitions、confirmation UI 原型、adversarial scenarios 可并行；但“写工具启用”必须等待 runtime validator、permission checks、confirmation binding 三项全部 green。

### Phase 3：Task Adaptation（AG4）

1. AdaptiveTask schema/migration。
2. SHRINK/SPLIT/CHANGE_MODALITY 纯 proposal builder。
3. confirmation→command→event→persistence。
4. adaptive practice、reorder proposal。
5. 与 AG5 restore 集成。

可 fan-out：三种 adaptation strategy 可在共同 schema 冻结后并行；migration/repository 与 UI diff 可并行。不可并行落地：plan ordering/progress invariants 需由同一集成 owner 负责。

### Phase 4：Memory 与完整 Resume（AG7 + AG5）

1. 有界 episodic queries 与 retention/delete。
2. preference store 仅建基础 CRUD，不启用自动推断。
3. checkpoint 纳入有界 Tutor/Rescue evidence。
4. adaptive state restore、long-gap refresher。

可 fan-out：memory repository、inspection/delete UI、checkpoint evidence summarizer、resume eval 可并行；删除语义需做一次跨库/缓存集成审计。

### Phase 5：Reflection/Personalization（AG6）

按 task-size → intervention → explanation → weekly reflection 的顺序逐个开放。每一类都经过“统计建议 → 展示证据 → 用户确认 → 存储 → 可撤销”，不要一次上线全画像。

可 fan-out：各 preference 的离线统计研究可以并行；写入模型、文案伦理审查和产品确认流必须统一。

### 关键路径

```text
Contracts + Eval Harness
  → AgentRuntime structured/abort
  → Tool registry + permission + confirmation
  → AdaptiveTask persistence/actions
  → Adaptive resume
  → Memory preference
  → Reflection
```

AG1/2/3/基础 AG5 的收口不必等关键路径，可并行交付并尽快形成更可信 Demo。

## 4. 当前应先交付的文档

建议第一批只交付 6 份，先建立决策护栏再写实现 issue：

1. `docs/wiki/index.md`：Wiki 导航、owner、状态定义、事实更新时间。
2. `docs/wiki/agent-capability-matrix.md`：把本文第 2 节拆成唯一能力台账，链接实现与测试。
3. `docs/wiki/adr/0001-agent-memory-scopes.md`：三层 memory、保留/删除/禁止数据。
4. `docs/wiki/adr/0002-agent-tool-permissions.md`：权限、proposal hash、确认、幂等、audit。
5. `docs/wiki/adr/0003-adaptive-task-lifecycle.md`：临时步骤与持久任务、position/progress/resume 语义。
6. `docs/wiki/evaluation-scenarios.md`：scenario schema、指标、release gates；先录入 AG1/2/3/5 的 20–30 个固定场景。

第二批再交付 `agent-runtime-contract.md`、`privacy-data-inventory.md`、`resume-quality-metrics.md` 和按 AG 拆分的页面。避免先建 10 份空壳能力页。

## 5. 首轮实施切片建议

如果下一轮只安排一个可交付切片，选择：**“Resume 三档 + success metric，但不引入新 LLM 能力”**。它复用现有 checkpoint/resume 强项、风险低、可 deterministic 测试，且直接增强最有辨识度的 Demo。并行补 AG10 scenario harness 与 AG1 privacy fixtures。

进入 AG4 前的硬门槛：AG8 的 structural-write confirmation 与 idempotency 测试已通过。进入 AG6 前的硬门槛：AG7 的 preference inspection/delete 已交付。
