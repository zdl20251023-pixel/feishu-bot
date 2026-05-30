import { z } from "zod";
import type { AppConfig } from "./config.ts";
import { isLlmEnabled } from "./config.ts";
import type { LlmQueue } from "./llm-queue.ts";
import type { StoredMessage, TaskRow, TaskStatus } from "./types.ts";

const TASK_KEYWORDS = /(安排|负责|截止|TODO|todo|跟进|完成|处理|推进|deadline)/i;
const taskOutputSchema = z.object({
  title: z.string().min(1),
  assigneeOpenId: z.string().nullable().optional(),
  dueAt: z.string().nullable().optional(),
  confidence: z.number().min(0).max(1),
});

export type ExtractedTask = {
  title: string;
  assigneeOpenId: string | null;
  dueAt: string | null;
  status: TaskStatus;
  confidence: number;
};

export type TaskExtractorStore = {
  createTask(input: Omit<TaskRow, "id" | "taskCode" | "createdAt" | "updatedAt">): TaskRow;
  markMessageTaskProcessed(larkMessageId: string): void;
};

/**
 * 规则候选筛选。只有像任务的消息才进入 LLM，避免所有闲聊都消耗 token。
 */
export function isTaskCandidate(content: string): boolean {
  return TASK_KEYWORDS.test(content);
}

/**
 * 从单条群消息中抽取任务。
 *
 * @param config 应用配置
 * @param queue LLM 并发队列
 * @param message 已入库的群消息
 * @returns 抽取结果；非候选或解析失败时返回 null
 */
export async function extractTaskFromMessage(
  config: AppConfig,
  queue: LlmQueue,
  message: StoredMessage,
): Promise<ExtractedTask | null> {
  if (!isTaskCandidate(message.content)) return null;

  if (!isLlmEnabled(config)) {
    return {
      title: message.content.slice(0, 120),
      assigneeOpenId: null,
      dueAt: null,
      status: "candidate",
      confidence: 0.5,
    };
  }

  return queue.run(async () => {
    const response = await fetch(`${config.llmApiBase}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.llmApiKey}`,
      },
      body: JSON.stringify({
        model: config.llmModel,
        temperature: 0.1,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "你是任务抽取器。只输出 JSON：title, assigneeOpenId, dueAt, confidence。不要根据消息外的信息猜测。confidence 低于 0.75 表示只作为候选。",
          },
          {
            role: "user",
            content: `消息发送人：${message.senderOpenId}\n消息内容：${message.content}`,
          },
        ],
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`LLM HTTP ${response.status}: ${text.slice(0, 300)}`);
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content) return null;

    const parsed = taskOutputSchema.safeParse(JSON.parse(content));
    if (!parsed.success) return null;

    return {
      title: parsed.data.title,
      assigneeOpenId: parsed.data.assigneeOpenId ?? null,
      dueAt: parsed.data.dueAt ?? null,
      confidence: parsed.data.confidence,
      status: parsed.data.confidence >= 0.75 ? "open" : "candidate",
    };
  });
}

/**
 * 扫描未处理消息并创建任务。
 */
export async function processTaskCandidates(
  config: AppConfig,
  queue: LlmQueue,
  store: TaskExtractorStore & { listUnprocessedTaskMessages(limit?: number): StoredMessage[] },
): Promise<number> {
  let created = 0;
  const messages = store.listUnprocessedTaskMessages(100);
  for (const message of messages) {
    try {
      const task = await extractTaskFromMessage(config, queue, message);
      if (task) {
        store.createTask({
          chatId: message.chatId,
          sourceMessageId: message.larkMessageId,
          title: task.title,
          assigneeOpenId: task.assigneeOpenId,
          dueAt: task.dueAt,
          status: task.status,
          confidence: task.confidence,
        });
        created += 1;
      }
    } finally {
      store.markMessageTaskProcessed(message.larkMessageId);
    }
  }
  return created;
}
