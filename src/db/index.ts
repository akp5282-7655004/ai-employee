import { MemoryStore } from './memory.js';
import { PostgresStore } from './postgres.js';
import type { Store } from './store.js';

export * from './store.js';
export { MemoryStore } from './memory.js';
export { PostgresStore } from './postgres.js';

/** A hosted deploy — Render sets RENDER on every instance. */
export function isHostedDeploy(): boolean {
  return !!process.env.RENDER || process.env.NODE_ENV === 'production';
}

/** Whether accounts survive a restart. Memory does not: every deploy, crash or
 *  idle spin-down erases every account and every login session with it. */
export function storageStatus(store: Pick<Store, 'name'>): { store: string; durable: boolean; note: string } {
  const durable = store.name !== 'memory';
  return {
    store: store.name,
    durable,
    note: durable
      ? 'Accounts and sessions are stored in Postgres and survive restarts.'
      : 'Temporary storage — accounts and logins are held in memory and are erased on every restart or deploy. Set DATABASE_URL to make them permanent.',
  };
}

export const NO_DATABASE_MESSAGE = [
  '',
  '  REFUSING TO START: no DATABASE_URL',
  '',
  '  Without it every account, password and login session lives in memory and',
  '  is destroyed on the next restart or deploy. People would sign up, come',
  '  back, and find their account gone — with nothing in the logs to say why.',
  '',
  '  Fix: attach a Postgres instance and set DATABASE_URL in the environment.',
  '  On Render: Dashboard -> the service -> Environment -> add DATABASE_URL.',
  '',
  '  To run on temporary storage on purpose (a local demo, a throwaway',
  '  sandbox), set ALLOW_EPHEMERAL_STORE=1 and this becomes a warning.',
  '',
].join('\n');

/**
 * Postgres when DATABASE_URL is set (real durability), memory otherwise.
 *
 * A hosted deploy without DATABASE_URL is refused rather than started. The
 * alternative — booting happily and erasing every account on the next deploy —
 * is the worse failure: it looks like it works, and the loss only surfaces
 * later as "it doesn't remember my password".
 */
export function makeStore(): Store {
  const url = process.env.DATABASE_URL;
  if (url) return new PostgresStore(url);
  if (isHostedDeploy()) {
    if (process.env.ALLOW_EPHEMERAL_STORE !== '1') throw new Error(NO_DATABASE_MESSAGE);
    // eslint-disable-next-line no-console
    console.warn('\n  WARNING: temporary storage (ALLOW_EPHEMERAL_STORE=1) — every account and login is erased on the next restart.\n');
  }
  return new MemoryStore();
}
