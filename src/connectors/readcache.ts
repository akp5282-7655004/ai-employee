/**
 * Short-lived read-through cache for live connector calls.
 *
 * A signed-in page used to wait on a fresh Pipedream account list, and on a
 * project-wide GoHighLevel scan, on every navigation. This keeps the last
 * confirmed read, shares one in-flight call across the page, and lets the
 * request stop waiting. The live call still finishes and fills the cache, so
 * the next navigation paints from that read instead of starting another.
 *
 * A timeout is not stored as a confirmed answer. Connected stays false until
 * a read actually finishes, and a stored answer is refreshed again after its
 * fresh window — a check is never skipped for the life of the process.
 */

export interface ReadOptions {
  /** Serve this answer with no refresh. */
  freshMs: number;
  /** Serve this answer immediately and refresh behind the request. */
  staleMs: number;
  /** How long a request with nothing confirmed may wait for the live read. */
  waitMs: number;
  /** After a failed read, don't start another until this passes. */
  errorBackoffMs?: number;
}

export interface ReadResult<T> {
  value: T | undefined;
  /** True when `value` came from a finished live read. */
  confirmed: boolean;
}

interface Slot<T> {
  value?: T;
  confirmedAt?: number;
  errorAt?: number;
  startedAt?: number;
  inflight?: Promise<T>;
}

/** Reject when `p` is still pending after `ms`. Does not cancel `p`. */
export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

export function createReadThrough() {
  const slots = new Map<string, Slot<unknown>>();

  const forget = (key: string) => { slots.delete(key); };
  const forgetPrefix = (prefix: string) => {
    for (const key of slots.keys()) if (key.startsWith(prefix)) slots.delete(key);
  };

  async function read<T>(key: string, load: () => Promise<T>, opts: ReadOptions): Promise<ReadResult<T>> {
    const now = Date.now();
    let slot = slots.get(key) as Slot<T> | undefined;
    const age = slot?.confirmedAt ? now - slot.confirmedAt : Number.POSITIVE_INFINITY;
    const backoff = opts.errorBackoffMs ?? opts.freshMs;
    const failedRecently = !!(slot?.errorAt && now - slot.errorAt < backoff);

    if (slot?.value !== undefined && slot.confirmedAt && age < opts.freshMs) {
      return { value: slot.value, confirmed: true };
    }

    const begin = (): Promise<T> => {
      if (slot?.inflight) return slot.inflight;
      const startedAt = Date.now();
      const p = load().then(
        (value) => {
          slots.set(key, { value, confirmedAt: Date.now() });
          return value;
        },
        (err: unknown) => {
          const cur = slots.get(key) as Slot<T> | undefined;
          if (cur) {
            if (cur.inflight === p) cur.inflight = undefined;
            cur.errorAt = Date.now();
          } else {
            slots.set(key, { errorAt: Date.now() });
          }
          throw err;
        },
      );
      if (!slot) {
        slot = { startedAt, inflight: p };
        slots.set(key, slot);
      } else {
        slot.startedAt = startedAt;
        slot.inflight = p;
      }
      return p;
    };

    if (slot?.value !== undefined && slot.confirmedAt && age < opts.staleMs) {
      if (!slot.inflight && !failedRecently) void begin().catch(() => undefined);
      return { value: slot.value, confirmed: true };
    }

    // A request already waited out its budget on this same read. Don't make
    // the next handler in the same page wait that long again.
    if (slot?.inflight && slot.startedAt && now - slot.startedAt >= opts.waitMs) {
      if (slot.value !== undefined && slot.confirmedAt) return { value: slot.value, confirmed: true };
      return { value: undefined, confirmed: false };
    }

    if (failedRecently && slot?.value === undefined && !slot?.inflight) {
      return { value: undefined, confirmed: false };
    }

    if (opts.waitMs <= 0) {
      if (!slot?.inflight && !failedRecently) void begin().catch(() => undefined);
      if (slot?.value !== undefined && slot.confirmedAt) return { value: slot.value, confirmed: true };
      return { value: undefined, confirmed: false };
    }

    const pending = begin();
    const raced = await new Promise<T | undefined>((resolve) => {
      const t = setTimeout(() => resolve(undefined), opts.waitMs);
      pending.then(
        (v) => { clearTimeout(t); resolve(v); },
        () => { clearTimeout(t); resolve(undefined); },
      );
    });
    const latest = slots.get(key) as Slot<T> | undefined;
    if (latest?.value !== undefined && latest.confirmedAt && (raced !== undefined || latest.value !== undefined)) {
      // A finished read, including one that landed after this request stopped waiting.
      if (raced !== undefined) return { value: raced, confirmed: true };
      if (latest.confirmedAt) return { value: latest.value, confirmed: true };
    }
    if (raced !== undefined) return { value: raced, confirmed: true };
    return { value: undefined, confirmed: false };
  }

  return { read, forget, forgetPrefix };
}
