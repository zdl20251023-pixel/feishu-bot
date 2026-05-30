import { Cron } from "croner";
import type { AppConfig } from "./config.ts";
import type { LarkClient } from "./lark-client.ts";
import type { LlmQueue } from "./llm-queue.ts";
import type { Logger } from "./logger.ts";
import { buildSummary } from "./summarizer.ts";
import type { Store } from "./store.ts";
import type { SummaryRunType } from "./types.ts";
import { getSummaryPeriod, todayShanghai } from "./time.ts";
import { runTaskReminderForChat } from "./task-reminder.ts";

export type SchedulerHandles = {
  stop(): void;
};

/**
 * 运行单个群的总结作业。
 */
export async function runSummaryForChat(
  config: AppConfig,
  store: Store,
  lark: LarkClient,
  queue: LlmQueue,
  logger: Logger,
  chatId: string,
  runType: SummaryRunType,
  dateStr = todayShanghai(),
): Promise<void> {
  const period = getSummaryPeriod(runType, dateStr);
  const run = store.claimSummaryRun(chatId, runType, period.startMs, period.endMs);
  if (!run) {
    logger.info("总结作业已发送或正在运行，跳过", { chatId, runType, dateStr });
    return;
  }

  try {
    const messages = store.listMessages(chatId, period.startMs, period.endMs);
    if (messages.length === 0) {
      store.updateSummaryRun(run.id!, { status: "sent", contentMd: "今日无有效群消息。", sentMessageId: "" });
      return;
    }
    const markdown = await buildSummary(config, queue, messages, runType);
    const output = await lark.sendMessage({
      chatId,
      markdown,
      idempotencyKey: `${chatId}-${runType}-${period.startMs}-${period.endMs}`,
    });
    store.updateSummaryRun(run.id!, { status: "sent", contentMd: markdown, sentMessageId: output });
    logger.info("已发送群总结", { chatId, runType, dateStr, messageCount: messages.length });
  } catch (error) {
    store.updateSummaryRun(run.id!, {
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * 注册 10:00 任务提醒、12:00 午报、18:00 晚报。
 */
export function startScheduler(
  config: AppConfig,
  store: Store,
  lark: LarkClient,
  queue: LlmQueue,
  logger: Logger,
): SchedulerHandles {
  const runAllSummaries = (runType: SummaryRunType) => {
    const dateStr = todayShanghai();
    const period = getSummaryPeriod(runType, dateStr);
    const chatIds = store.listActiveGroupChatIds(period.startMs, period.endMs);
    for (const chatId of chatIds) {
      if (config.denyChatIds.has(chatId) || config.pausedChatIds.has(chatId)) continue;
      void runSummaryForChat(config, store, lark, queue, logger, chatId, runType, dateStr).catch((error) => {
        logger.error("总结作业失败", error);
      });
    }
  };

  const runAllReminders = () => {
    const dateStr = todayShanghai();
    const period = getSummaryPeriod("evening", dateStr);
    const chatIds = store.listActiveGroupChatIds(period.startMs, period.endMs);
    for (const chatId of chatIds) {
      if (config.denyChatIds.has(chatId) || config.pausedChatIds.has(chatId)) continue;
      void runTaskReminderForChat(store, lark, logger, chatId, dateStr).catch((error) => {
        logger.error("任务提醒失败", error);
      });
    }
  };

  const reminder = new Cron("0 10 * * 1-5", { timezone: config.cronTz }, runAllReminders);
  const noon = new Cron("0 12 * * 1-5", { timezone: config.cronTz }, () => runAllSummaries("noon"));
  const evening = new Cron("0 18 * * 1-5", { timezone: config.cronTz }, () => runAllSummaries("evening"));

  logger.info("src2 定时任务已注册", {
    reminder: "0 10 * * 1-5",
    noon: "0 12 * * 1-5",
    evening: "0 18 * * 1-5",
    tz: config.cronTz,
  });

  return {
    stop() {
      reminder.stop();
      noon.stop();
      evening.stop();
    },
  };
}
