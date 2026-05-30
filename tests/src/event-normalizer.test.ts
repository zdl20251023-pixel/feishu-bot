import { describe, expect, test } from "bun:test";
import { loadConfig } from "../../src2/config.ts";
import { normalizeEventLine } from "../../src2/event-normalizer.ts";

describe("src2 event-normalizer", () => {
  const config = loadConfig({
    LOG_LEVEL: "error",
    LARK_BOT_OPEN_ID: "ou_bot",
  });

  test("归一化合法文本事件并保留 raw_json", () => {
    const line = JSON.stringify({
      event_id: "evt_1",
      message_id: "om_1",
      chat_id: "oc_1",
      chat_type: "group",
      sender_id: "ou_user",
      message_type: "text",
      content: { text: "总结" },
      create_time: "1717044000000",
      mentioned_bot: true,
    });

    const result = normalizeEventLine(line, config);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.reason);
    expect(result.event.content).toBe("总结");
    expect(result.event.mentionedBot).toBe(true);
    expect(result.event.rawJson).toContain("evt_1");
  });

  test("坏 JSON 不抛出", () => {
    const result = normalizeEventLine("{bad", config);
    expect(result.ok).toBe(false);
  });

  test("识别 bot 自身消息", () => {
    const result = normalizeEventLine(
      JSON.stringify({
        event_id: "evt_2",
        message_id: "om_2",
        chat_id: "oc_1",
        chat_type: "group",
        sender_id: "ou_bot",
        message_type: "text",
        content: "机器人消息",
      }),
      config,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.reason);
    expect(result.event.isFromBot).toBe(true);
  });

  test("通过 lark-cli 文本里的 @ 显示名识别机器人", () => {
    const aliasConfig = loadConfig({
      LOG_LEVEL: "error",
      LARK_BOT_MENTION_NAMES: "zdltest01",
    });
    const result = normalizeEventLine(
      JSON.stringify({
        event_id: "evt_3",
        message_id: "om_3",
        chat_id: "oc_1",
        chat_type: "group",
        sender_id: "ou_user",
        message_type: "text",
        content: "@zdltest01 帮助",
      }),
      aliasConfig,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.reason);
    expect(result.event.mentionedBot).toBe(true);
  });

  test("群消息 @all 在无 mentions 时也能触发机器人", () => {
    const result = normalizeEventLine(
      JSON.stringify({
        event_id: "evt_4",
        message_id: "om_4",
        chat_id: "oc_1",
        chat_type: "group",
        sender_id: "ou_user",
        message_type: "text",
        content: "@_all   88",
      }),
      loadConfig({ LOG_LEVEL: "error" }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.reason);
    expect(result.event.mentionedBot).toBe(true);
  });

  test("群消息同时 @ 两个机器人显示名也能触发", () => {
    const result = normalizeEventLine(
      JSON.stringify({
        event_id: "evt_7",
        message_id: "om_7",
        chat_id: "oc_1",
        chat_type: "group",
        sender_id: "ou_user",
        message_type: "text",
        content: "@zdl的飞书 CLI  @zdltest01 66",
      }),
      loadConfig({ LOG_LEVEL: "error", LARK_BOT_MENTION_NAMES: "zdltest01" }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.reason);
    expect(result.event.mentionedBot).toBe(true);
  });

  test("群消息 @其他人 不会在无 mentions 时误触发机器人", () => {
    const result = normalizeEventLine(
      JSON.stringify({
        event_id: "evt_6",
        message_id: "om_6",
        chat_id: "oc_1",
        chat_type: "group",
        sender_id: "ou_user",
        message_type: "text",
        content: "@张三   88",
      }),
      loadConfig({ LOG_LEVEL: "error" }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.reason);
    expect(result.event.mentionedBot).toBe(false);
  });

  test("嵌套 mentions.id.open_id 能识别机器人", () => {
    const result = normalizeEventLine(
      JSON.stringify({
        event_id: "evt_5",
        message_id: "om_5",
        chat_id: "oc_1",
        chat_type: "group",
        sender_id: "ou_user",
        message_type: "text",
        content: "@_user_1 帮助",
        event: {
          message: {
            mentions: [{ id: { open_id: "ou_bot" }, name: "zdltest01" }],
          },
        },
      }),
      loadConfig({ LOG_LEVEL: "error", LARK_BOT_OPEN_ID: "ou_bot" }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.reason);
    expect(result.event.mentionedBot).toBe(true);
  });
});
