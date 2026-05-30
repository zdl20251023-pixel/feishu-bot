import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Database } from "bun:sqlite";
import type {
  JobStatus,
  MessageForSummary,
  NormalizedMessageEvent,
  ReminderRunRow,
  StoredMessage,
  SummaryRunRow,
  SummaryRunType,
  TaskRow,
  TaskStatus,
} from "./types.ts";

function bind(params: Record<string, unknown>): any {
  return params;
}

/**
 * src2 独立 SQLite 存储。
 *
 * 表关系：
 *
 * ```text
 * messages ──source_message_id──> tasks
 *    │
 *    ├── period query ──────────> summary_runs
 *    └── candidate scan ────────> task-extractor
 *
 * reminder_runs 独立按 chat_id + run_date 防重复提醒。
 * ```
 */
export class Store {
  private readonly db: Database;

  constructor(dbPath: string) {
    if (dbPath !== ":memory:") mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath, { create: true });
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA busy_timeout = 5000;");
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        lark_message_id TEXT NOT NULL UNIQUE,
        lark_event_id TEXT NOT NULL,
        chat_id TEXT NOT NULL,
        chat_type TEXT NOT NULL,
        sender_open_id TEXT NOT NULL,
        message_type TEXT NOT NULL,
        content TEXT NOT NULL,
        raw_json TEXT NOT NULL,
        msg_ts_ms INTEGER NOT NULL,
        mentioned_bot INTEGER NOT NULL DEFAULT 0,
        processed_for_tasks INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_src2_messages_chat_ts ON messages(chat_id, msg_ts_ms);
      CREATE INDEX IF NOT EXISTS idx_src2_messages_task_scan ON messages(processed_for_tasks, msg_ts_ms);

      CREATE TABLE IF NOT EXISTS tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_code TEXT NOT NULL UNIQUE,
        chat_id TEXT NOT NULL,
        source_message_id TEXT NOT NULL,
        title TEXT NOT NULL,
        assignee_open_id TEXT,
        due_at TEXT,
        status TEXT NOT NULL DEFAULT 'candidate',
        confidence REAL NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_src2_tasks_chat_status_due ON tasks(chat_id, status, due_at);

