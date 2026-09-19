type Policy = { limit: number; windowMs: number };
type Bucket = { count: number; limit: number; expires: number };
const MAX_BUCKETS = 10_000;
const MAX_KEY_LENGTH = 512;
const MAX_WINDOW_MS = 86_400_000;

/** Fixed-window, process-local quotas. Callers namespace keys for each operation/policy. */
export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private readonly now: () => number;
  private nextCleanup = 0;

  constructor(now: () => number = Date.now) { this.now = now; }

  consume(key: string, policy: Policy): boolean {
    if (!key || key.length > MAX_KEY_LENGTH || !Number.isSafeInteger(policy.limit) || policy.limit <= 0
      || !Number.isSafeInteger(policy.windowMs) || policy.windowMs <= 0 || policy.windowMs > MAX_WINDOW_MS) return false;
    const now = this.now();
    if (!Number.isFinite(now)) return false;
    // Sweep at most once per second, never for every rejected request at saturation.
    if (now >= this.nextCleanup) {
      for (const [id, bucket] of this.buckets) if (bucket.expires <= now) this.buckets.delete(id);
      this.nextCleanup = now + 1000;
    }
    let bucket = this.buckets.get(key);
    if (bucket && bucket.expires <= now) { this.buckets.delete(key); bucket = undefined; }
    if (!bucket) {
      // Never evict a live bucket: attackers cannot free their own exhausted quota by flooding keys.
      if (this.buckets.size >= MAX_BUCKETS) return false;
      bucket = { count: 0, limit: policy.limit, expires: now + policy.windowMs };
      this.buckets.set(key, bucket);
    }
    if (bucket.count >= Math.min(bucket.limit, policy.limit)) return false;
    bucket.count++;
    return true;
  }
}
