# 飞书智能机器人工程评审计划

来源：`/gstack-plan-eng-review`  
评审对象：`doc/design-lark-bot-需求001.md`

## 结论

完整 V1 继续推进，不缩小范围。实现前不加未 @ 群消息运行时代码门禁，也不强制文档门禁；但实现要假定事件流可用，并通过联调暴露风险。

本评审要求把以下工程决定补进实施计划：群级 denylist/pause、summary/reminder 作业幂等、LLM schema + candidate 流程、zod event normalizer、集中 `lark-client.ts`、单一命令解析器、完整 `tests/src2/*.test.ts`、总结与任务 eval、LLM 并发队列、SQLite 索引和截断、event watchdog + per-chat 队列、明确总结时段、过滤 bot 自身消息、info 日志截断。

## Step 0 范围挑战

已接受完整 V1：私聊回复、群 @ 回复、未 @ 静默入库、12:00/18:00 总结、任务抽取、10:00 提醒、完成指令全部纳入同一阶段。

复杂度风险已确认：计划会拆出超过 8 个模块，并引入超过 2 个服务边界。为了避免单文件硬堆，实施必须以模块边界和测试边界同步推进，不能先写一个新的大 `index.ts`。

## What Already Exists

- `src2/index.ts` 已有飞书事件消费、Windows `lark-cli.cmd` 兼容、私聊回复、群总结触发、基础日志和内存缓存。新实现应保留已验证的 CLI 链路，但拆成模块。
- `src/store.ts` 已有 Bun SQLite、WAL、busy_timeout、消息去重、按业务日查询、summary job 状态思想。`src2/store.ts` 应参考结构，不直接改 `src/`。
- `src/scheduler.ts` 已有 `croner` 工作日定时写法。`src2/scheduler.ts` 应复用 Croner 模式，增加 10:00、12:00、18:00 三类作业。
- `src/summarizer.ts` 已有 LLM 调用、超时、消息采样和截断思想。`src2/summarizer.ts` 应复用这些约束，并改成飞书语境。
- `tests/store.test.ts`、`tests/summarizer.test.ts`、`tests/eval/summary.eval.test.ts` 已定义 Bun 测试和 eval 风格。`src2` 应新增同级测试，而不是等联调后补。

## Architecture Review

必须补进设计的架构项：

- 群级范围控制：默认所有机器人可见群，但支持 denylist 和 pause，避免误拉进敏感群后自动入库和推送。
- 作业幂等：summary 和 task reminder 都需要唯一键与状态机，避免 cron 重入、重启、手动触发造成重复发群消息。
- LLM 任务抽取可信边界：只接受 schema 校验通过的输出；低置信度进入 candidate，不进入 10:00 提醒。
- 事件消费可靠性：`lark-cli event consume` 需要 watchdog 退避重启，事件处理进入队列，并按 `chat_id` 串行处理。
- 路由边界：normalizer 固定内部事件类型，router 只做 p2p / group @ / group 静默分流，commands 只解析命令，handler 执行业务。

```text
lark-cli event consume
        |
        v
watchdog + ndjson reader
        |
        v
event-normalizer (zod + raw_json)
        |
        v
persistent inbox / per-chat queue
        |
        v
message-router
  |          |             |
  v          v             v
p2p       group @       group silent
reply     command/LLM   store only
  \          |             /
   \         v            /
    +---- SQLite store ----+
              |
              v
   scheduler / jobs / LLM queue
              |
              v
       lark-client send/reply
```

## Code Quality Review

实施时按以下模块边界拆 `src2/index.ts`：

- `config.ts`：用 `zod` 校验 env，包括 denylist/pause、DB 路径、LLM 并发、消息截断、保留天数。
- `event-normalizer.ts`：解析 NDJSON，输出统一内部事件，保留 `raw_json`，解析失败只记录结构化错误。
- `lark-client.ts`：集中封装 `lark-cli`，负责 Windows bin、spawn timeout、stderr、send/reply、idempotency key。
- `message-router.ts`：只做分流，不直接拼 CLI，不直接解析命令。
- `commands.ts`：统一解析 `总结`、`summary`、`任务`、`帮助`、`完成 T-xxx`、`done T-xxx`。
- `store.ts`：SQLite 表、索引、去重、任务状态、summary/reminder 作业状态。
- `summarizer.ts`、`task-extractor.ts`：LLM 入口必须走 schema/截断/队列约束。
- `scheduler.ts`、`task-reminder.ts`：只调 job/service，不直接查散落 SQL。

## Test Review

现有覆盖：`src2` 计划路径目前 0/27 有测试。

