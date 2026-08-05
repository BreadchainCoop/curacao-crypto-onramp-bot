// Tiny in-memory sliding-window rate limiter, keyed by an arbitrary string
// (e.g. "buy:<telegram_id>"). Good enough for a single-process bot; a
// multi-instance deployment would move this to Redis/DB.

function createRateLimiter({ windowMs = 60_000, max = 8 } = {}) {
  const hits = new Map(); // key -> timestamp[]

  /** Record an attempt; return true if allowed, false if over the limit. */
  function allow(key) {
    const now = Date.now();
    const recent = (hits.get(key) || []).filter((t) => now - t < windowMs);
    if (recent.length >= max) {
      hits.set(key, recent);
      return false;
    }
    recent.push(now);
    hits.set(key, recent);
    return true;
  }

  return { allow };
}

module.exports = { createRateLimiter };
