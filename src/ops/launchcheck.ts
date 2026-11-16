/**
 * Launch check — is this deploy actually able to take a customer?
 *
 * Every question here has the same shape: the code is fine and the answer
 * lives in configuration nobody can see from the outside. Test keys left in
 * place decline every real card. A live key paired with test-mode price ids
 * fails at checkout. A webhook that is not subscribed to invoice.paid takes
 * the money and grants nothing. The offline mock connector shows a working
 * dashboard built entirely on invented accounts. None of these fail a test or
 * a build; each one is found by the first customer.
 *
 * This is pure: it takes the environment and what Stripe reported, and returns
 * the list. The network reads live in billing/stripe.ts (probeStripe), so the
 * verdicts are tested without a Stripe account.
 *
 * It reports names and states only. No key, secret, or id value is ever put
 * in a check's text.
 */

export type PaidBandKey = 'starter' | 'growth' | 'scale';

export interface Check {
  name: string;
  ok: boolean;
  /** A blocker stops a real customer. A warning is worth knowing and survivable. */
  level: 'blocker' | 'warn';
  note: string;
}

export interface PriceFact {
  active: boolean;
  livemode: boolean;
  interval?: string;
  /** Cents. */
  unitAmount?: number | null;
}

export interface WebhookFact {
  url: string;
  status: string;
  events: string[];
  livemode: boolean;
}

export interface StripeProbe {
  /** Read off the key's own prefix; never the key. */
  mode: 'live' | 'test' | 'unknown';
  prices: Partial<Record<PaidBandKey, PriceFact | { error: string }>>;
  webhooks: WebhookFact[] | { error: string };
}

export interface LaunchFacts {
  env: Record<string, string | undefined>;
  durableStore: boolean;
  connectorLive: boolean;
  textAiReady: boolean;
  /** Resend or SMTP — whichever the app would actually send through. */
  emailReady: boolean;
  billingEnforced: boolean;
  /** Dollars a month, per band, as the app will charge them. */
  bandPrices: Record<PaidBandKey, number>;
  /** Absent when no Stripe key is set — there is nothing to ask Stripe. */
  stripe?: StripeProbe;
}

/** Without these, a subscriber is charged and never credited, or never moved off a failed card. */
export const REQUIRED_EVENTS = [
  'checkout.session.completed',
  'invoice.paid',
  'invoice.payment_failed',
  'customer.subscription.updated',
  'customer.subscription.deleted',
] as const;

/** Handled if they arrive. Top-ups settle on the request itself, so these are a second line, not the first. */
export const USEFUL_EVENTS = [
  'customer.subscription.created',
  'payment_intent.succeeded',
  'payment_intent.payment_failed',
] as const;

const PRICE_ENV: Record<PaidBandKey, string> = {
  starter: 'STRIPE_PRICE_STARTER',
  growth: 'STRIPE_PRICE_GROWTH',
  scale: 'STRIPE_PRICE_SCALE',
};
const BAND_LABEL: Record<PaidBandKey, string> = { starter: 'Starter', growth: 'Growth', scale: 'Scale' };

export function stripeModeOf(key: string | undefined): StripeProbe['mode'] {
  if (!key) return 'unknown';
  if (/^(sk|rk)_live_/.test(key)) return 'live';
  if (/^(sk|rk)_test_/.test(key)) return 'test';
  return 'unknown';
}

