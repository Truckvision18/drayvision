/** Fixed-window per-key limiter. In-memory for the scaffold; move to Redis when the API scales out. */
export class RateLimiter {
  private readonly windows = new Map<string, { start: number; count: number }>();

  constructor(
    private readonly windowSeconds: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** Returns true if the request is allowed. */
  take(key: string, limit: number): boolean {
    const t = this.now();
    const w = this.windows.get(key);
    if (!w || t - w.start >= this.windowSeconds * 1000) {
      this.windows.set(key, { start: t, count: 1 });
      return true;
    }
    if (w.count >= limit) return false;
    w.count += 1;
    return true;
  }
}
