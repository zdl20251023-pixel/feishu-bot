# gstack Skill 使用分析报告

**项目：** `gstack_test_02` — 企微群每日总结 Bot（0→1）  
**报告日期：** 2026-05-19  
**环境：** Cursor + gstack skills（全局安装于 `~/.cursor/skills/gstack`）

---

## 1. 执行摘要

本项目从空仓库出发，通过 **2 个 gstack 规划类 Skill** + **1 次 Agent 直接实现**，在约一轮工作日内完成「需求澄清 → 设计锁定 → 工程评审 → 可运行代码」闭环。

| 阶段 | 使用 Skill | 产出 |
|------|------------|------|
| 想法 → 设计 | `/office-hours`（`gstack-office-hours`） | 已批准设计文档 |
| 设计 → 实施计划 | `/plan-eng-review`（`gstack-plan-eng-review`） | 锁定工程计划 + 测试计划 |
| 计划 → 代码 | 无 Skill（Cursor Agent 实现） | Bun/TS 可运行服务 + 单测 |

**未使用但曾评估的 Skill：** `/plan-ceo-review`、`/plan-design-review`、`/autoplan`、`/qa`、`/ship`（当前阶段不需要）。

---

## 2. 项目背景与目标

| 项 | 内容 |
|----|------|
| 业务目标 | 企微群接入机器人，工作日 18:00 自动发当日总结；支持手动触发 |
| 部署约束 | 服务在内网、无公网入站；可出站访问企微与 LLM |
| 技术偏好 | 学习项目；后定为 **Node.js + TypeScript + Bun** |
| 初始仓库 | 空目录，无 Git、无代码 |

---

## 3. Skill 使用流水线（关键步骤）

```text
用户: /gstack-office-hours
    ↓  [多轮 AskUserQuestion：模式/范围/技术/方案]
    ↓  设计文档 APPROVED
用户: /plan-eng-review + doc/design-wecom-daily-summary.md
    ↓  [Step0 + 架构/代码/测试 8 项决策]
    ↓  工程计划 LOCKED
用户: 「开始实现」
    ↓  Agent 按 T1–T5 写代码
    ↓  联调：长连接、@机器人收消息、推送总结
```

---

## 4. Skill ①：`/office-hours`（产品设计）

### 4.1 触发方式

```
/gstack-office-hours
（用户手动附加 skill，并描述：企微机器人 + 日总结 + 内网可测）
```

### 4.2 Skill 做了什么（关键步骤，不可省略）

| 步骤 | 动作 | 本项目结果 |
|------|------|------------|
| Preamble | 读配置、slug、telemetry 等 | `SLUG=gstack_test_02` |
| Phase 1 | 读仓库、搜历史设计 | 空仓库；发现同机 `gstack-test-01` 有类似设计 |
| 跨项目学习 | AskUserQuestion | 用户选 **仅本项目** |
| 模式选择 | AskUserQuestion | **学习 / Builder** |
| Builder 问诊 | 逐题 AskUserQuestion | 最酷版本、推群、18:00+手动、内网出站、V1 单群 |
| 业界检索 | WebSearch（用户同意） | 确认长连接 `openws`、SDK 存在 |
| 前提确认 | AskUserQuestion | 7 条前提 **全部同意** |
| 第二意见 | 用户选跳过 | — |
| **方案对比** | AskUserQuestion | 选 **A：SDK + SQLite** |
| 对抗审阅 | 子 Agent 审阅设计 | 修补 schema/状态机等 |
| 批准 | AskUserQuestion | **APPROVED** |

### 4.3 关键决策（设计阶段锁定）

1. **智能机器人长连接**，非 Webhook 只发不收机器人。  
2. 「无公网」= 无公网**入站**，可出站。  
3. V1：**1 个群**、**18:00 工作日**、**推回同一群**、**CLI 手动触发**。  
4. 实现路线：**单进程 + SQLite**（Approach A）。

### 4.4 产出物

| 路径 | 说明 |
|------|------|
| `~/.gstack/projects/gstack_test_02/admin-local-design-20260519-161256.md` | gstack 原件 |
| `doc/design-wecom-daily-summary.md` | 项目内副本（用户要求） |
| Status | **APPROVED** |

### 4.5 Skill 价值

- 把「内网可测」从模糊口号拆成可写进设计的部署前提。  
- 方案对比避免一上来就上 Redis/队列。  
- **硬门禁：此 Skill 不写代码**，避免过早实现。

---

## 5. Skill ②：`/plan-eng-review`（工程评审）

### 5.1 触发方式

```
/plan-eng-review，把 doc/design-wecom-daily-summary.md 交给它
```

### 5.2 Skill 做了什么（关键步骤）

| 步骤 | 动作 | 本项目结果 |
|------|------|------------|
| 读设计文档 | 作为 plan 输入 | `doc/design-wecom-daily-summary.md` |
| Step 0 范围 | AskUserQuestion | 用户选 **一次建齐 7 模块**（非 Spike 薄层） |
| §1 架构 | 3 个 AskUserQuestion | 后台 Job、msg_ts、推送防双发 |
| §2 代码 | AskUserQuestion | 用户指定 **Node/TS/Bun**（修正 Python 假设） |
| §3 存储 | AskUserQuestion | **bun:sqlite + WAL** |
| §4 测试 | AskUserQuestion | **轻量 LLM Eval** |
| 计划锁定 | AskUserQuestion | **LOCKED，可开工** |
| 外部第二意见 | 跳过 | — |

### 5.3 8 项工程决策（实施依据）

