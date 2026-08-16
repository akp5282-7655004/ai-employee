/**
 * A small fixed-window rate limiter for unauthenticated endpoints.
 *
 * Password reset is the case that needs it: it is reachable by anyone, it sends
 * an email, and both of those are abusable. Without a limit, one script can
 * bury a real customer's inbox in reset mail and burn the sending quota that
 * every other account depends on.
 *
 * In-memory and per-process, which is the right trade here: it costs nothing,
 * needs no infrastructure, and a limit that resets on deploy still stops the
 * abuse it exists to stop. If Miles ever runs on more than one instance this
 * wants to move to shared storage.
 */

interface Hit {
  count: number;
  /** When the current window began (epoch ms). */
  start: number;
}

export interface LimitResult {
  allowed: boolean;
  /** Seconds until the caller may try again (0 when allowed). */
  retryAfter: number;
}

const MAX_KEYS = 5_000;

export class RateLimiter {
  private hits = new Map<string, Hit>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}

  /** Record an attempt for `key` and say whether it is allowed. */
  check(key: string, now = Date.now()): LimitResult {
    const hit = this.hits.get(key);
    if (!hit || now - hit.start >= this.windowMs) {
      this.prune(now);
      this.hits.set(key, { count: 1, start: now });
      return { allowed: true, retryAfter: 0 };
    }
    hit.count++;
    if (hit.count > this.max) {
      return { allowed: false, retryAfter: Math.ceil((hit.start + this.windowMs - now) / 1000) };
    }
    return { allowed: true, retryAfter: 0 };
  }

  /** Drop expired entries, and the oldest ones if the map is still oversized. */
  private prune(now: number): void {
    if (this.hits.size < MAX_KEYS) return;
    for (const [k, v] of this.hits) if (now - v.start >= this.windowMs) this.hits.delete(k);
    while (this.hits.size >= MAX_KEYS) {
      const oldest = [...this.hits.entries()].sort((a, b) => a[1].start - b[1].start)[0];
      if (!oldest) break;
      this.hits.delete(oldest[0]);
    }
  }
}