```text
CODE PATHS
[+] event-normalizer.ts
  ├── [GAP] 合法 text 事件归一化
  ├── [GAP] 缺字段/坏 JSON 不崩溃
  └── [GAP] raw_json 保留
[+] message-router.ts
  ├── [GAP] p2p 普通文本 -> 私聊回复
  ├── [GAP] group @ 普通文本 -> 群回复
  ├── [GAP] group 未 @ -> 静默入库
  ├── [GAP] denylist/pause -> 不处理自动作业
  └── [GAP] bot 自身消息 -> 忽略
[+] commands.ts
  ├── [GAP] 总结/summary
  ├── [GAP] 任务/任务状态
  ├── [GAP] 帮助/help
  └── [GAP] 完成 T-xxx / done T-xxx
[+] store.ts
  ├── [GAP] messages 去重 + 30 天清理
  ├── [GAP] summary/reminder job 幂等状态机
  └── [GAP] task candidate/open/done 状态转换
[+] task-extractor.ts
  ├── [GAP] 规则候选命中/不命中
  ├── [GAP] LLM JSON schema 通过/失败
  └── [GAP] 低置信度 candidate 不提醒

USER FLOWS
[+] 飞书私聊
  ├── [GAP] 普通文本有 LLM/无 LLM 两种回复
  └── [GAP] 命令词不走通用闲聊
[+] 群聊
  ├── [GAP] @机器人回复/命令
  ├── [GAP] 未 @ 入库但不回复
  ├── [GAP] 12:00/18:00 总结只发一次
  └── [GAP] 10:00 未完成任务提醒只发一次

COVERAGE: 0/27 planned src2 paths tested
QUALITY: GAP-heavy; implement with tests from first module
```

测试要求：

- 新增 `tests/src2/event-normalizer.test.ts`、`message-router.test.ts`、`commands.test.ts`、`store.test.ts`、`scheduler.test.ts`、`task-extractor.test.ts`。
- 用 fake `lark-client` 和 fake LLM，不在单元测试里真实调用飞书或 LLM。
- 新增 eval：群总结 eval 和任务抽取 eval，覆盖事实一致性、无任务闲聊、明确安排、多任务负责人、低置信度候选。
- 手动联调只验证飞书真实权限与事件流，不替代单元测试。

## Performance Review

- LLM 请求必须走队列，默认并发上限建议 2，通过 `LARK_LLM_CONCURRENCY` 配置。
- SQLite 必须有索引：`messages(chat_id,msg_ts)`、任务扫描索引、job 唯一键、task 状态索引。
- 入库保留完整 text 但限制最大长度；进入 LLM 前再次按 `MAX_MESSAGES` 和 `MAX_BODY_LEN` 截断。
- retention job 每天清理 30 天外消息，避免长期运行磁盘膨胀。
- info 日志默认截断 content；完整正文只保留在 DB 或 debug 模式。

## Failure Modes

- `lark-cli event consume` 退出：watchdog 重启；如果连续失败，打 error 并保持主进程可观测。
- 同一群多条消息并发：per-chat queue 保序，避免重复写任务和重复回复。
- cron 重入或进程重启：job 唯一键和状态机阻止重复发送。
- LLM 限流/超时：队列 + 重试 + failed 状态，用户不会收到半截或重复消息。
- LLM 抽取误判任务：schema + confidence + candidate 流程，低置信度不提醒。
- bot 自己发的总结回灌：按 bot sender 过滤，不进入任务抽取和总结上下文。
- 敏感群误入库：denylist/pause 可关闭自动处理。

## NOT In Scope

- 不引入飞书会话存档/审计数据源；如果事件流不能提供未 @ 消息，本轮不自动改路线。
- 不修改 `src/` 企微实现；只参考其 store/scheduler/summarizer 模式。
- 不做 Web UI、管理后台或多租户权限系统。
- 不做 LLM 自动判断任务完成；完成只接受明确命令。
- 不做附件、图片、文件内容解析；V1 仅 text。

## Worktree Parallelization

可并行，但先落公共契约。

```text
Lane A: config/types/event-normalizer/lark-client
  -> 所有 lane 的基础，先做
Lane B: store/job state/retention
  -> 依赖 types，可与 router 并行
Lane C: commands/message-router/reply handlers
  -> 依赖 event-normalizer + lark-client
Lane D: summarizer/task-extractor/evals
  -> 依赖 LLM queue 接口和 store 类型
Lane E: scheduler/task-reminder
  -> 依赖 store job state + lark-client + summarizer/task service
```

