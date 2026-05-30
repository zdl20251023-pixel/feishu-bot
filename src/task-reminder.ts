import type { LarkClient } from "./lark-client.ts";
import type { Logger } from "./logger.ts";
import type { Store } from "./store.ts";
import type { TaskRow } from "./types.ts";
import { todayShanghai } from "./time.ts";

function formatTasks(tasks: TaskRow[]): string {
  if (tasks.length === 0) return "今日暂无未完成任务。";
  return [
    "## 未完成任务提醒",
    "",
    ...tasks.map((task) => {
      const assignee = task.assigneeOpenId ? `负责人：${task.assigneeOpenId}` : "负责人：未指定";
      const due = task.dueAt ? `截止：${task.dueAt}` : "截止：未指定";
      return `- **${task.taskCode}** ${task.title}（${assignee}，${due}）`;
    }),
    "",
    "完成后可回复：`完成 T-001`",
  ].join("\n");
}

/**
 * 对单个群发送 10:00 未完成任务提醒。
 */
export async function runTaskReminderForChat(
  store: Store,
  lark: LarkClient,
  logger: Logger,
  chatId: string,
  runDate = todayShanghai(),
): Promise<void> {
  const run = store.claimReminderRun(chatId, runDate);
  if (!run) {
    logger.info("任务提醒已发送或正在运行，跳过", { chatId, runDate });
    return;
  }

  try {
    const tasks = store.listOpenTasks(chatId);
    if (tasks.length === 0) {
      store.updateReminderRun(run.id!, { status: "sent", sentMessageId: "" });
      return;
    }
    const markdown = formatTasks(tasks);
    const output = await lark.sendMessage({
      chatId,
      markdown,
      idempotencyKey: `${chatId}-${runDate}-task-reminder`,
    });
    store.updateReminderRun(run.id!, { status: "sent", sentMessageId: output });
    logger.info("已发送任务提醒", { chatId, runDate, count: tasks.length });
  } catch (error) {
    store.updateReminderRun(run.id!, {
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
