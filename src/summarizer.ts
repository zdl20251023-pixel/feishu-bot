import type { AppConfig } from "./config.ts";
import { isLlmEnabled } from "./config.ts";
import type { LlmQueue } from "./llm-queue.ts";
import type { MessageForSummary, SummaryRunType } from "./types.ts";
import { formatTimeShanghai } from "./time.ts";

export const EMPTY_SUMMARY_MESSAGE = "今日无有效群消息。";

/**
 * 截断并采样消息，控制 LLM token 和成本。
 */
export function prepareMessages(config: AppConfig, messages: MessageForSummary[]): MessageForSummary[] {
  const clipped = messages.map((message) => ({
    ...message,
    content:
      message.content.length > config.maxBodyLen
        ? `${message.content.slice(0, config.maxBodyLen)}…`
        : message.content,
  }));

  if (clipped.length <= config.maxContextMessages) return clipped;
  const step = clipped.length / config.maxContextMessages;
  const sampled: MessageForSummary[] = [];
  for (let i = 0; i < config.maxContextMessages; i += 1) {
    sampled.push(clipped[Math.floor(i * step)]!);
  }
  return sampled;
}

/**
 * 无 LLM 时的确定性模板总结。
 */
export function summarizeWithTemplate(
  config: AppConfig,
  messages: MessageForSummary[],
  runType: SummaryRunType,
): string {
  const prepared = prepareMessages(config, messages);
  if (prepared.length === 0) return EMPTY_SUMMARY_MESSAGE;

  const title = runType === "noon" ? "午间阶段总结" : runType === "evening" ? "下班累计总结" : "手动总结";
  const bullets = prepared.slice(0, 12).map((message) => {
    return `- **${formatTimeShanghai(message.msgTsMs)}** ${message.senderOpenId}: ${message.content.slice(0, 160)}`;
  });

  return [
    `## ${title}`,
    "",
    "## 今日要点",
    ...bullets,
    prepared.length > 12 ? `- …共 ${prepared.length} 条消息` : "",
    "",
    "## 未决 / 待确认",
    "- （模板模式：配置 `LLM_API_KEY` 后启用智能总结）",
    "",
    "## 需关注",
    "- 暂无",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * 生成群总结，LLM 调用统一经过并发队列。
 */
export async function buildSummary(
  config: AppConfig,
  queue: LlmQueue,
  messages: MessageForSummary[],
  runType: SummaryRunType,
): Promise<string> {
  const prepared = prepareMessages(config, messages);
  if (!isLlmEnabled(config)) return summarizeWithTemplate(config, prepared, runType);
  if (prepared.length === 0) return EMPTY_SUMMARY_MESSAGE;

  const lines = prepared.map((message) => {
    return `[${formatTimeShanghai(message.msgTsMs)}] ${message.senderOpenId}: ${message.content}`;
  });
  const runLabel = runType === "noon" ? "午间阶段总结" : runType === "evening" ? "下班累计总结" : "手动总结";

  return queue.run(async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120_000);
    try {
      const response = await fetch(`${config.llmApiBase}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.llmApiKey}`,
        },
        body: JSON.stringify({
          model: config.llmModel,
          temperature: 0.2,
          messages: [
            {
              role: "system",
              content:
                "你是飞书群秘书。只根据给定消息总结，禁止编造。输出 Markdown，必须包含：## 今日要点、## 未决 / 待确认、## 需关注、## 未完成任务摘要。",
            },
            {
              role: "user",
              content: `总结类型：${runLabel}\n\n消息列表：\n${lines.join("\n")}`,
            },
          ],
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`LLM HTTP ${response.status}: ${text.slice(0, 300)}`);
      }

      const data = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = data.choices?.[0]?.message?.content?.trim();
      if (!content) throw new Error("LLM 返回空内容");
      return content;
    } finally {
      clearTimeout(timeout);
    }
  });
}

/**
 * 生成私聊/群 @ 普通文本回复。
 */
export async function buildChatReply(
  config: AppConfig,
  queue: LlmQueue,
  messages: MessageForSummary[],
): Promise<string> {
  const prepared = prepareMessages(config, messages).slice(-20);
  if (!isLlmEnabled(config)) {
    const latest = prepared.at(-1)?.content ?? "";
    return `🤖 我已收到：${latest}\n\n当前未配置 \`LLM_API_KEY\`，所以先用模板回复。`;
  }

  const lines = prepared.map((message) => {
    return `[${formatTimeShanghai(message.msgTsMs)}] ${message.senderOpenId}: ${message.content}`;
  });

  const content = await queue.run(async () => {
    const response = await fetch(`${config.llmApiBase}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.llmApiKey}`,
      },
      body: JSON.stringify({
        model: config.llmModel,
        temperature: 0.4,
        messages: [
          {
            role: "system",
            content: "你是飞书智能助手。根据最近上下文回复最后一条用户消息，简洁、准确、可执行。",
          },
          {
            role: "user",
            content: `最近消息：\n${lines.join("\n")}`,
          },
        ],
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`LLM HTTP ${response.status}: ${text.slice(0, 300)}`);
    }
    const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const answer = data.choices?.[0]?.message?.content?.trim();
    if (!answer) throw new Error("LLM 返回空内容");
    return answer;
  });

  return content.startsWith("🤖") ? content : `🤖 ${content}`;
}
