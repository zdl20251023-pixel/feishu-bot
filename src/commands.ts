import type { Command } from "./types.ts";

const SUMMARY_RE = /^(总结|summary)$/i;
const TASK_LIST_RE = /^(任务|任务状态|tasks?)$/i;
const HELP_RE = /^(帮助|help)$/i;
const COMPLETE_RE = /^(完成|已处理|done)\s+(T-\d+)$/i;

/**
 * 解析私聊和群 @ 共用的命令。
 *
 * @param content 去掉 mention 后的用户正文
 * @returns 结构化命令；未命中专门命令时返回 chat
 */
export function parseCommand(content: string): Command {
  const raw = content.trim();
  if (SUMMARY_RE.test(raw)) return { kind: "summary", raw };
  if (TASK_LIST_RE.test(raw)) return { kind: "task-list", raw };
  if (HELP_RE.test(raw)) return { kind: "help", raw };

  const completeMatch = raw.match(COMPLETE_RE);
  if (completeMatch) {
    return {
      kind: "complete-task",
      raw,
      taskCode: completeMatch[2]!.toUpperCase(),
    };
  }

  return { kind: "chat", raw };
}

/**
 * 构造帮助文案。
 */
export function buildHelpText(): string {
  return [
    "🤖 可用命令：",
    "- `总结` / `summary`：生成当前会话总结",
    "- `任务` / `任务状态`：查看未完成任务",
    "- `完成 T-001` / `done T-001`：标记任务完成",
    "- `帮助` / `help`：查看本说明",
  ].join("\n");
}