export function launchChecks(f: LaunchFacts): Check[] {
  const out: Check[] = [];
  const set = (k: string) => !!f.env[k];
  const add = (name: string, ok: boolean, level: Check['level'], good: string, bad: string) =>
    out.push({ name, ok, level, note: ok ? good : bad });

  add('Accounts are stored in Postgres', f.durableStore, 'blocker',
    'Accounts and logins survive a restart.',
    'Accounts are held in memory and are erased on every restart or deploy. Set DATABASE_URL.');

  const appUrl = (f.env.APP_URL || f.env.RENDER_EXTERNAL_URL || '').replace(/\/$/, '');
  add('The app knows its own address', !!appUrl, 'blocker',
    'Checkout returns and emailed links point at this site.',
    'APP_URL is not set. Checkout cannot return here and password-reset links cannot be sent.');

  // ── Payments ──
  const hasKey = set('STRIPE_SECRET_KEY');
  add('Stripe is connected', hasKey, 'blocker',
    'A Stripe key is set.',
    'STRIPE_SECRET_KEY is not set. Nobody can subscribe.');

  if (hasKey) {
    const mode = f.stripe?.mode ?? 'unknown';
    add('Stripe is in live mode', mode === 'live', 'blocker',
      'Live key. Real cards are charged.',
      mode === 'test'
        ? 'This is a test key. Real cards are declined and no money moves. Switch STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET and the three STRIPE_PRICE_ values to their live-mode versions before taking a customer.'
        : 'The key does not look like a Stripe secret key. Check STRIPE_SECRET_KEY.');

    add('Webhook signing secret is set', set('STRIPE_WEBHOOK_SECRET'), 'blocker',
      'Stripe events can be verified.',
      'STRIPE_WEBHOOK_SECRET is not set. Every Stripe event is rejected, so a payment is taken and no plan or credits are granted.');

    for (const band of ['starter', 'growth', 'scale'] as const) {
      const name = `${BAND_LABEL[band]} price ($${f.bandPrices[band]}/mo)`;
      if (!set(PRICE_ENV[band])) {
        out.push({ name, ok: false, level: 'blocker', note: `${PRICE_ENV[band]} is not set. The ${BAND_LABEL[band]} plan cannot be bought.` });
        continue;
      }
      const fact = f.stripe?.prices[band];
      if (!fact) {
        out.push({ name, ok: false, level: 'warn', note: 'Set, but Stripe was not asked about it.' });
      } else if ('error' in fact) {
        out.push({
          name, ok: false, level: 'blocker',
          note: `Stripe does not recognise this price with the current key (${fact.error}). The usual cause is a test-mode price id beside a live key, or the other way round.`,
        });
      } else {
        const problems: string[] = [];
        if (!fact.active) problems.push('the price is archived');
        if (fact.interval !== 'month') problems.push(`it bills every ${fact.interval ?? 'unknown period'}, not monthly`);
        const want = Math.round(f.bandPrices[band] * 100);
        if (fact.unitAmount !== want) {
          problems.push(`it charges $${((fact.unitAmount ?? 0) / 100).toFixed(2)}, and the app advertises $${f.bandPrices[band].toFixed(2)}`);
        }
        if (mode !== 'unknown' && fact.livemode !== (mode === 'live')) problems.push('it belongs to the other Stripe mode');
        out.push({
          name, ok: problems.length === 0, level: 'blocker',
          note: problems.length === 0 ? 'Exists, active, monthly, and the amount matches.' : `Wrong in Stripe: ${problems.join('; ')}.`,
        });
      }
    }

    // The webhook is where a payment becomes a plan and credits.
    const hooks = f.stripe?.webhooks;
    const target = appUrl ? `${appUrl}/api/stripe/webhook` : '';
    // A custom domain and the host's own address both reach this server, so a
    // webhook pointed at either one is delivered.
    const targets = [f.env.APP_URL, f.env.RENDER_EXTERNAL_URL]
      .filter((u): u is string => !!u)
      .map((u) => `${u.replace(/\/$/, '')}/api/stripe/webhook`);
    if (!hooks) {
      out.push({ name: 'Stripe sends events to this site', ok: false, level: 'warn', note: 'Stripe was not asked about its webhooks.' });
    } else if ('error' in hooks) {
      out.push({
        name: 'Stripe sends events to this site', ok: false, level: 'warn',
        note: `Could not read the webhook list from Stripe (${hooks.error}). Check it by hand: Stripe, Developers, Webhooks. The destination must be ${target || 'this site + /api/stripe/webhook'}.`,
      });
    } else {
      const mine = hooks.filter((h) => targets.includes(h.url.replace(/\/$/, '')));
      const live = mine.find((h) => h.status === 'enabled');
      if (!live) {
        out.push({
          name: 'Stripe sends events to this site', ok: false, level: 'blocker',
          note: mine.length
            ? 'The webhook for this site exists but is disabled in Stripe. Payments are taken and nothing is granted.'
            : `No Stripe webhook points at ${target || 'this site'} in this mode. Payments are taken and nothing is granted. Add it in Stripe, Developers, Webhooks. Test mode and live mode each need their own.`,
        });
      } else {
        const all = live.events.includes('*');
        const missing = all ? [] : REQUIRED_EVENTS.filter((e) => !live.events.includes(e));
        out.push({
          name: 'Stripe sends events to this site', ok: missing.length === 0, level: 'blocker',
          note: missing.length === 0
            ? 'The webhook is enabled and sends every event a subscription needs.'
            : `The webhook is missing: ${missing.join(', ')}. Add ${missing.length === 1 ? 'it' : 'them'} to the destination in Stripe.`,
        });
        const nice = all ? [] : USEFUL_EVENTS.filter((e) => !live.events.includes(e));
        if (nice.length) {
          out.push({
            name: 'Optional Stripe events', ok: false, level: 'warn',
            note: `Not subscribed: ${nice.join(', ')}. Top-ups and new plans still work without them. Adding them lets a slow bank payment finish on its own.`,
          });
        }
      }
    }
  }

  add('Running out of credits pauses output', f.billingEnforced, 'warn',
    'On. An account with no credits stops producing work until it tops up or upgrades. Monitoring keeps running.',
    'Off. The meter records but nothing is ever paused, so work is free after the credits run out.');

  // ── The product itself ──
  add('Connected to real ad and CRM accounts', f.connectorLive, 'blocker',
    'Pipedream is configured. Connections are real.',
    'This server is on the offline mock. Every connected account, campaign and lead shown is invented. Set CONNECTOR=pipedream and the three PIPEDREAM_ values.');

  if (f.connectorLive) {
    add('Customers can connect their own accounts', f.env.PIPEDREAM_ENVIRONMENT === 'production', 'blocker',
      'Pipedream is in production. Also confirm the Pipedream plan includes running actions in production: the free plan lists accounts but refuses to create a campaign.',
      'PIPEDREAM_ENVIRONMENT is not production. Only the Pipedream project owner can connect an account, so no customer can.');
  }

  add('Email can be sent', f.emailReady, 'blocker',
    'Password resets and failed-payment notices are delivered.',
    'No email sender is set. Forgot password sends nothing, so a locked-out customer stays locked out. Set RESEND_API_KEY, or SMTP_HOST and SMTP_FROM.');

  add('AI writing is on', f.textAiReady, 'blocker',
    'Miles writes its own ad copy and readouts.',
    'No AI key is set. Skills and plays return canned demo text instead of real work. Set OPENROUTER_API_KEY.');

  add('Owner tools', set('ADMIN_EMAIL'), 'warn',
    'ADMIN_EMAIL is set, so this page is reachable.',
    'ADMIN_EMAIL is not set. Nobody can open the owner page.');

  add('Google sign-in', set('GOOGLE_CLIENT_ID') && set('GOOGLE_CLIENT_SECRET'), 'warn',
    'Sign in with Google is offered.',
    'Not configured. Email and password sign-up still works.');

  return out;
}

export function summarize(checks: Check[]): { ready: boolean; blockers: number; warnings: number } {
  const blockers = checks.filter((c) => !c.ok && c.level === 'blocker').length;
  const warnings = checks.filter((c) => !c.ok && c.level === 'warn').length;
  return { ready: blockers === 0, blockers, warnings };
}
