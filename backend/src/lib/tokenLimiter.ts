// Per-token limiter (in-memory). Use Redis when running more than one instance.
const WINDOW_MS = 60_000;
export const TOKEN_LIMIT_PER_MIN = 60;
const buckets = new Map<string, { n: number; reset: number }>();
export function consumeToken(tokenId: string, now = Date.now(), max = TOKEN_LIMIT_PER_MIN) {
  let b = buckets.get(tokenId);
  if (!b || now >= b.reset) { b = { n: 0, reset: now + WINDOW_MS }; buckets.set(tokenId, b); }
  b.n++;
  if (buckets.size > 10_000) for (const [k, v] of buckets) if (now >= v.reset) buckets.delete(k);
  return { allowed: b.n <= max, retryAfterSec: Math.ceil((b.reset - now) / 1000), remaining: Math.max(0, max - b.n) };
}

