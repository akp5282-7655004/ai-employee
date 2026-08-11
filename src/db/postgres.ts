import type { AuthSession, Store, User } from './store.js';

/**
 * Postgres-backed store — real durability. Enabled by setting DATABASE_URL (e.g. a
 * free Neon or Render Postgres). The `pg` driver is loaded dynamically so the app
 * still runs without it when DATABASE_URL is unset. Tables are created on init.
 */
export class PostgresStore implements Store {
  readonly name = 'postgres';
  private pool: any;

  constructor(private url: string) {}

  async init(): Promise<void> {
    const importDynamic = new Function('m', 'return import(m)') as (m: string) => Promise<any>;
    const pg = await importDynamic('pg');
    const Pool = pg.default?.Pool ?? pg.Pool;
    this.pool = new Pool({ connectionString: this.url, ssl: { rejectUnauthorized: false } });
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT,
        password_hash TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires_at BIGINT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS user_data (
        user_id TEXT PRIMARY KEY REFERENCES users(id), data JSONB NOT NULL DEFAULT '{}'::jsonb
      );
    `);
  }

  async createUser(u: User): Promise<void> {
    await this.pool.query(
      'INSERT INTO users(id,email,name,password_hash,created_at) VALUES($1,$2,$3,$4,$5)',
      [u.id, u.email, u.name ?? null, u.passwordHash, u.createdAt],
    );
  }
  async getUserByEmail(email: string): Promise<User | null> {
    const r = await this.pool.query('SELECT * FROM users WHERE lower(email)=lower($1)', [email]);
    return r.rows[0] ? this.mapUser(r.rows[0]) : null;
  }
  async getUserById(id: string): Promise<User | null> {
    const r = await this.pool.query('SELECT * FROM users WHERE id=$1', [id]);
    return r.rows[0] ? this.mapUser(r.rows[0]) : null;
  }
  async updateUser(id: string, patch: { name?: string; passwordHash?: string }): Promise<void> {
    const sets: string[] = [];
    const vals: unknown[] = [];
    if (patch.name !== undefined) { sets.push(`name=$${sets.length + 1}`); vals.push(patch.name); }
    if (patch.passwordHash !== undefined) { sets.push(`password_hash=$${sets.length + 1}`); vals.push(patch.passwordHash); }
    if (!sets.length) return;
    vals.push(id);
    await this.pool.query(`UPDATE users SET ${sets.join(', ')} WHERE id=$${vals.length}`, vals);
  }
  private mapUser(r: any): User {
    return { id: r.id, email: r.email, name: r.name ?? undefined, passwordHash: r.password_hash, createdAt: new Date(r.created_at).toISOString() };
  }

  async createSession(s: AuthSession): Promise<void> {
    await this.pool.query('INSERT INTO sessions(token,user_id,expires_at) VALUES($1,$2,$3)', [s.token, s.userId, s.expiresAt]);
  }
  async getSession(token: string): Promise<AuthSession | null> {
    const r = await this.pool.query('SELECT * FROM sessions WHERE token=$1', [token]);
    if (!r.rows[0]) return null;
    const s: AuthSession = { token: r.rows[0].token, userId: r.rows[0].user_id, expiresAt: Number(r.rows[0].expires_at) };
    if (s.expiresAt < Date.now()) {
      await this.deleteSession(token);
      return null;
    }
    return s;
  }
  async deleteSession(token: string): Promise<void> {
    await this.pool.query('DELETE FROM sessions WHERE token=$1', [token]);
  }

  async getUserData(userId: string): Promise<Record<string, unknown>> {
    const r = await this.pool.query('SELECT data FROM user_data WHERE user_id=$1', [userId]);
    return r.rows[0]?.data ?? {};
  }
  async setUserData(userId: string, data: Record<string, unknown>): Promise<void> {
    await this.pool.query(
      'INSERT INTO user_data(user_id,data) VALUES($1,$2) ON CONFLICT(user_id) DO UPDATE SET data=$2',
      [userId, JSON.stringify(data)],
    );
  }
  async listUserIds(): Promise<string[]> {
    const r = await this.pool.query('SELECT user_id FROM user_data');
    return r.rows.map((row: { user_id: string }) => row.user_id);
  }
  async listUsers(): Promise<Array<{ id: string; email: string; name?: string; createdAt: string }>> {
    const r = await this.pool.query('SELECT id, email, name, created_at FROM users ORDER BY created_at ASC');
    return r.rows.map((x: { id: string; email: string; name?: string; created_at: string }) => ({
      id: x.id,
      email: x.email,
      name: x.name ?? undefined,
      createdAt: typeof x.created_at === 'string' ? x.created_at : new Date(x.created_at).toISOString(),
    }));
  }
  async deleteUser(id: string): Promise<void> {
    await this.pool.query('DELETE FROM sessions WHERE user_id=$1', [id]);
    await this.pool.query('DELETE FROM user_data WHERE user_id=$1', [id]);
    await this.pool.query('DELETE FROM users WHERE id=$1', [id]);
  }
}
