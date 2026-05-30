import type { LogLevel } from "./types.ts";

const LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export type Logger = ReturnType<typeof createLogger>;

/**
 * 截断日志字段，避免 info 日志长期落盘完整聊天内容。
 *
 * @param value 原始字符串
 * @param maxLength 最大保留长度
 * @returns 截断后的安全展示文本
 */
export function truncateForLog(value: string, maxLength = 160): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}…`;
}

/**
 * 创建 src2 独立日志器。
 *
 * @param minLevel 最低输出级别
 * @returns debug/info/warn/error 四个日志函数
 */
export function createLogger(minLevel: LogLevel) {
  function log(level: LogLevel, message: string, extra?: unknown): void {
    if (LEVELS[level] < LEVELS[minLevel]) return;
    const line = `[${new Date().toISOString()}] [${level.toUpperCase()}] ${message}`;
    const writer = console[level === "debug" ? "log" : level];
    if (extra === undefined) {
      writer(line);
      return;
    }
    writer(line, extra);
  }

  return {
    debug: (message: string, extra?: unknown) => log("debug", message, extra),
    info: (message: string, extra?: unknown) => log("info", message, extra),
    warn: (message: string, extra?: unknown) => log("warn", message, extra),
    error: (message: string, extra?: unknown) => log("error", message, extra),
  };
}
