import { LIVING_PLAYBOOK_SQL } from '../benchmarks/schema.js';
import type { AggregateRow, DailyRow, Membership, Platform } from '../benchmarks/types.js';
import { mergeCredits, stripCreditBase } from '../billing/merge.js';
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
      CREATE TABLE IF NOT EXISTS launch_offers (
        user_id TEXT PRIMARY KEY,
        claimed_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS launch_credit_claims (
        email TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        claimed_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
    await this.pool.query(LIVING_PLAYBOOK_SQL);
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
  async updateUser(id: string, patch: { name?: string; passwordHash?: string; email?: string }): Promise<void> {
    const sets: string[] = [];
    const vals: unknown[] = [];
    if (patch.name !== undefined) { sets.push(`name=$${sets.length + 1}`); vals.push(patch.name); }
    if (patch.passwordHash !== undefined) { sets.push(`password_hash=$${sets.length + 1}`); vals.push(patch.passwordHash); }
    // users.email is UNIQUE, so the database refuses an address another account holds.
    if (patch.email !== undefined) { sets.push(`email=$${sets.length + 1}`); vals.push(patch.email); }
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
  async deleteSessionsForUser(userId: string): Promise<void> {
    await this.pool.query('DELETE FROM sessions WHERE user_id=$1', [userId]);
  }

  async getUserData(userId: string): Promise<Record<string, unknown>> {
    const r = await this.pool.query('SELECT data FROM user_data WHERE user_id=$1', [userId]);
    return r.rows[0]?.data ?? {};
  }
  async setUserData(userId: string, incoming: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.mutateUserData(userId, (current) => {
      const merged = mergeCredits(current.credits, incoming.credits, current.billing, incoming.billing);
      const next = { ...current, ...incoming, credits: merged.credits, billing: merged.billing };
      // Chat routes own this transcript once the owner has reset it.
      if (current.chatRevision) Object.assign(next, { chat: current.chat, chatRevision: current.chatRevision });
      stripCreditBase(next);
      for (const k of Object.keys(current)) delete current[k];
      Object.assign(current, next);
    });
  }
  async mutateUserData(userId: string, fn: (data: Record<string, unknown>) => void | Promise<void>): Promise<Record<string, unknown>> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO user_data(user_id, data) VALUES ($1, '{}'::jsonb) ON CONFLICT (user_id) DO NOTHING`,
        [userId],
      );
      const r = await client.query('SELECT data FROM user_data WHERE user_id=$1 FOR UPDATE', [userId]);
      const current = (r.rows[0]?.data ?? {}) as Record<string, unknown>;
      await fn(current);
      stripCreditBase(current);
      await client.query('UPDATE user_data SET data=$2::jsonb WHERE user_id=$1', [userId, JSON.stringify(current)]);
      await client.query('COMMIT');
      return current;
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch { /* already closed */ }
      throw err;
    } finally {
      client.release();
    }
  }
  async claimLaunchSlot(userId: string): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('LOCK TABLE launch_offers IN EXCLUSIVE MODE');
      const existing = await client.query('SELECT 1 FROM launch_offers WHERE user_id=$1', [userId]);
      if (existing.rowCount) {
        await client.query('COMMIT');
        return true;
      }
      const count = await client.query('SELECT count(*)::int AS n FROM launch_offers');
      if ((count.rows[0]?.n ?? 0) >= 100) {
        await client.query('COMMIT');
        return false;
      }
      await client.query('INSERT INTO launch_offers(user_id) VALUES ($1)', [userId]);
      await client.query('COMMIT');
      return true;
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch { /* already closed */ }
      throw err;
    } finally {
      client.release();
    }
  }
  async claimLaunchCredit(email: string, userId: string): Promise<boolean> {
    // No foreign key to users: the claim must outlive a deleted account.
    await this.pool.query('INSERT INTO launch_credit_claims(email, user_id) VALUES ($1, $2) ON CONFLICT (email) DO NOTHING', [email, userId]);
    const r = await this.pool.query('SELECT user_id FROM launch_credit_claims WHERE email=$1', [email]);
    return r.rows[0]?.user_id === userId;
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
    await this.pool.query('DELETE FROM benchmark_daily WHERE account_id=$1', [id]);
    await this.pool.query('DELETE FROM benchmark_membership WHERE account_id=$1', [id]);
    await this.pool.query('DELETE FROM users WHERE id=$1', [id]);
  }

  async upsertBenchmarkDaily(rows: DailyRow[]): Promise<void> {
    for (const row of rows) {
      await this.pool.query(
        `INSERT INTO benchmark_daily(account_id, day, platform, campaign_type, trade, tracking_verified, account_active, consent, spend, clicks, impressions, leads, conversions, booked_jobs, revenue, cpl, cpc, cpa, roas)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
         ON CONFLICT (account_id, day, platform, campaign_type) DO UPDATE SET
           trade=EXCLUDED.trade, tracking_verified=EXCLUDED.tracking_verified, account_active=EXCLUDED.account_active, consent=EXCLUDED.consent,
           spend=EXCLUDED.spend, clicks=EXCLUDED.clicks, impressions=EXCLUDED.impressions, leads=EXCLUDED.leads, conversions=EXCLUDED.conversions,
           booked_jobs=EXCLUDED.booked_jobs, revenue=EXCLUDED.revenue, cpl=EXCLUDED.cpl, cpc=EXCLUDED.cpc, cpa=EXCLUDED.cpa, roas=EXCLUDED.roas`,
        [row.accountId, row.day, row.platform, row.campaignType, row.trade, row.trackingVerified, row.accountActive, row.consent, row.spend, row.clicks, row.impressions, row.leads, row.conversions, row.bookedJobs, row.revenue, row.cpl, row.cpc, row.cpa, row.roas],
      );
    }
  }
  async deleteBenchmarkDaily(accountId: string): Promise<void> {
    await this.pool.query('DELETE FROM benchmark_daily WHERE account_id=$1', [accountId]);
  }
  async listBenchmarkDaily(): Promise<DailyRow[]> {
    const r = await this.pool.query('SELECT * FROM benchmark_daily');
    return r.rows.map((row: Record<string, unknown>) => this.mapDaily(row));
  }
  async upsertBenchmarkMembership(row: Membership): Promise<void> {
    await this.pool.query(
      `INSERT INTO benchmark_membership(account_id, trade, active, consent, tracking_verified, platforms)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb)
       ON CONFLICT (account_id) DO UPDATE SET trade=EXCLUDED.trade, active=EXCLUDED.active, consent=EXCLUDED.consent, tracking_verified=EXCLUDED.tracking_verified, platforms=EXCLUDED.platforms`,
      [row.accountId, row.trade, row.active, row.consent, row.trackingVerified, JSON.stringify(row.platforms)],
    );
  }
  async listBenchmarkMembership(): Promise<Membership[]> {
    const r = await this.pool.query('SELECT * FROM benchmark_membership');
    return r.rows.map((row: Record<string, unknown>) => ({
      accountId: String(row.account_id),
      trade: String(row.trade),
      active: row.active === true,
      consent: row.consent === true,
      trackingVerified: row.tracking_verified === true,
      platforms: (Array.isArray(row.platforms) ? row.platforms : []) as Platform[],
    }));
  }
  async replaceBenchmarkAggregates(rows: AggregateRow[]): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM benchmark_aggregate');
      for (const row of rows) {
        await client.query(
          `INSERT INTO benchmark_aggregate(trade, platform, metric, window_days, as_of, median, p25, p75, contributor_count, cohort_n, required_count, published, spend_cap_ok, total_spend, reason)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
          [row.trade, row.platform, row.metric, row.windowDays, row.asOf, row.median, row.p25, row.p75, row.contributorCount, row.cohortN, row.requiredCount, row.published, row.spendCapOk, row.totalSpend, row.reason],
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch { /* already closed */ }
      throw err;
    } finally {
      client.release();
    }
  }
  async listBenchmarkAggregates(): Promise<AggregateRow[]> {
    const r = await this.pool.query('SELECT * FROM benchmark_aggregate');
    return r.rows.map((row: Record<string, unknown>) => ({
      trade: String(row.trade),
      platform: row.platform as AggregateRow['platform'],
      metric: row.metric as AggregateRow['metric'],
      windowDays: Number(row.window_days),
      asOf: String(row.as_of),
      median: row.median == null ? null : Number(row.median),
      p25: row.p25 == null ? null : Number(row.p25),
      p75: row.p75 == null ? null : Number(row.p75),
      contributorCount: Number(row.contributor_count),
      cohortN: Number(row.cohort_n),
      requiredCount: Number(row.required_count),
      published: row.published === true,
      spendCapOk: row.spend_cap_ok === true,
      totalSpend: Number(row.total_spend),
      reason: row.reason as AggregateRow['reason'],
    }));
  }
  private mapDaily(row: Record<string, unknown>): DailyRow {
    const num = (value: unknown) => (value == null ? null : Number(value));
    return {
      accountId: String(row.account_id),
      day: String(row.day),
      platform: row.platform as DailyRow['platform'],
      campaignType: String(row.campaign_type),
      trade: String(row.trade),
      trackingVerified: row.tracking_verified === true,
      accountActive: row.account_active === true,
      consent: row.consent === true,
      spend: Number(row.spend) || 0,
      clicks: Number(row.clicks) || 0,
      impressions: Number(row.impressions) || 0,
      leads: Number(row.leads) || 0,
      conversions: Number(row.conversions) || 0,
      bookedJobs: Number(row.booked_jobs) || 0,
      revenue: Number(row.revenue) || 0,
      cpl: num(row.cpl),
      cpc: num(row.cpc),
      cpa: num(row.cpa),
      roas: num(row.roas),
    };
  }
}
