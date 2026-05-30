import { z } from "zod";
import { hasAllMentionInContent, hasConfiguredBotMention } from "./bot-mention.ts";
import type { AppConfig } from "./config.ts";
import type { NormalizedMessageEvent } from "./types.ts";

const rawEventSchema = z
  .object({
    event_id: z.string().optional(),
    message_id: z.string().optional(),
    chat_id: z.string().optional(),
    chat_type: z.string().optional(),
    sender_id: z.string().optional(),
    message_type: z.string().optional(),
    content: z.unknown().optional(),
    create_time: z.union([z.string(), z.number()]).optional(),
    timestamp: z.union([z.string(), z.number()]).optional(),
    mentions: z.unknown().optional(),
    mentioned_bot: z.boolean().optional(),
  })
  .passthrough();

/**
 * 从飞书 content 字段中提取文本。
 *
 * lark-cli 可能输出纯字符串，也可能输出 JSON 字符串或对象。这里统一压成 text，
 * 避免下游 router/store 反复处理不同形态。
 */
function extractText(content: unknown): string {
  if (typeof content === "string") {
    const trimmed = content.trim();
    if (!trimmed.startsWith("{")) return content;
    try {
      const parsed = JSON.parse(trimmed) as { text?: unknown };
      return typeof parsed.text === "string" ? parsed.text : content;
    } catch {
      return content;
    }
  }

  if (content && typeof content === "object" && "text" in content) {
    const text = (content as { text?: unknown }).text;
    return typeof text === "string" ? text : "";
  }

  return "";
}

function toTimestampMs(value: string | number | undefined): number {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return Date.now();
  return parsed < 10_000_000_000 ? parsed * 1000 : parsed;
}

function mentionItemMatches(item: unknown, botOpenId: string): boolean {
  if (!item || typeof item !== "object" || !botOpenId) return false;
  const mention = item as Record<string, unknown>;
  const id = mention.id;
  if (typeof id === "string") {
    return id === botOpenId;
  }
  if (id && typeof id === "object") {
    const nested = id as Record<string, unknown>;
    if (nested.open_id === botOpenId || nested.user_id === botOpenId) return true;
  }
  return mention.open_id === botOpenId || mention.user_id === botOpenId;
}

/**
 * 从 lark-cli 可能保留的嵌套结构里查找 mentions / mentioned_bot。
 */
function mentionsBotInRawPayload(raw: unknown, botOpenId: string): boolean {
  if (!raw || typeof raw !== "object") return false;
  const root = raw as Record<string, unknown>;
  if (root.mentioned_bot === true) return true;

  const candidates: unknown[] = [root.mentions];
  const event = root.event;
  if (event && typeof event === "object") {
    const eventObj = event as Record<string, unknown>;
    if (eventObj.mentioned_bot === true) return true;
    const message = eventObj.message;
    if (message && typeof message === "object") {
      const messageObj = message as Record<string, unknown>;
      if (messageObj.mentioned_bot === true) return true;
      candidates.push(messageObj.mentions);
    }
  }

  const message = root.message;
  if (message && typeof message === "object") {
    const messageObj = message as Record<string, unknown>;
    if (messageObj.mentioned_bot === true) return true;
    candidates.push(messageObj.mentions);
  }

  return candidates.some(
    (mentions) => Array.isArray(mentions) && mentions.some((item) => mentionItemMatches(item, botOpenId)),
  );
}

function mentionsBot(raw: z.infer<typeof rawEventSchema>, config: AppConfig, rawPayload: unknown): boolean {
  if (mentionsBotInRawPayload(rawPayload, config.botOpenId)) return true;
  const content = extractText(raw.content);
  if (config.botOpenId && content.includes(config.botOpenId)) return true;
  if (hasConfiguredBotMention(content, config.botMentionNames)) return true;
  if (raw.chat_type === "group" && hasAllMentionInContent(content)) return true;
  if (!raw.mentions || !Array.isArray(raw.mentions)) return false;
  return raw.mentions.some((item) => mentionItemMatches(item, config.botOpenId));
}

export type NormalizeResult =
  | { ok: true; event: NormalizedMessageEvent }
  | { ok: false; reason: string; rawJson: string };

/**
 * 把 lark-cli 的一行 NDJSON 归一化为 src2 内部事件。
 *
 * @param line stdout 中的一行 JSON
 * @param config 应用配置，用于识别 bot open_id 和自身消息
 * @returns 成功时返回统一事件；失败时返回原因并保留原始 JSON
 */
export function normalizeEventLine(line: string, config: AppConfig): NormalizeResult {
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    return { ok: false, reason: "invalid-json", rawJson: line };
  }

  const parsed = rawEventSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      reason: parsed.error.issues.map((issue) => issue.message).join("; "),
      rawJson: line,
    };
  }

  const data = parsed.data;
  if (!data.chat_id || !data.message_id || !data.event_id || !data.sender_id) {
    return { ok: false, reason: "missing-required-fields", rawJson: line };
  }

  const content = extractText(data.content);
  const senderOpenId = data.sender_id;

  return {
    ok: true,
    event: {
      eventId: data.event_id,
      messageId: data.message_id,
      chatId: data.chat_id,
      chatType: data.chat_type ?? "",
      senderOpenId,
      messageType: data.message_type ?? "",
      content,
      createTimeMs: toTimestampMs(data.create_time ?? data.timestamp),
      mentionedBot: mentionsBot(data, config, raw),
      isFromBot: Boolean(config.botOpenId && senderOpenId === config.botOpenId),
      rawJson: JSON.stringify(raw),
    },
  };
}
