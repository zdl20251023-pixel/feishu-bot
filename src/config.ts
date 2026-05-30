import { z } from "zod";
import type { LogLevel } from "./types.ts";

const logLevelSchema = z.enum(["debug", "info", "warn", "error"]);

const envSchema = z.object({
  LARK_CLI_BIN: z.string().optional().default(""),
  LARK_EVENT_KEY: z.string().optional().default("im.message.receive_v1"),
  LARK_DB_PATH: z.string().optional().default("./data/lark-bot.db"),
  LARK_TARGET_CHAT_ID: z.string().optional().default(""),
  LARK_DENY_CHAT_IDS: z.string().optional().default(""),
  LARK_PAUSED_CHAT_IDS: z.string().optional().default(""),
  LARK_BOT_OPEN_ID: z.string().optional().default(""),
  LARK_BOT_MENTION_NAMES: z.string().optional().default(""),
  LARK_REPLY_IN_THREAD: z.string().optional().default("false"),
  LARK_LLM_CONCURRENCY: z.coerce.number().int().positive().optional().default(2),
  LARK_MAX_CONTEXT_MESSAGES: z.coerce.number().int().positive().optional().default(500),
  LARK_MAX_BODY_LEN: z.coerce.number().int().positive().optional().default(2000),
  LARK_MAX_STORED_TEXT_LEN: z.coerce.number().int().positive().optional().default(8000),
  LARK_MSG_RETENTION_DAYS: z.coerce.number().int().positive().optional().default(30),
  LOG_LEVEL: logLevelSchema.optional().default("info"),
  CRON_TZ: z.string().optional().default("Asia/Shanghai"),
  LLM_API_BASE: z.string().optional().default("https://api.openai.com/v1"),
  LLM_API_KEY: z.string().optional().default(""),
  LLM_MODEL: z.string().optional().default("gpt-4o-mini"),
});

export type AppConfig = {
  larkCliBin: string;
  eventKey: string;
  dbPath: string;
  targetChatId: string;
  denyChatIds: Set<string>;
  pausedChatIds: Set<string>;
  botOpenId: string;
  botMentionNames: string[];
  replyInThread: boolean;
  llmConcurrency: number;
  maxContextMessages: number;
  maxBodyLen: number;
  maxStoredTextLen: number;
  retentionDays: number;
  logLevel: LogLevel;
  cronTz: string;
  llmApiBase: string;
  llmApiKey: string;
  llmModel: string;
};

/**
 * 解析逗号分隔的群 ID 列表。
 *
 * @param value 环境变量原始值，例如 `oc_a,oc_b`
 * @returns 去空格、去空项后的集合，便于路由层 O(1) 判断
 */
function parseIdSet(value: string): Set<string> {
  return new Set(
    value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  );
}

/**
 * 解析机器人在群聊文本里可见的 @ 显示名。
 *
 * @param value 环境变量原始值，例如 `zdltest01,zdl的飞书 CLI`
 * @returns 去空格、去重后的显示名列表；支持用户写或不写开头的 `@`
 */
function parseMentionNames(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(",")
        .map((item) => item.trim().replace(/^@+/, ""))
        .filter(Boolean),
    ),
  );
}

/**
 * 加载 src2 独立配置。
 *
 * 注意：
 * - 本模块不读取 `src/` 的企微配置，也不依赖旧机器人代码。
 * - 飞书凭证仍由 `lark-cli` 自己管理，这里只负责 CLI 路径和业务配置。
 * - `LARK_TARGET_CHAT_ID` 仅作为兼容旧调试习惯的可选过滤，不作为 V1 的默认 allowlist。
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const raw = {
    ...env,
    LARK_CLI_BIN: env.LARK_CLI_BIN?.trim() ?? "",
    LARK_EVENT_KEY: env.LARK_EVENT_KEY?.trim() ?? "im.message.receive_v1",
    LARK_DB_PATH: env.LARK_DB_PATH?.trim() ?? "./data/lark-bot.db",
    LARK_TARGET_CHAT_ID: env.LARK_TARGET_CHAT_ID?.trim() ?? "",
    LARK_DENY_CHAT_IDS: env.LARK_DENY_CHAT_IDS?.trim() ?? "",
    LARK_PAUSED_CHAT_IDS: env.LARK_PAUSED_CHAT_IDS?.trim() ?? "",
    LARK_BOT_OPEN_ID: env.LARK_BOT_OPEN_ID?.trim() ?? "",
    LARK_BOT_MENTION_NAMES: env.LARK_BOT_MENTION_NAMES?.trim() ?? "",
    LLM_API_BASE: env.LLM_API_BASE?.trim() ?? "https://api.openai.com/v1",
    LLM_API_KEY: env.LLM_API_KEY?.trim() ?? "",
    LLM_MODEL: env.LLM_MODEL?.trim() ?? "gpt-4o-mini",
  };

  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const message = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`src2 配置校验失败: ${message}`);
  }

  const defaultCliBin = process.platform === "win32" ? "lark-cli.cmd" : "lark-cli";

  return {
    larkCliBin: parsed.data.LARK_CLI_BIN || defaultCliBin,
    eventKey: parsed.data.LARK_EVENT_KEY,
    dbPath: parsed.data.LARK_DB_PATH,
    targetChatId: parsed.data.LARK_TARGET_CHAT_ID,
    denyChatIds: parseIdSet(parsed.data.LARK_DENY_CHAT_IDS),
    pausedChatIds: parseIdSet(parsed.data.LARK_PAUSED_CHAT_IDS),
    botOpenId: parsed.data.LARK_BOT_OPEN_ID,
    botMentionNames: parseMentionNames(parsed.data.LARK_BOT_MENTION_NAMES),
    replyInThread: parsed.data.LARK_REPLY_IN_THREAD === "true",
    llmConcurrency: parsed.data.LARK_LLM_CONCURRENCY,
    maxContextMessages: parsed.data.LARK_MAX_CONTEXT_MESSAGES,
    maxBodyLen: parsed.data.LARK_MAX_BODY_LEN,
    maxStoredTextLen: parsed.data.LARK_MAX_STORED_TEXT_LEN,
    retentionDays: parsed.data.LARK_MSG_RETENTION_DAYS,
    logLevel: parsed.data.LOG_LEVEL,
    cronTz: parsed.data.CRON_TZ,
    llmApiBase: parsed.data.LLM_API_BASE.replace(/\/$/, ""),
    llmApiKey: parsed.data.LLM_API_KEY,
    llmModel: parsed.data.LLM_MODEL,
  };
}

export function isLlmEnabled(config: AppConfig): boolean {
  return Boolean(config.llmApiKey.trim());
}
