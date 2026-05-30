/**
 * 按 chat_id 串行执行事件处理。
 *
 * 不同群可以并行，同一个群内部保持顺序，避免任务抽取、回复和写库乱序。
 */
export class PerChatQueue {
  private readonly tails = new Map<string, Promise<void>>();

  enqueue(chatId: string, task: () => Promise<void>): void {
    const previous = this.tails.get(chatId) ?? Promise.resolve();
    const next = previous
      .catch(() => {
        // 上一个任务失败不应阻塞同群后续消息。
      })
      .then(task)
      .finally(() => {
        if (this.tails.get(chatId) === next) this.tails.delete(chatId);
      });
    this.tails.set(chatId, next);
  }
}
