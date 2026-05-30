import type { SummaryRunType } from "./types.ts";

const SHANGHAI_TZ = "Asia/Shanghai";

/**
 * 返回上海时区今天的 YYYY-MM-DD。
 */
export function todayShanghai(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: SHANGHAI_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/**
 * 根据上海业务日生成本地毫秒时间范围。
 *
 * @param dateStr YYYY-MM-DD
 * @param endHour 结束小时，12 表示当天 12:00:00，18 表示 18:00:00
 * @returns 业务时段起止毫秒时间戳
 */
export function getShanghaiPeriodMs(
  dateStr: string,
  endHour: number,
): { startMs: number; endMs: number } {
  const startMs = new Date(`${dateStr}T00:00:00+08:00`).getTime();
  const endMs = new Date(`${dateStr}T${String(endHour).padStart(2, "0")}:00:00+08:00`).getTime();
  return { startMs, endMs };
}

/**
 * 统一定义总结窗口：午报累计到 12:00，晚报累计到 18:00。
 *
 * @param runType 总结类型
 * @param dateStr 上海业务日
 * @returns 用于查询消息与 job 唯一键的时间窗口
 */
export function getSummaryPeriod(
  runType: SummaryRunType,
  dateStr = todayShanghai(),
): { startMs: number; endMs: number } {
  if (runType === "noon") return getShanghaiPeriodMs(dateStr, 12);
  if (runType === "evening") return getShanghaiPeriodMs(dateStr, 18);
  return getShanghaiPeriodMs(dateStr, 18);
}

/**
 * 格式化毫秒时间戳为上海时区 HH:mm。
 */
export function formatTimeShanghai(tsMs: number): string {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: SHANGHAI_TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(tsMs));
}
