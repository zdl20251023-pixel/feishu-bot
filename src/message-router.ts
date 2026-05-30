import type { AppConfig } from "./config.ts";
import { stripConfiguredBotMentions } from "./bot-mention.ts";
import { buildHelpText, parseCommand } from "./commands.ts";
import type { LarkClient } from "./lark-client.ts";
import type { LlmQueue } from "./llm-queue.ts";
import type { Logger } from "./logger.ts";
import { truncateForLog } from "./logger.ts";
import { buildChatReply } from "./summarizer.ts";
import { runSummaryForChat } from "./scheduler.ts";
import type { Store } from "./store.ts";
import { processTaskCandidates } from "./task-extractor.ts";
import type { NormalizedMessageEvent } from "./types.ts";
import { getSummaryPeriod, todayShanghai } from "./time.ts";

export type RouterDeps = {
  config: AppConfig;
  store: Store;
  lark: LarkClient;
  queue: LlmQueue;
  logger: Logger;
};

/**
 * 记录收到消息时的安全日志。
 */
function logReceivedMessage(logger: Logger, event: NormalizedMessageEvent): void {
  logger.info("收到飞书消息", {
    eventId: event.eventId,
    messageId: event.messageId,
    chatId: event.chatId,
    chatType: event.chatType,
    senderOpenId: event.senderOpenId,
    messageType: event.messageType,
    mentionedBot: event.mentionedBot,
    isFromBot: event.isFromBot,
    contentPreview: truncateForLog(event.content),
  });
}

function shouldIgnoreEvent(config: AppConfig, event: NormalizedMessageEvent): boolean {
  if (event.isFromBot) return true;
  if (event.chatType !== "group" && event.chatType !== "p2p") return true;
  if (event.messageType !== "text") return true;
  if (!event.content.trim()) return true;
  if (config.targetChatId && event.chatId !== config.targetChatId) return true;
  if (config.denyChatIds.has(event.chatId)) return true;
  return false;
}

async function reply(lark: LarkClient, event: NormalizedMessageEvent, markdown: string, suffix: string): Promise<void> {
  await lark.replyMessage({
    messageId: event.messageId,
    markdown,
    idempotencyKey: `${event.eventId}-${suffix}`,
  });
}

/**
 * 处理一条已归一化的飞书消息。
 *
 * 流程：
 * 1. 先做范围、自身消息、文本类型过滤；
 * 2. 先入库，保证后续总结/任务可以基于持久化数据；
 * 3. 私聊和群 @ 走命令/LLM 回复；
 * 4. 群未 @ 静默入库，并触发任务候选抽取。
 */
export async function routeMessage(deps: RouterDeps, event: NormalizedMessageEvent): Promise<void> {
  const { config, store, lark, queue, logger } = deps;
  if (shouldIgnoreEvent(config, event)) return;

  logReceivedMessage(logger, event);
  store.insertMessage(event, config.maxStoredTextLen);

  if (config.pausedChatIds.has(event.chatId)) {
    logger.info("群已暂停自动处理，仅保留消息", { chatId: event.chatId });
    return;
  }

  if (event.chatType === "group") {
    await processTaskCandidates(config, queue, store);
    if (!event.mentionedBot) {
      logger.debug("群消息未识别为 @ 机器人，仅入库", {
        chatId: event.chatId,
        contentPreview: truncateForLog(event.content),
      });
      return;
    }
  }

  const commandContent =
    event.chatType === "group" ? stripConfiguredBotMentions(event.content, config.botMentionNames) : event.content;
  const command = parseCommand(commandContent);
  if (command.kind === "help") {
    await reply(lark, event, buildHelpText(), "help");
    logger.info("已回复飞书消息", { chatId: event.chatId, kind: "help", messageId: event.messageId });
    return;
  }

  if (command.kind === "task-list") {
    const tasks = store.listOpenTasks(event.chatId);
    const markdown =
      tasks.length === 0
        ? "当前没有未完成任务。"
        : ["## 未完成任务", ...tasks.map((task) => `- **${task.taskCode}** ${task.title}`)].join("\n");
    await reply(lark, event, markdown, "tasks");
    logger.info("已回复飞书消息", { chatId: event.chatId, kind: "task-list", messageId: event.messageId });
    return;
  }

  if (command.kind === "complete-task") {
    const changed = store.markTaskDone(command.taskCode);
    await reply(lark, event, changed ? `已标记完成：${command.taskCode}` : `未找到未完成任务：${command.taskCode}`, "complete-task");
    logger.info("已回复飞书消息", { chatId: event.chatId, kind: "complete-task", messageId: event.messageId });
    return;
  }

  if (command.kind === "summary") {
    const dateStr = todayShanghai();
    const period = getSummaryPeriod("manual", dateStr);
    const messages = store.listMessages(event.chatId, period.startMs, period.endMs);
    const { buildSummary } = await import("./summarizer.ts");
    const markdown = await buildSummary(config, queue, messages, "manual");
    await reply(lark, event, markdown, "manual-summary");
    logger.info("已回复飞书消息", { chatId: event.chatId, kind: "summary", messageId: event.messageId });
    return;
  }

  const dateStr = todayShanghai();
  const period = getSummaryPeriod("manual", dateStr);
  const contextMessages = store.listMessages(event.chatId, period.startMs, period.endMs);
  const answer = await buildChatReply(config, queue, contextMessages);
  await reply(lark, event, answer, "chat");
  logger.info("已回复飞书消息", { chatId: event.chatId, kind: "chat", messageId: event.messageId });
}

/**
 * 手动给某个群补跑定时总结，供 CLI 或未来调试命令复用。
 */
export function runScheduledSummary(deps: RouterDeps, chatId: string, runType: "noon" | "evening"): Promise<void> {
  return runSummaryForChat(deps.config, deps.store, deps.lark, deps.queue, deps.logger, chatId, runType);
}