| ID | 决策 |
|----|------|
| D1 | 一次建齐 7 模块目录 |
| D2 | 总结后台 Job，禁止在 WS 回调里 await LLM |
| D3 | 用 `msg_ts` 业务时间划「当日」 |
| D4 | `wecom_msg_id` 防推送重试双发 |
| D5 | `src/` 单包结构 |
| D6 | `bun:sqlite` |
| D7 | Eval fixture 测总结结构 |

### 5.4 产出物

| 路径 | 说明 |
|------|------|
| `doc/plan-wecom-daily-summary-eng.md` | 工程实施计划（含 T1–T5、目录、Schema 修订） |
| `doc/test-plan-wecom-bot.md` | QA 输入 |
| `~/.gstack/projects/gstack_test_02/admin-local-eng-plan-20260519.md` | gstack 副本 |

### 5.5 Skill 价值

- 在设计已批准前提下，补齐 **并发、幂等、时区、测试** 等实现级细节。  
- 交互式决策留下可追溯依据（非一次性长文）。  
- 明确 **ENG CLEARED** 后再写代码，减少返工。

---

## 6. 实现阶段（非 Skill，Agent 直接执行）

### 6.1 触发

用户：「开始实现」

### 6.2 按工程计划完成的任务

| 任务 | 内容 | 验证 |
|------|------|------|
| T1 | `package.json`、SDK 长连接、配置 | `bun run start` 认证成功 |
| T2 | `store.ts`、`message-handler.ts` | `bun test` |
| T3 | `summarizer`、`publisher`、`summary-job-runner`、CLI | `trigger-summary` 推群 |
| T4 | cron 18:00、启动补跑、retention | 日志可见定时注册 |
| T5 | 单测 + Eval | **7 tests pass** |

### 6.3 代码结构（与 eng plan 一致）

```text
src/
  index.ts, cli.ts, config.ts, ws-client.ts
  message-handler.ts, store.ts, summarizer.ts
  publisher.ts, summary-job-runner.ts, scheduler.ts, retention.ts
tests/ + fixtures/
```

### 6.4 联调中发现（非 Skill，但影响产品）

| 发现 | 性质 |
|------|------|
| 仅 **@具体机器人** 才收到回调；@所有人、普通群消息无回调 | **企微平台规则**，非 bug |
| 首次 `invalid bot_id or secret` | 配置问题，后认证成功 |
| 单 Bot 仅一条长连接；多开进程会 `disconnected_event` | 企微 + SDK 限制 |

**建议：** 在设计文档中补充「智能机器人仅能汇总 @ 机器人的消息，不能替代会话存档做全群日报」。

---

## 7. 产物清单（0→1）

| 类型 | 文件 |
|------|------|
| 设计 | `doc/design-wecom-daily-summary.md` |
| 工程 | `doc/plan-wecom-daily-summary-eng.md` |
| 测试 | `doc/test-plan-wecom-bot.md` |
| 配置 | `config.example.env`、`.env` |
| 运行 | `bun run start` / `bun run cli trigger-summary` |
| 数据 | `data/bot.db` |
| gstack 归档 | `~/.gstack/projects/gstack_test_02/*.md` |

---

## 8. Skill 使用统计与效率

| Skill | 交互轮次（约） | 主要耗时 | 是否必需 |
|-------|----------------|----------|----------|
| office-hours | 10+ AskUserQuestion | 需求与方案 | **必需**（无设计则 eng review 输入弱） |
| plan-eng-review | 8+ AskUserQuestion | 架构与测试决策 | **推荐**（本项目技术栈在 eng 阶段才锁定） |
| 直接实现 | — | 编码+联调 | 必需 |

**若重来可压缩：**

- office-hours 已明确技术栈时，可跳过部分 Builder 问诊。  
- eng review 选「Spike 薄层」可更快见可运行 demo（本项目选了「一次建齐」）。

---

## 9. 未使用的 Skill 及原因

| Skill | 未用原因 |
|-------|----------|
| `/plan-ceo-review` | 学习项目，非创业/立项叙事 |
| `/plan-design-review` | 无 Web UI，仅群内 Markdown |
| `/autoplan` | 已手动跑完 office-hours + eng review |
| `/qa` `/qa-only` | 有单测，未做端到端 QA Skill |
| `/ship` | 未建 Git 远程、未发 PR |
| `/investigate` | 配置/平台问题在对话中已定位 |

---

## 10. 建议的「标准 0→1」Skill 路径（可复制）

适用于：**空仓库 + 后端/机器人类 + 需要先想清楚再写代码**

```text
1. /office-hours     → 设计文档 APPROVED（不写代码）
2. /plan-eng-review  → 工程计划 LOCKED（输入：doc/*-design*.md）
3. Agent 实现        → 严格按 Implementation Tasks
4. （可选）/qa       → 有 UI 或关键链路时
5. （可选）/ship     → 需要 PR 时
```

---

## 11. 结论

- gstack 在本项目中承担 **「思考与锁定」** 角色；**编码** 由 Cursor Agent 按锁定计划执行。  
- **两个 Skill 的关键价值：** 结构化决策（AskUserQuestion）、可追溯文档、避免设计与实现脱节。  
- **最大平台认知（联调获得）：** 智能机器人 + 长连接 **不能** 收全群聊天记录，只能收 **@ 机器人** 的消息；与 WebSocket 无关。  
- 若业务要求「全群日总结」，需单独立项（会话存档等），超出当前设计 V1 范围。

---

*本报告由项目实际对话与仓库产物整理，供内部分享与后续项目复用。*