执行顺序：先完成 Lane A；随后 B + C + D 可并行；最后 E 串接。冲突点集中在 `src2/types.ts`、`src2/store.ts`、`src2/config.ts`，并行 worktree 需要先约定接口。

## Implementation Tasks

- [ ] **T1 (P1, human: ~2h / CC: ~20min)** — 事件基础设施 — 拆出 `event-normalizer.ts`、`lark-client.ts`、watchdog 和 per-chat 队列
  - Surfaced by: Architecture + Code Quality
  - Files: `src2/index.ts`, `src2/event-normalizer.ts`, `src2/lark-client.ts`, `src2/message-router.ts`, `src2/types.ts`
  - Verify: `bun test tests/src2/event-normalizer.test.ts tests/src2/message-router.test.ts`

- [ ] **T2 (P1, human: ~2h / CC: ~25min)** — SQLite 和作业状态 — 实现 messages/tasks/summary/reminder jobs、索引、retention、幂等状态机
  - Surfaced by: Architecture + Performance
  - Files: `src2/store.ts`, `src2/retention.ts`, `tests/src2/store.test.ts`
  - Verify: `bun test tests/src2/store.test.ts`

- [ ] **T3 (P2, human: ~1h / CC: ~15min)** — 命令系统 — 实现单一 `commands.ts` 并统一私聊/群 @ 命令分流
  - Surfaced by: Code Quality
  - Files: `src2/commands.ts`, `src2/message-router.ts`, `tests/src2/commands.test.ts`
  - Verify: `bun test tests/src2/commands.test.ts tests/src2/message-router.test.ts`

- [ ] **T4 (P1, human: ~2h / CC: ~25min)** — LLM 安全边界 — 实现总结截断、LLM 队列、任务抽取 schema、candidate/open 流程
  - Surfaced by: Architecture + Performance + Test Review
  - Files: `src2/summarizer.ts`, `src2/task-extractor.ts`, `src2/llm-queue.ts`, `tests/src2/task-extractor.test.ts`, `tests/eval/lark-summary.eval.test.ts`, `tests/eval/lark-task-extractor.eval.test.ts`
  - Verify: `bun test tests/src2/task-extractor.test.ts tests/eval/lark-summary.eval.test.ts tests/eval/lark-task-extractor.eval.test.ts`

- [ ] **T5 (P1, human: ~2h / CC: ~20min)** — 调度和提醒 — 实现 10:00 reminder、12:00 noon、18:00 evening，窗口为 00:00–12:00 和 00:00–18:00
  - Surfaced by: Architecture + External Voice
  - Files: `src2/scheduler.ts`, `src2/task-reminder.ts`, `src2/summary-job-runner.ts`, `tests/src2/scheduler.test.ts`
  - Verify: `bun test tests/src2/scheduler.test.ts`

- [ ] **T6 (P2, human: ~45min / CC: ~10min)** — 事故半径控制 — 加 denylist/pause、bot 自身消息过滤、info 日志正文截断
  - Surfaced by: Architecture + External Voice
  - Files: `src2/config.ts`, `src2/message-router.ts`, `src2/logger.ts`, `tests/src2/message-router.test.ts`
  - Verify: `bun test tests/src2/message-router.test.ts`

## Review Status

- Scope Challenge: 完整 V1 接受，不缩小
- Architecture Review: 5 个问题已决策
- Code Quality Review: 3 个问题已决策
- Test Review: 覆盖图已产出，27 个计划路径需新增测试
- Performance Review: 2 个问题已决策
- Outside Voice: 已跑只读子代理，新增 3 个问题已决策
- TODOS.md: 1 个候选，被选择跳过
- Failure Modes: 0 个未处理 critical gap，前提是上述任务全部落地
- Lake Score: 11/12 个决策选择完整方案；未 @ 门禁选择不加

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | not run | 可选；本轮已通过 office-hours 形成设计文档 |
| Codex Review | `/codex review` | Independent 2nd opinion | 0 | unavailable | 本机未检测到 codex 命令 |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | issues_open | 13 个决策点，完整 V1 可继续，但必须补齐上述工程任务 |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | not applicable | 后端/机器人流程，无 UI |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | not run | 可选；如后续要打包成可复用 CLI 再做 |

- **OUTSIDE VOICE:** 已跑只读子代理；新增 watchdog/per-chat queue、summary period、bot self-message/log truncation 三项并已决策。
- **CROSS-MODEL:** 仅未 @ 数据源门禁存在分歧；用户明确维持“不加代码门禁”。
- **UNRESOLVED:** 0 个交互决策未响应。
- **VERDICT:** ENG REVIEW 完成但状态为 issues_open；实现前按 Implementation Tasks 更新设计/代码计划。
