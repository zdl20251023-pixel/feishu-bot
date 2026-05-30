import { describe, expect, test } from "bun:test";
import { summarizeWithTemplate } from "../../src/summarizer.ts";
import type { MessageForSummary } from "../../src/types.ts";
import fixture from "../fixtures/day-messages.json";

/**
 * 轻量 Eval：结构 + 不编造 fixture 外的人名。
 */
describe("summary eval", () => {
  test("输出结构且仅引用 fixture 内发送人", () => {
    const messages = fixture as MessageForSummary[];
    const out = summarizeWithTemplate(messages, "2024-05-19");

    expect(out).toMatch(/## 今日要点/);
    expect(out).toMatch(/## 未决/);
    expect(out).toMatch(/## 需关注/);

    const allowed = new Set(messages.map((m) => m.sender_name));
    expect(allowed.has("张三")).toBe(true);
    // 不应出现 fixture 未提及的虚构角色
    expect(out).not.toContain("赵六");
    expect(out).not.toContain("虚构经理");
  });
});
