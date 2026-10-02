/** Fixed-window counter keyed by an arbitrary string (usually the client IP). */
export class WindowRateLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  /** Returns true when the request is allowed. */
  take(key: string, now = Date.now()): boolean {
    let entry = this.hits.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + this.windowMs };
      this.hits.set(key, entry);
    }
    entry.count++;
    if (this.hits.size > 50_000) this.prune(now);
    return entry.count <= this.limit;
  }

  retryAfterSeconds(key: string, now = Date.now()): number {
    const entry = this.hits.get(key);
    return entry ? Math.max(1, Math.ceil((entry.resetAt - now) / 1000)) : 1;
  }

  prune(now = Date.now()): void {
    for (const [key, entry] of this.hits) if (entry.resetAt <= now) this.hits.delete(key);
  }
}

/** Token bucket used to throttle messages on a single WebSocket connection. */
export class TokenBucket {
  private tokens: number;
  private last: number;

  constructor(
    private readonly ratePerSecond: number,
    private readonly burst: number,
  ) {
    this.tokens = burst;
    this.last = Date.now();
  }

  take(cost = 1, now = Date.now()): boolean {
    this.tokens = Math.min(this.burst, this.tokens + ((now - this.last) / 1000) * this.ratePerSecond);
    this.last = now;
    if (this.tokens < cost) return false;
    this.tokens -= cost;
    return true;
  }
}