      CREATE TABLE IF NOT EXISTS summary_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_id TEXT NOT NULL,
        run_type TEXT NOT NULL,
        period_start_ms INTEGER NOT NULL,
        period_end_ms INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        content_md TEXT,
        sent_message_id TEXT,
        error TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(chat_id, run_type, period_start_ms, period_end_ms)
      );

      CREATE TABLE IF NOT EXISTS reminder_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_id TEXT NOT NULL,
        run_date TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        sent_message_id TEXT,
        error TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(chat_id, run_date)
      );
    `);
  }

  insertMessage(event: NormalizedMessageEvent, maxStoredTextLen: number): boolean {
    const content =
      event.content.length > maxStoredTextLen
        ? event.content.slice(0, maxStoredTextLen)
        : event.content;
    const info = this.db
      .query(
        `INSERT OR IGNORE INTO messages
          (lark_message_id, lark_event_id, chat_id, chat_type, sender_open_id, message_type,
           content, raw_json, msg_ts_ms, mentioned_bot)
         VALUES
          ($lark_message_id, $lark_event_id, $chat_id, $chat_type, $sender_open_id, $message_type,
           $content, $raw_json, $msg_ts_ms, $mentioned_bot)`,
      )
      .run(bind({
        $lark_message_id: event.messageId,
        $lark_event_id: event.eventId,
        $chat_id: event.chatId,
        $chat_type: event.chatType,
        $sender_open_id: event.senderOpenId,
        $message_type: event.messageType,
        $content: content,
        $raw_json: event.rawJson,
        $msg_ts_ms: event.createTimeMs,
        $mentioned_bot: event.mentionedBot ? 1 : 0,
      }));
    return info.changes > 0;
  }

  listMessages(chatId: string, startMs: number, endMs: number): MessageForSummary[] {
    return this.db
      .query(
        `SELECT lark_message_id AS larkMessageId, chat_id AS chatId, sender_open_id AS senderOpenId,
                content, msg_ts_ms AS msgTsMs
         FROM messages
         WHERE chat_id = $chat_id AND msg_ts_ms >= $start_ms AND msg_ts_ms <= $end_ms
         ORDER BY msg_ts_ms ASC`,
      )
      .all(bind({ $chat_id: chatId, $start_ms: startMs, $end_ms: endMs })) as MessageForSummary[];
  }

  listActiveGroupChatIds(startMs: number, endMs: number): string[] {
    const rows = this.db
      .query(
        `SELECT DISTINCT chat_id AS chatId FROM messages
         WHERE chat_type = 'group' AND msg_ts_ms >= $start_ms AND msg_ts_ms <= $end_ms`,
      )
      .all(bind({ $start_ms: startMs, $end_ms: endMs })) as Array<{ chatId: string }>;
    return rows.map((row) => row.chatId);
  }

  listUnprocessedTaskMessages(limit = 100): StoredMessage[] {
    return this.db
      .query(
        `SELECT id, lark_message_id AS larkMessageId, lark_event_id AS larkEventId,
                chat_id AS chatId, chat_type AS chatType, sender_open_id AS senderOpenId,
                message_type AS messageType, content, raw_json AS rawJson, msg_ts_ms AS msgTsMs,
                mentioned_bot AS mentionedBot, processed_for_tasks AS processedForTasks, created_at AS createdAt
         FROM messages
         WHERE processed_for_tasks = 0 AND chat_type = 'group' AND message_type = 'text'
         ORDER BY msg_ts_ms ASC
         LIMIT $limit`,
      )
      .all(bind({ $limit: limit })) as StoredMessage[];
  }

  markMessageTaskProcessed(larkMessageId: string): void {
    this.db.run(
      `UPDATE messages SET processed_for_tasks = 1 WHERE lark_message_id = $lark_message_id`,
      bind({ $lark_message_id: larkMessageId }),
    );
  }

  claimSummaryRun(
    chatId: string,
    runType: SummaryRunType,
    periodStartMs: number,
    periodEndMs: number,
  ): SummaryRunRow | null {
    this.db.run(
      `INSERT OR IGNORE INTO summary_runs
        (chat_id, run_type, period_start_ms, period_end_ms, status)
       VALUES ($chat_id, $run_type, $period_start_ms, $period_end_ms, 'pending')`,
      bind({
        $chat_id: chatId,
        $run_type: runType,
        $period_start_ms: periodStartMs,
        $period_end_ms: periodEndMs,
      }),
    );
    const row = this.getSummaryRun(chatId, runType, periodStartMs, periodEndMs);
    if (!row || row.status === "sent" || row.status === "running") return null;
    this.updateSummaryRun(row.id!, { status: "running", error: null });
    return { ...row, status: "running" };
  }

  getSummaryRun(
    chatId: string,
    runType: SummaryRunType,
    periodStartMs: number,
    periodEndMs: number,
  ): SummaryRunRow | null {
    const row = this.db
      .query(
        `SELECT id, chat_id AS chatId, run_type AS runType, period_start_ms AS periodStartMs,
                period_end_ms AS periodEndMs, status, content_md AS contentMd,
                sent_message_id AS sentMessageId, error, created_at AS createdAt, updated_at AS updatedAt
         FROM summary_runs
         WHERE chat_id = $chat_id AND run_type = $run_type
           AND period_start_ms = $period_start_ms AND period_end_ms = $period_end_ms`,
      )
      .get(bind({
        $chat_id: chatId,
        $run_type: runType,
        $period_start_ms: periodStartMs,
        $period_end_ms: periodEndMs,
      })) as SummaryRunRow | null;
    return row ?? null;
  }

  updateSummaryRun(id: number, patch: Partial<Pick<SummaryRunRow, "status" | "contentMd" | "sentMessageId" | "error">>): void {
    this.updateById("summary_runs", id, {
      status: patch.status,
      content_md: patch.contentMd,
      sent_message_id: patch.sentMessageId,
      error: patch.error,
    });
  }

  claimReminderRun(chatId: string, runDate: string): ReminderRunRow | null {
    this.db.run(
      `INSERT OR IGNORE INTO reminder_runs (chat_id, run_date, status)
       VALUES ($chat_id, $run_date, 'pending')`,
      bind({ $chat_id: chatId, $run_date: runDate }),
    );
    const row = this.getReminderRun(chatId, runDate);
    if (!row || row.status === "sent" || row.status === "running") return null;
    this.updateReminderRun(row.id!, { status: "running", error: null });
    return { ...row, status: "running" };
  }

  getReminderRun(chatId: string, runDate: string): ReminderRunRow | null {
    const row = this.db
      .query(
        `SELECT id, chat_id AS chatId, run_date AS runDate, status,
                sent_message_id AS sentMessageId, error, created_at AS createdAt, updated_at AS updatedAt
         FROM reminder_runs WHERE chat_id = $chat_id AND run_date = $run_date`,
      )
      .get(bind({ $chat_id: chatId, $run_date: runDate })) as ReminderRunRow | null;
    return row ?? null;
  }

  updateReminderRun(id: number, patch: Partial<Pick<ReminderRunRow, "status" | "sentMessageId" | "error">>): void {
    this.updateById("reminder_runs", id, {
      status: patch.status,
      sent_message_id: patch.sentMessageId,
      error: patch.error,
    });
  }

  createTask(input: Omit<TaskRow, "id" | "taskCode" | "createdAt" | "updatedAt">): TaskRow {
    const taskCode = this.nextTaskCode(input.chatId);
    this.db.run(
      `INSERT INTO tasks
        (task_code, chat_id, source_message_id, title, assignee_open_id, due_at, status, confidence)
       VALUES ($task_code, $chat_id, $source_message_id, $title, $assignee_open_id, $due_at, $status, $confidence)`,
      bind({
        $task_code: taskCode,
        $chat_id: input.chatId,
        $source_message_id: input.sourceMessageId,
        $title: input.title,
        $assignee_open_id: input.assigneeOpenId,
        $due_at: input.dueAt,
        $status: input.status,
        $confidence: input.confidence,
      }),
    );
    const task = this.getTask(taskCode);
    if (!task) throw new Error(`创建任务失败: ${taskCode}`);
    return task;
  }

  getTask(taskCode: string): TaskRow | null {
    const row = this.db
      .query(
        `SELECT id, task_code AS taskCode, chat_id AS chatId, source_message_id AS sourceMessageId,
                title, assignee_open_id AS assigneeOpenId, due_at AS dueAt, status, confidence,
                created_at AS createdAt, updated_at AS updatedAt
         FROM tasks WHERE task_code = $task_code`,
      )
      .get(bind({ $task_code: taskCode.toUpperCase() })) as TaskRow | null;
    return row ?? null;
  }

  listOpenTasks(chatId: string): TaskRow[] {
    return this.db
      .query(
        `SELECT id, task_code AS taskCode, chat_id AS chatId, source_message_id AS sourceMessageId,
                title, assignee_open_id AS assigneeOpenId, due_at AS dueAt, status, confidence,
                created_at AS createdAt, updated_at AS updatedAt
         FROM tasks WHERE chat_id = $chat_id AND status = 'open'
         ORDER BY due_at IS NULL, due_at ASC, created_at ASC`,
      )
      .all(bind({ $chat_id: chatId })) as TaskRow[];
  }

  markTaskDone(taskCode: string): boolean {
    const info = this.db.run(
      `UPDATE tasks SET status = 'done', updated_at = datetime('now') WHERE task_code = $task_code AND status != 'done'`,
      bind({ $task_code: taskCode.toUpperCase() }),
    );
    return info.changes > 0;
  }

  deleteMessagesOlderThan(cutoffMs: number): number {
    const info = this.db.run(`DELETE FROM messages WHERE msg_ts_ms < $cutoff_ms`, bind({
      $cutoff_ms: cutoffMs,
    }));
    return info.changes;
  }

  close(): void {
    this.db.close();
  }

  private nextTaskCode(chatId: string): string {
    const row = this.db
      .query(`SELECT COUNT(*) AS count FROM tasks WHERE chat_id = $chat_id`)
      .get(bind({ $chat_id: chatId })) as { count: number };
    return `T-${String(row.count + 1).padStart(3, "0")}`;
  }

  private updateById(table: "summary_runs" | "reminder_runs", id: number, patch: Record<string, string | null | undefined>): void {
    const fields: string[] = [];
    const params: Record<string, string | number | null> = { $id: id };
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) continue;
      const paramName = `$${key}`;
      fields.push(`${key} = ${paramName}`);
      params[paramName] = value;
    }
    if (fields.length === 0) return;
    fields.push("updated_at = datetime('now')");
    this.db.run(`UPDATE ${table} SET ${fields.join(", ")} WHERE id = $id`, bind(params));
  }
}

export function isOpenStatus(status: TaskStatus): boolean {
  return status === "open";
}

export function isJobTerminal(status: JobStatus): boolean {
  return status === "sent" || status === "failed";
}
