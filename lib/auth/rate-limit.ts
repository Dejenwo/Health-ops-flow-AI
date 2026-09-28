const buckets = new Map<string, { count: number; resetAt: number }>();

function bucket(key: string, windowMs: number) {
  const now = Date.now();
  const current = buckets.get(key);
  if (!current || current.resetAt < now) {
    const next = { count: 0, resetAt: now + windowMs };
    buckets.set(key, next);
    return next;
  }
  return current;
}

export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const current = bucket(key, windowMs);
  if (current.count >= limit) return false;
  current.count += 1;
  return true;
}

export function isRateLimited(key: string, limit: number): boolean {
  const current = buckets.get(key);
  if (!current || current.resetAt < Date.now()) return false;
  return current.count >= limit;
}
