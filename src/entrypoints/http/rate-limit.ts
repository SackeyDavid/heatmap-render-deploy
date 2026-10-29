/** Sliding-window limiter keyed by site. In memory: one process, which is what v1 runs. */
export class SiteRateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs = 60_000,
  ) {}

  /** Records an attempt. Returns 0 when allowed, else the seconds until the next attempt would be allowed. */
  take(site: string, nowMs: number): number {
    const recent = (this.hits.get(site) ?? []).filter((t) => nowMs - t < this.windowMs);
    if (recent.length >= this.limit) {
      this.hits.set(site, recent);
      return Math.max(1, Math.ceil((recent[0]! + this.windowMs - nowMs) / 1000));
    }
    recent.push(nowMs);
    this.hits.set(site, recent);
    if (this.hits.size > 10_000) {
      for (const [k, v] of this.hits) if (v.every((t) => nowMs - t >= this.windowMs)) this.hits.delete(k);
    }
    return 0;
  }
}
