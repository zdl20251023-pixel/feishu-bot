export type LogLevel = "debug" | "info" | "warn" | "error";

export type ChatType = "p2p" | "group" | string;

export type MessageType = "text" | string;

export type SummaryRunType = "noon" | "evening" | "manual";

export type JobStatus = "pending" | "running" | "sent" | "failed";

export type TaskStatus = "candidate" | "open" | "done";

export type Command =
  | { kind: "summary"; raw: string }
  | { kind: "task-list"; raw: string }
  | { kind: "help"; raw: string }
  | { kind: "complete-task"; raw: string; taskCode: string }
  | { kind: "chat"; raw: string };

export type NormalizedMessageEvent = {
  eventId: string;
  messageId: string;
  chatId: string;
  chatType: ChatType;
  senderOpenId: string;
  messageType: MessageType;
  content: string;
  createTimeMs: number;
  mentionedBot: boolean;
  isFromBot: boolean;
  rawJson: string;
};

export type StoredMessage = {
  id?: number;
  larkMessageId: string;
  larkEventId: string;
  chatId: string;
  chatType: ChatType;
  senderOpenId: string;
  messageType: MessageType;
  content: string;
  rawJson: string;
  msgTsMs: number;
  mentionedBot: boolean;
  processedForTasks: boolean;
  createdAt?: string;
};

export type MessageForSummary = {
  larkMessageId: string;
  chatId: string;
  senderOpenId: string;
  content: string;
  msgTsMs: number;
};

export type TaskRow = {
  id?: number;
  taskCode: string;
  chatId: string;
  sourceMessageId: string;
  title: string;
  assigneeOpenId: string | null;
  dueAt: string | null;
  status: TaskStatus;
  confidence: number;
  createdAt?: string;
  updatedAt?: string;
};

export type SummaryRunRow = {
  id?: number;
  chatId: string;
  runType: SummaryRunType;
  periodStartMs: number;
  periodEndMs: number;
  status: JobStatus;
  contentMd: string | null;
  sentMessageId: string | null;
  error: string | null;
  createdAt?: string;
  updatedAt?: string;
};

export type ReminderRunRow = {
  id?: number;
  chatId: string;
  runDate: string;
  status: JobStatus;
  sentMessageId: string | null;
  error: string | null;
  createdAt?: string;
  updatedAt?: string;
};
