import { newSession, type Session } from './agent/types.js';

/**
 * Server-side session storage. In-memory for now, behind an interface so a real
 * datastore (Postgres/Redis) drops in for multi-tenant persistence without the
 * server or agent loop changing (docs/VISION.md §3 — the intelligence and its
 * state live on our infrastructure).
 */
export interface SessionStore {
  getOrCreate(id: string): Session;
  save(id: string, s: Session): void;
}

export class MemorySessionStore implements SessionStore {
  private map = new Map<string, Session>();

  getOrCreate(id: string): Session {
    let s = this.map.get(id);
    if (!s) {
      s = newSession(id);
      this.map.set(id, s);
    }
    return s;
  }

  save(id: string, s: Session): void {
    this.map.set(id, s);
  }
}
