import type { AuthSession, Store, User } from './store.js';

/** In-memory store — works with zero setup, but data resets when the server
 * restarts (e.g. Render's free plan sleeping). Use Postgres for real durability. */
export class MemoryStore implements Store {
  readonly name = 'memory';
  private users = new Map<string, User>();
  private byEmail = new Map<string, string>();
  private sessions = new Map<string, AuthSession>();
  private data = new Map<string, Record<string, unknown>>();

  async init(): Promise<void> {}

  async createUser(u: User): Promise<void> {
    this.users.set(u.id, u);
    this.byEmail.set(u.email.toLowerCase(), u.id);
  }
  async getUserByEmail(email: string): Promise<User | null> {
    const id = this.byEmail.get(email.toLowerCase());
    return id ? this.users.get(id) ?? null : null;
  }
  async getUserById(id: string): Promise<User | null> {
    return this.users.get(id) ?? null;
  }
  async updateUser(id: string, patch: { name?: string; passwordHash?: string }): Promise<void> {
    const u = this.users.get(id);
    if (!u) return;
    if (patch.name !== undefined) u.name = patch.name;
    if (patch.passwordHash !== undefined) u.passwordHash = patch.passwordHash;
    this.users.set(id, u);
  }

  async createSession(s: AuthSession): Promise<void> {
    this.sessions.set(s.token, s);
  }
  async getSession(token: string): Promise<AuthSession | null> {
    const s = this.sessions.get(token);
    if (!s) return null;
    if (s.expiresAt < Date.now()) {
      this.sessions.delete(token);
      return null;
    }
    return s;
  }
  async deleteSession(token: string): Promise<void> {
    this.sessions.delete(token);
  }
  async deleteSessionsForUser(userId: string): Promise<void> {
    for (const [token, s] of this.sessions) if (s.userId === userId) this.sessions.delete(token);
  }

  async getUserData(userId: string): Promise<Record<string, unknown>> {
    return this.data.get(userId) ?? {};
  }
  async setUserData(userId: string, data: Record<string, unknown>): Promise<void> {
    this.data.set(userId, data);
  }
  async listUserIds(): Promise<string[]> {
    return Array.from(this.data.keys());
  }
  async listUsers(): Promise<Array<{ id: string; email: string; name?: string; createdAt: string }>> {
    return Array.from(this.users.values())
      .map((u) => ({ id: u.id, email: u.email, name: u.name, createdAt: u.createdAt }))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
  async deleteUser(id: string): Promise<void> {
    const u = this.users.get(id);
    if (u) this.byEmail.delete(u.email.toLowerCase());
    this.users.delete(id);
    this.data.delete(id);
    for (const [token, s] of this.sessions) if (s.userId === id) this.sessions.delete(token);
  }
}
