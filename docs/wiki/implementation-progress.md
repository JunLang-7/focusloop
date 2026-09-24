# Agent 实施进度（切片台账）

> 状态词汇与证据规则见 [功能清单 §1](./project-features.md)。三条硬规则：**不在 `main` 上的东西最高只能标「分支完成」；没有 PR 就不能标「PR 已开」；E2E 没跑到产品断言时不得标「完成」。**
>
> 本页原先把三个切片都标为「完成」。实际上它们全部只存在于分支
> [`feat/agent-phase1-evals-rescue`](https://github.com/nianpingy-cpu/focusloop/tree/feat/agent-phase1-evals-rescue)
> 的提交 `0f19c9f`，**该分支当前没有任何 PR**。因此三者均已改标为「分支完成」。

## 台账总表

| 切片               | 日期       | 范围                               | 状态         | 证据                                                           | 已知限制                                        |
| ------------------ | ---------- | ---------------------------------- | ------------ | -------------------------------------------------------------- | ----------------------------------------------- |
| AG1 (#99)          | 2026-09-20 | 有界上下文、omission、Inspector    | 已合并       | `63acc28`                                                      | 13 类事件投影 allowlist 在分支                  |
| AG2 (#100)         | 2026-09-20 | 六类卡点原因，原因先于行动         | 已合并       | `534bc1c`                                                      | 动作层未闭环（AG4/AG8）                         |
| AG3 (#101)         | 2026-09-20 | Tutor 契约、引擎、transcript、面板 | **PR 已开**  | PR [#101](https://github.com/nianpingy-cpu/focusloop/pull/101) | 未合并；领域层英文字符串违反 i18n               |
| Phase 0 / Slice 1  | 2026-09-21 | AG10 harness + AG1 字段投影        | **分支完成** | `0f19c9f`（无 PR）                                             | 未合并；`main` 上没有 `agent-evals`             |
| Phase 1 / Slice 2  | 2026-09-21 | AG5 三档 + 重新参与指标            | **分支完成** | `0f19c9f`（无 PR）                                             | 未合并；指标口径待改名；本机 E2E 未通过（#107） |
| Phase 1 / AG2 切片 | 2026-09-22 | rescue plan + outcome evaluator    | **分支完成** | `0f19c9f`（无 PR）                                             | 未合并；本机 E2E 未通过（#107）                 |

## Phase 0 / Slice 1

状态：**分支完成**（未合并，且无 PR）。

为什么不是「完成」：代码只在分支 `0f19c9f`；`main` 上不存在 `packages/agent-evals`，也不存在
`AgentContextEvent`。

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

### 分支本地证据（不可作为合并证据）

- AG1 固定场景：全部通过，重复运行结果一致。
- `@focusloop/agent-evals`：9 项测试通过；typecheck、lint 通过。
- `@focusloop/agent-core`：227 项测试通过；typecheck、lint 通过。
- `@focusloop/shared-types`：13 项测试通过；typecheck、lint 通过。
- Desktop typecheck 通过。
- 仓库级 test、typecheck、lint、build、文档校验和格式校验通过。

> 这些数字是在分支上跑出来的，`main` 上无法复现（对应的包与场景不在 `main`）。测试数量本身
> 也不是证据：合并后应以 PR 与 CI run 链接为准。

### 下一切片

按实施路线进入 Phase 1：AG5 Resume 三档策略与 resume success metric；同时扩充 AG10 的 AG5 deterministic scenarios。暂不引入新 LLM 能力。

## Phase 1 / Slice 2

状态：**分支完成**（未合并，且无 PR）。

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

### 分支本地证据（不可作为合并证据）

- **E2E 在本机没有通过**（已实测，2026-09-22）：`pnpm e2e` **能**启动 Electron 并运行测试，并不是“启动前被阻断”。实测结果是
  `golden-path.spec.ts:124`（learn → interrupted → resume）失败，套件在该用例处中止，其余 16 个未运行；
  而 `main` @ `e596d6f` 上的 `golden path` 检查是绿的（[CI run](https://github.com/nianpingy-cpu/focusloop/actions/runs/35619326202)）。
  因此本切片停在「分支完成」的原因不是环境阻断，而是**本机 E2E 未通过**，
  差异归因见 #107。

> 之前这里写的是“Electron 44 拒绝 Playwright 注入的 `--remote-debugging-port=0`，没有执行到任何产品断言”。
> 那句话是从未合并切片的文档里抄来的，**我没有先测就写进了台账**。保留这句话是为了说明它错在哪里：
> 套件确实跑起来了。

- 仓库级 737 项测试（分支本地）；`@focusloop/continuity` 41、`@focusloop/agent-core` 230、
  `@focusloop/persistence` 48、`@focusloop/agent-evals` 12 项。
- 全仓库 typecheck、lint、build、文档、Prettier 和 diff whitespace 校验通过。
- Desktop E2E **可以**启动 Electron 并执行产品断言，不是“启动前被阻断”。此前“Electron 拒绝
  `--remote-debugging-port=0`、未执行到任何产品断言”的记录有误；本切片验收时本地套件曾有一条
  用例失败，归因与修复见 #107。

> 计数是分支上的一次运行结果，不是可复核证据；合并后应绑定 PR 与 CI run 链接。

## Phase 1 / AG2 切片（2026-09-22）

状态：**分支完成**（未合并，且无 PR）。

### 本切片范围

- AG2：把 eval adapter 接到生产 `decideIntervention` → `buildRescuePlan` →
  `evaluateRescueSuccess` 路径，而不是在 adapter 内复制 reason/action 表。
- AG10：扩充 AG2 的 happy/edge/adversarial JSON fixtures，覆盖无 reason、未知 reason、
  `OVERLOADED` 下明确 reason 优先级、缺失 `acceptedAt`、跨 session/task、未来事件、重复事件与
  repeated-help precedence，并断言 `stepKeys`、`estimatedMinutes`、`source` 与 evidence ids。
- AG10 的当前交付仍只是 deterministic、同步、JSON-only runner；不包含真实模型、provider、
  tool/store 集成或完整端到端门禁。

### 分支本地证据（不可作为合并证据）

- 全仓库 764 项 Vitest 测试（分支本地）；12 个项目 typecheck、12 个项目 lint、11 个项目 build 通过。
- AG2 生产策略测试覆盖明确 reason 在 `OVERLOADED` 下仍按固定映射执行。
- AG10 共 18 个 AG2 JSON 场景；重复运行结果一致，并覆盖 happy/edge/adversarial。

### 已知未完成

- AG2 已有 offered → accept → plan → continue 桌面链路，以及 BREAK 暂停/恢复计时器的 E2E；
  **本机跑 `pnpm e2e` 时该套件在 `golden-path.spec.ts:124`（interrupted → resume）失败、后续用例未运行**
  （`main` 上 `golden path` 为绿；上文 §分支本地证据 记录了原“启动前被阻断”说法的来源与更正）。归因与修复见 #107。
- 临时任务变更、工具执行和完整六类 E2E 仍需 AG4/AG8 的 action contract。

## 未合并清单（本页必须持续跟踪）

| 分支                             | commit    | 内容                                          | 状态             | 备注                                                                                                 |
| -------------------------------- | --------- | --------------------------------------------- | ---------------- | ---------------------------------------------------------------------------------------------------- |
| `feat/ag3-contextual-tutor`      | `d1e6b03` | AG3 三步全部完成并逐轮评审通过                | **PR 已开** #101 | 检查结果与合并状态见 [PR #101 的 checks](https://github.com/nianpingy-cpu/focusloop/pull/101/checks) |
| `feat/agent-phase1-evals-rescue` | `0f19c9f` | Phase 0 切片 + Phase 1 切片（保留为单个提交） | **无 PR**        | 建议拆成可评审切片后开 PR                                                                            |

## 开放问题（不得随状态一起丢失）

1. **本机 E2E 与 CI 不一致**：本机 `pnpm e2e` 在 `golden-path.spec.ts:124` 失败而 CI 的 `golden path` 为绿。
   归因见 #107。两种读法都有可能（本机与两个 CI runner 之一是同一个 Windows），本页**不判定哪一边正确**，
   只记录事实：本机跑不出绿。这是**测试可信度**问题，
   不是“启动被阻断”。
2. **Resume 指标口径**：现有「成功率」把再次求助也算成成功，需按
   [Resume 策略与指标](./resume-policy-and-success.md) 拆成 `reengaged` / `progressed` / `stalledAgain`。
3. **遥测口径已收敛**：AG10 评测报告仅在开发者本机或 CI 中生成；生产应用无遥测、分析或崩溃上报，
   与 `docs/privacy.md` 的承诺一致。
4. **`0f19c9f` 里的 docs 改动**：该提交同时改了 `docs/wiki/*`。拆分/合并时以本页与
   [功能清单](./project-features.md) 为准，避免两套说法再次分叉。

### 下一切片

1. 把 `0f19c9f` 拆成可评审切片并开 PR（先 AG10 harness + AG1 投影，再 AG5 三档，再 AG2 rescue）。
2. 解决本机 E2E 与 CI 不一致的问题（#107），否则状态阶梯的上两级不可用。
3. 然后按 [交付路线图](./delivery-roadmap.md) 进入 AG9 Model Runtime。
