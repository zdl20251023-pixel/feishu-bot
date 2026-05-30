import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { AppConfig } from "./config.ts";
import type { Logger } from "./logger.ts";

export type LarkClient = {
  consumeEvents(onLine: (line: string) => void): () => void;
  replyMessage(input: { messageId: string; markdown: string; idempotencyKey: string }): Promise<string>;
  sendMessage(input: { chatId: string; markdown: string; idempotencyKey: string }): Promise<string>;
};

/**
 * 集中封装 lark-cli。
 *
 * 这样 router/scheduler/task 模块只表达业务意图，不直接拼 CLI 参数。
 */
export function createLarkClient(config: AppConfig, logger: Logger): LarkClient {
  return {
    consumeEvents(onLine) {
      return startEventConsumer(config, logger, onLine);
    },
    replyMessage(input) {
      const args = [
        "im",
        "+messages-reply",
        "--as",
        "bot",
        "--message-id",
        input.messageId,
        "--markdown",
        input.markdown,
        "--idempotency-key",
        input.idempotencyKey,
      ];
      if (config.replyInThread) args.push("--reply-in-thread");
      return runCli(config, args);
    },
    sendMessage(input) {
      return runCli(config, [
        "im",
        "+messages-send",
        "--as",
        "bot",
        "--chat-id",
        input.chatId,
        "--markdown",
        input.markdown,
        "--idempotency-key",
        input.idempotencyKey,
      ]);
    },
  };
}

function startEventConsumer(
  config: AppConfig,
  logger: Logger,
  onLine: (line: string) => void,
): () => void {
  let stopped = false;
  let child: ChildProcessWithoutNullStreams | null = null;
  let restartAttempt = 0;
  let buffer = "";

  const start = () => {
    if (stopped) return;
    child = spawn(config.larkCliBin, ["event", "consume", config.eventKey, "--as", "bot"], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      buffer += chunk;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines.filter(Boolean)) onLine(line);
    });

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      for (const line of chunk.split(/\r?\n/).filter(Boolean)) {
        if (line.includes("[event] ready")) {
          restartAttempt = 0;
          logger.info(`飞书事件监听已就绪：${config.eventKey}`);
        } else {
          logger.warn("lark-cli stderr", { line });
        }
      }
    });

    child.on("error", (error) => {
      logger.error("启动 lark-cli 失败", error);
    });

    child.on("exit", (code, signal) => {
      if (stopped) return;
      restartAttempt += 1;
      const delayMs = Math.min(30_000, 1000 * 2 ** Math.min(restartAttempt, 5));
      logger.warn("lark-cli 事件进程退出，准备重启", { code, signal, delayMs });
      setTimeout(start, delayMs);
    });
  };

  start();

  return () => {
    stopped = true;
    child?.stdin?.end();
    child?.kill("SIGTERM");
  };
}

function runCli(config: AppConfig, args: string[], timeoutMs = 60_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(config.larkCliBin, args, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`lark-cli timeout: ${args.join(" ")}`));
    }, timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve(stdout.trim());
        return;
      }
      reject(new Error(`lark-cli ${args.join(" ")} failed: ${stderr || stdout}`));
    });
  });
}
