import { describe, expect, test } from "bun:test";
import { Store } from "../../src2/store.ts";
import type { NormalizedMessageEvent } from "../../src2/types.ts";

function makeEvent(patch: Partial<NormalizedMessageEvent> = {}): NormalizedMessageEvent {
  return {
    eventId: "evt_1",
    messageId: "om_1",
    chatId: "oc_1",
    chatType: "group",
    senderOpenId: "ou_1",
    messageType: "text",
    content: "安排张三今天跟进需求",
    createTimeMs: new Date("2026-05-30T10:00:00+08:00").getTime(),
    mentionedBot: false,
    isFromBot: false,
    rawJson: "{}",
    ...patch,
  };
}

describe("src2 Store", () => {
  test("消息按 lark_message_id 去重", () => {
    const store = new Store(":memory:");
    expect(store.insertMessage(makeEvent(), 8000)).toBe(true);
    expect(store.insertMessage(makeEvent(), 8000)).toBe(false);
    store.close();
  });

  test("summary run 使用唯一键防重复 claim", () => {
    const store = new Store(":memory:");
    const first = store.claimSummaryRun("oc_1", "noon", 1, 2);
    const second = store.claimSummaryRun("oc_1", "noon", 1, 2);
    expect(first?.status).toBe("running");
    expect(second).toBeNull();
    store.close();
  });

  test("任务状态可从 open 标记为 done", () => {
    const store = new Store(":memory:");
    const task = store.createTask({
      chatId: "oc_1",
      sourceMessageId: "om_1",
      title: "跟进需求",
      assigneeOpenId: null,
      dueAt: null,
      status: "open",
      confidence: 0.9,
    });
    expect(store.listOpenTasks("oc_1").length).toBe(1);
    expect(store.markTaskDone(task.taskCode)).toBe(true);
    expect(store.listOpenTasks("oc_1").length).toBe(0);
    store.close();
  });
});
