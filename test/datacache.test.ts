import { describe, expect, it } from 'vitest';
import { withUserDataCache } from '../src/db/cache.js';
import { MemoryStore } from '../src/db/memory.js';

const mk = () => {
  const base = new MemoryStore();
  let reads = 0;
  const orig = base.getUserData.bind(base);
  base.getUserData = async (id: string) => { reads++; return orig(id); };
  return { base, reads: () => reads };
};

describe('user-data read cache', () => {
  it('collapses a burst of reads into one store hit', async () => {
    const { base, reads } = mk();
    const store = withUserDataCache(base);
    await Promise.all(Array.from({ length: 14 }, () => store.getUserData('u1')));
    expect(reads()).toBe(1); // one dashboard load, one read
    expect(store.cacheStats().hits).toBe(13);
  });

  it('a write is visible immediately to the next read (write-through)', async () => {
    const store = withUserDataCache(new MemoryStore());
    await store.setUserData('u1', { profile: { businessName: 'Smoky Mtn' } });
    const back = await store.getUserData('u1');
    expect((back.profile as any).businessName).toBe('Smoky Mtn');
  });

  it('expires so a second process’s write is picked up', async () => {
    const { base, reads } = mk();
    const store = withUserDataCache(base, 10); // 10ms TTL
    await store.getUserData('u1');
    await new Promise((r) => setTimeout(r, 25));
    await store.getUserData('u1');
    expect(reads()).toBe(2);
  });

  it('deleting a user drops the cached copy', async () => {
    const store = withUserDataCache(new MemoryStore());
    await store.setUserData('u1', { a: 1 });
    await store.deleteUser('u1');
    expect(await store.getUserData('u1')).toEqual({});
  });
});
