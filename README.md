# 企微群每日总结 Bot

内网部署的企微**智能机器人**（WebSocket 长连接）：收集群文本消息，工作日 18:00（或手动）生成 Markdown 日总结并推回群内。

## 技术栈

- Bun + TypeScript
- `@wecom/aibot-node-sdk`
- `bun:sqlite`

## 快速开始

### 1. 配置

```bash
cp config.example.env .env
# 编辑 .env，填入 WECOM_BOT_ID、WECOM_BOT_SECRET
```

### 2. 安装依赖

```bash
bun install
```

### 3. 启动服务（长连接收消息）

```bash
bun run start
```

首条群消息日志会打印 `chatid`，写入 `.env` 的 `WECOM_CHAT_ID` 后重启，即可启用 18:00 定时总结。

### 4. 手动触发总结

```bash
bun run cli trigger-summary
# 指定日期
bun run src/cli.ts trigger-summary --date=2024-05-19
```

### 5. 测试

```bash
bun test
```

## LLM

- 配置 `LLM_API_KEY` 后使用 OpenAI 兼容 API 生成智能总结。
- **未配置**时使用规则模板总结（便于无密钥本地联调）。

## 文档

- 产品设计：`doc/design-wecom-daily-summary.md`
- 工程计划：`doc/plan-wecom-daily-summary-eng.md`

## 出站白名单

- `openws.work.weixin.qq.com`
- 所用 LLM API 域名
