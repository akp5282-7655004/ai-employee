/**
 * User-data read cache.
 *
 * Every request reads the whole per-user JSON blob (intake, connections,
 * automations, CRM events, approval log, credit ledger…). One dashboard load
 * fires ~14 API calls, so the same blob — up to ~1MB on an active account —
 * was fetched and parsed 14 times per page.
 *
 * This wraps any Store with a short-TTL, write-through cache: the first read
 * in a burst pays the cost, the rest are free, and every write updates the
 * cache immediately so a caller never sees its own write go missing.
 *
 * The TTL is deliberately short (seconds). It collapses the fan-out of a
 * single page load without meaningfully staling data, and it stays correct
 * if a second process writes: entries expire on their own.
 */
import type { Store } from './store.js';

const TTL_MS = 3_000;
const MAX_ENTRIES = 200;

export interface CacheStats { hits: number; misses: number; writes: number }

export function withUserDataCache(store: Store, ttlMs = TTL_MS): Store & { cacheStats(): CacheStats } {
  const cache = new Map<string, { ts: number; data: Record<string, unknown> }>();
  // In-flight reads, so a burst of parallel requests (the dashboard fires ~14
  // at once) shares ONE store round-trip instead of stampeding it.
  const inflight = new Map<string, Promise<Record<string, unknown>>>();
  const stats: CacheStats = { hits: 0, misses: 0, writes: 0 };

  const prune = () => {
    if (cache.size <= MAX_ENTRIES) return;
    const now = Date.now();
    for (const [k, v] of cache) if (now - v.ts > ttlMs) cache.delete(k);
    // Still oversized (all fresh) — drop the oldest.
    while (cache.size > MAX_ENTRIES) {
      const oldest = [...cache.entries()].sort((a, b) => a[1].ts - b[1].ts)[0];
      if (!oldest) break;
      cache.delete(oldest[0]);
    }
  };

  const wrapped: Store & { cacheStats(): CacheStats } = Object.create(store);

  wrapped.getUserData = async (userId: string) => {
    const hit = cache.get(userId);
    if (hit && Date.now() - hit.ts < ttlMs) { stats.hits++; return hit.data; }
    const pending = inflight.get(userId);
    if (pending) { stats.hits++; return pending; } // join the read already running
    stats.misses++;
    const p = store.getUserData(userId)
      .then((data) => { cache.set(userId, { ts: Date.now(), data }); prune(); return data; })
      .finally(() => { inflight.delete(userId); });
    inflight.set(userId, p);
    return p;
  };

  wrapped.setUserData = async (userId: string, data: Record<string, unknown>) => {
    stats.writes++;
    inflight.delete(userId); // a read in flight must not overwrite this write
    // Write through: persist first, then refresh the cache so a failed write
    // never leaves a phantom value behind.
    await store.setUserData(userId, data);
    cache.set(userId, { ts: Date.now(), data });
    prune();
  };

  wrapped.deleteUser = async (id: string) => {
    cache.delete(id); inflight.delete(id);
    await store.deleteUser(id);
  };

  wrapped.cacheStats = () => ({ ...stats });
  return wrapped;
}
