/**
 * 简单有界并发队列，用于限制 LLM 峰值请求。
 */
export class LlmQueue {
  private running = 0;
  private readonly pending: Array<() => void> = [];

  constructor(private readonly concurrency: number) {}

  /**
   * 将一个异步任务放入队列。
   *
   * @param task 实际 LLM 调用
   * @returns task 的返回值
   */
  run<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const start = () => {
        this.running += 1;
        task()
          .then(resolve, reject)
          .finally(() => {
            this.running -= 1;
            this.pending.shift()?.();
          });
      };

      if (this.running < this.concurrency) {
        start();
        return;
      }

      this.pending.push(start);
    });
  }
}
