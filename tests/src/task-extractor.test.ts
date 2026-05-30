import { describe, expect, test } from "bun:test";
import { loadConfig } from "../../src2/config.ts";
import { LlmQueue } from "../../src2/llm-queue.ts";
import { extractTaskFromMessage, isTaskCandidate } from "../../src2/task-extractor.ts";
import type { StoredMessage } from "../../src2/types.ts";

const message: StoredMessage = {
  larkMessageId: "om_1",
  larkEventId: "evt_1",
  chatId: "oc_1",
  chatType: "group",
  senderOpenId: "ou_1",
  messageType: "text",
  content: "安排张三今天跟进需求文档",
  rawJson: "{}",
  msgTsMs: Date.now(),
  mentionedBot: false,
  processedForTasks: false,
};

describe("src2 task-extractor", () => {
  test("规则候选能识别任务关键词", () => {
    expect(isTaskCandidate("安排张三跟进")).toBe(true);
    expect(isTaskCandidate("今天天气不错")).toBe(false);
  });

  test("无 LLM 时生成 candidate，不直接 open", async () => {
    const config = loadConfig({ LOG_LEVEL: "error", LLM_API_KEY: "" });
    const task = await extractTaskFromMessage(config, new LlmQueue(1), message);
    expect(task?.status).toBe("candidate");
    expect(task?.confidence).toBeLessThan(0.75);
  });
});
