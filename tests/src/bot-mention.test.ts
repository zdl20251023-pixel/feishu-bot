import { describe, expect, test } from "bun:test";
import {
  hasAllMentionInContent,
  hasConfiguredBotMention,
  stripConfiguredBotMentions,
} from "../../src2/bot-mention.ts";

describe("src2 bot-mention", () => {
  test("全文任意位置识别机器人显示名", () => {
    expect(hasConfiguredBotMention("@zdl的飞书 CLI  @zdltest01 66", ["zdltest01"])).toBe(true);
    expect(hasConfiguredBotMention("@zdl的飞书 CLI  @zdltest01 66", ["zdl的飞书 CLI"])).toBe(true);
    expect(hasConfiguredBotMention("@张三 你好", ["zdltest01"])).toBe(false);
  });

  test("剥掉多个机器人 @ 名后保留正文", () => {
    expect(stripConfiguredBotMentions("@zdl的飞书 CLI  @zdltest01 66", ["zdltest01", "zdl的飞书 CLI"])).toBe("66");
  });

  test("识别 @all", () => {
    expect(hasAllMentionInContent("@_all 55")).toBe(true);
  });
});
