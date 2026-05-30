import { describe, expect, test } from "bun:test";
import { loadConfig } from "../../src2/config.ts";
import type { LarkClient } from "../../src2/lark-client.ts";
import { LlmQueue } from "../../src2/llm-queue.ts";
import { createLogger } from "../../src2/logger.ts";
import { routeMessage } from "../../src2/message-router.ts";
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
    content: "hello",
    createTimeMs: new Date("2026-05-30T10:00:00+08:00").getTime(),
    mentionedBot: false,
    isFromBot: false,
    rawJson: "{}",
    ...patch,
  };
}

function fakeLark(replies: string[]): LarkClient {
  return {
    consumeEvents: () => () => {},
    async replyMessage(input) {
      replies.push(input.markdown);
      return "reply_id";
    },
    async sendMessage(input) {
      replies.push(input.markdown);
      return "send_id";
    },
  };
}

describe("src2 message-router", () => {
  test("群未 @ 消息只入库不回复", async () => {
    const store = new Store(":memory:");
    const replies: string[] = [];
    const config = loadConfig({ LOG_LEVEL: "error", LLM_API_KEY: "" });
    await routeMessage(
      { config, store, lark: fakeLark(replies), queue: new LlmQueue(1), logger: createLogger("error") },
      makeEvent({ content: "普通群消息" }),
    );
    expect(replies.length).toBe(0);
    expect(store.listMessages("oc_1", 0, Date.now() + 10_000).length).toBe(1);
    store.close();
  });

  test("私聊帮助命令会回复帮助", async () => {
    const store = new Store(":memory:");
    const replies: string[] = [];
    const config = loadConfig({ LOG_LEVEL: "error", LLM_API_KEY: "" });
    await routeMessage(
      { config, store, lark: fakeLark(replies), queue: new LlmQueue(1), logger: createLogger("error") },
      makeEvent({ chatType: "p2p", content: "帮助" }),
    );
    expect(replies[0]).toContain("可用命令");
    store.close();
  });

  test("bot 自身消息会被忽略", async () => {
    const store = new Store(":memory:");
    const replies: string[] = [];
    const config = loadConfig({ LOG_LEVEL: "error", LARK_BOT_OPEN_ID: "ou_bot" });
    await routeMessage(
      { config, store, lark: fakeLark(replies), queue: new LlmQueue(1), logger: createLogger("error") },
      makeEvent({ senderOpenId: "ou_bot", isFromBot: true }),
    );
    expect(replies.length).toBe(0);
    expect(store.listMessages("oc_1", 0, Date.now() + 10_000).length).toBe(0);
    store.close();
  });

  test("群 @ 显示名命令会剥掉 mention 前缀后回复", async () => {
    const store = new Store(":memory:");
    const replies: string[] = [];
    const config = loadConfig({ LOG_LEVEL: "error", LLM_API_KEY: "", LARK_BOT_MENTION_NAMES: "zdltest01" });
    await routeMessage(
      { config, store, lark: fakeLark(replies), queue: new LlmQueue(1), logger: createLogger("error") },
      makeEvent({ content: "@zdltest01 帮助", mentionedBot: true }),
    );
    expect(replies[0]).toContain("可用命令");
    store.close();
  });

  test("群同时 @ 两个机器人名会回复普通聊天", async () => {
    const store = new Store(":memory:");
    const replies: string[] = [];
    const config = loadConfig({
      LOG_LEVEL: "error",
      LLM_API_KEY: "",
      LARK_BOT_MENTION_NAMES: "zdltest01,zdl的飞书 CLI",
    });
    await routeMessage(
      { config, store, lark: fakeLark(replies), queue: new LlmQueue(1), logger: createLogger("error") },
      makeEvent({ content: "@zdl的飞书 CLI  @zdltest01 66", mentionedBot: true }),
    );
    expect(replies[0]).toContain("66");
    store.close();
  });

  test("群 @all 无配置显示名时也能剥掉前缀", async () => {
    const store = new Store(":memory:");
    const replies: string[] = [];
    const config = loadConfig({ LOG_LEVEL: "error", LLM_API_KEY: "" });
    await routeMessage(
      { config, store, lark: fakeLark(replies), queue: new LlmQueue(1), logger: createLogger("error") },
      makeEvent({ content: "@_all   帮助", mentionedBot: true }),
    );
    expect(replies[0]).toContain("可用命令");
    store.close();
  });
});
