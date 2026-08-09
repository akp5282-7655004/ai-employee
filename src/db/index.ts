import { MemoryStore } from './memory.js';
import { PostgresStore } from './postgres.js';
import type { Store } from './store.js';

export * from './store.js';
export { MemoryStore } from './memory.js';
export { PostgresStore } from './postgres.js';

/** Postgres when DATABASE_URL is set (real durability), memory otherwise. */
export function makeStore(): Store {
  const url = process.env.DATABASE_URL;
  return url ? new PostgresStore(url) : new MemoryStore();
}
