import { loadConfig } from "./config.ts";
import { normalizeEventLine } from "./event-normalizer.ts";
import { createLarkClient } from "./lark-client.ts";
import { LlmQueue } from "./llm-queue.ts";
import { createLogger } from "./logger.ts";
import { routeMessage } from "./message-router.ts";
import { PerChatQueue } from "./per-chat-queue.ts";
import { startScheduler } from "./scheduler.ts";
import { Store } from "./store.ts";

/**
 * src2 飞书机器人主入口。
 *
 * 设计边界：
 * - src2 与 src/ 企微机器人完全独立，不 import 旧目录模块；
 * - 飞书凭证由 lark-cli 管理，本进程只负责编排事件、存储、LLM 与调度；
 * - 事件消费、路由、SQLite、调度均在 src2 内部模块完成。
 */
async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config.logLevel);
  const store = new Store(config.dbPath);
  const lark = createLarkClient(config, logger);
  const llmQueue = new LlmQueue(config.llmConcurrency);
  const chatQueue = new PerChatQueue();
  const scheduler = startScheduler(config, store, lark, llmQueue, logger);

  logger.info("飞书智能机器人启动", {
    eventKey: config.eventKey,
    dbPath: config.dbPath,
    targetChatId: config.targetChatId || "(all visible chats)",
    denyChatCount: config.denyChatIds.size,
    pausedChatCount: config.pausedChatIds.size,
    botOpenIdConfigured: Boolean(config.botOpenId),
    botMentionNames: config.botMentionNames,
    llmEnabled: Boolean(config.llmApiKey),
    llmConcurrency: config.llmConcurrency,
  });

  const stopConsumer = lark.consumeEvents((line) => {
    const normalized = normalizeEventLine(line, config);
    if (!normalized.ok) {
      logger.warn("飞书事件解析失败", {
        reason: normalized.reason,
        rawPreview: normalized.rawJson.slice(0, 300),
      });
      return;
    }

    chatQueue.enqueue(normalized.event.chatId, async () => {
      try {
        await routeMessage(
          { config, store, lark, queue: llmQueue, logger },
          normalized.event,
        );
      } catch (error) {
        logger.error("飞书消息处理失败", error);
      }
    });
  });

  function shutdown(signal: NodeJS.Signals): void {
    logger.info(`收到 ${signal}，正在关闭飞书机器人`);
    stopConsumer();
    scheduler.stop();
    store.close();
  }

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error) => {
  console.error("[FATAL] 飞书智能机器人启动失败", error);
  process.exitCode = 1;
});
