/**
 * Living playbook tables. Applied from PostgresStore.init on every boot.
 * CREATE TABLE IF NOT EXISTS, same as the other tables in this app.
 *
 * benchmark_aggregate has no account id. benchmark_daily keeps one so an
 * opt-out or a deleted account can be removed. It is not returned by any
 * read API.
 */
export const LIVING_PLAYBOOK_SQL = `
CREATE TABLE IF NOT EXISTS benchmark_daily (
  account_id TEXT NOT NULL,
  day TEXT NOT NULL,
  platform TEXT NOT NULL,
  campaign_type TEXT NOT NULL,
  trade TEXT NOT NULL,
  tracking_verified BOOLEAN NOT NULL DEFAULT false,
  account_active BOOLEAN NOT NULL DEFAULT false,
  consent BOOLEAN NOT NULL DEFAULT false,
  spend DOUBLE PRECISION NOT NULL DEFAULT 0,
  clicks INTEGER NOT NULL DEFAULT 0,
  impressions INTEGER NOT NULL DEFAULT 0,
  leads INTEGER NOT NULL DEFAULT 0,
  conversions INTEGER NOT NULL DEFAULT 0,
  booked_jobs INTEGER NOT NULL DEFAULT 0,
  revenue DOUBLE PRECISION NOT NULL DEFAULT 0,
  cpl DOUBLE PRECISION,
  cpc DOUBLE PRECISION,
  cpa DOUBLE PRECISION,
  roas DOUBLE PRECISION,
  PRIMARY KEY (account_id, day, platform, campaign_type)
);
CREATE INDEX IF NOT EXISTS benchmark_daily_day ON benchmark_daily (day);
CREATE TABLE IF NOT EXISTS benchmark_membership (
  account_id TEXT PRIMARY KEY,
  trade TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT false,
  consent BOOLEAN NOT NULL DEFAULT false,
  tracking_verified BOOLEAN NOT NULL DEFAULT false,
  platforms JSONB NOT NULL DEFAULT '[]'::jsonb
);
CREATE TABLE IF NOT EXISTS benchmark_aggregate (
  trade TEXT NOT NULL,
  platform TEXT NOT NULL,
  metric TEXT NOT NULL,
  window_days INTEGER NOT NULL,
  as_of TEXT NOT NULL,
  median DOUBLE PRECISION,
  p25 DOUBLE PRECISION,
  p75 DOUBLE PRECISION,
  contributor_count INTEGER NOT NULL,
  cohort_n INTEGER NOT NULL,
  required_count INTEGER NOT NULL,
  published BOOLEAN NOT NULL,
  spend_cap_ok BOOLEAN NOT NULL,
  total_spend DOUBLE PRECISION NOT NULL DEFAULT 0,
  reason TEXT NOT NULL,
  PRIMARY KEY (trade, platform, metric, window_days)
);
`;
