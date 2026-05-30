import { describe, expect, test } from "bun:test";
import { parseCommand } from "../../src2/commands.ts";

describe("src2 commands", () => {
  test("解析总结和帮助命令", () => {
    expect(parseCommand("总结").kind).toBe("summary");
    expect(parseCommand("summary").kind).toBe("summary");
    expect(parseCommand("帮助").kind).toBe("help");
    expect(parseCommand("help").kind).toBe("help");
  });

  test("解析任务查询与完成命令", () => {
    expect(parseCommand("任务状态").kind).toBe("task-list");
    expect(parseCommand("done T-001")).toEqual({
      kind: "complete-task",
      raw: "done T-001",
      taskCode: "T-001",
    });
  });

  test("未知文本走普通聊天", () => {
    expect(parseCommand("帮我看看这个方案").kind).toBe("chat");
  });
});
