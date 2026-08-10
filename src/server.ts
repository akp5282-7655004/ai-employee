import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { Agent, newSession } from './agent/index.js';
import { MockInterpreter } from './agent/intent.js';
import { LlmInterpreter } from './agent/llm.js';
import { getConnector, type Connector } from './connectors/index.js';
import { loadConfig, pipedreamReady } from './config.js';
import { getPack, listPacks, validateIntake } from './packs/index.js';
import { LSA_TRADES, LSA_BLENDED, LSA_VS_GOOGLE, BENCHMARK_META } from './packs/benchmarks.js';
import { generateAdCopy, type CreativeRequest } from './creative/creative.js';
import { falReady, falGenerateImage } from './creative/fal.js';
import { fetchDemographics } from './research/census.js';
import { fetchWeather, evaluateWeatherTriggers } from './research/weather.js';
import { MemorySessionStore, type SessionStore } from './session.js';
import { hashPassword, verifyPassword, newToken, newUserId, parseCookies } from './auth.js';
import { MemoryStore, type Store, type User } from './db/index.js';

/**
 * The real backend — one engine, one source of truth. It serves the app and
 * exposes the agent loop over HTTP so the dashboard runs the *actual* TypeScript
 * engine (packs + planner + connector), not a browser copy (docs/VISION.md §3).
 *
 * The interpreter upgrades automatically: Claude when ANTHROPIC_API_KEY is set,
 * the deterministic mock otherwise. The connector is mock until Pipedream
 * credentials are set. Nothing about the routes changes when either goes live.
 */
export interface ServerDeps {
  store?: SessionStore;
  connector?: Connector;
  /** Persistent store for accounts, sessions, and customer profiles. Pass one
   * already `init()`-ed (Postgres in prod); defaults to in-memory. */
  authStore?: Store;
}

const SESSION_DAYS = 30;

// Served from the repo root (npm start / npm run dev both run from there).
const WEB_DIR = join(process.cwd(), 'web');

export function buildServer(deps: ServerDeps = {}): FastifyInstance {
  const app = Fastify({ logger: false });
  const store = deps.store ?? new MemorySessionStore();
  const connector = deps.connector ?? getConnector();
  const interpreter = process.env.ANTHROPIC_API_KEY ? new LlmInterpreter() : new MockInterpreter();
  const agent = new Agent({ connector, interpreter });

  const authStore = deps.authStore ?? new MemoryStore();

  const readWeb = (name: string, fallback: string) => {
    try {
      const html = readFileSync(join(WEB_DIR, name), 'utf8');
      return html.replace('<body>', '<body>\n<script>window.MILES_SERVER=true;</script>');
    } catch {
      return fallback;
    }
  };
  const dashboardPage = readWeb('index.html', '<!doctype html><title>Miles</title><p>Build the web/ dir.</p>');
  const loginPage = readWeb('login.html', '<!doctype html><title>Miles — Sign in</title><p>Login page missing.</p>');

  // ── auth helpers ──
  const cookie = (token: string, maxAge: number) =>
    `miles_session=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAge}`;
  const startSession = async (reply: FastifyReply, userId: string) => {
    const token = newToken();
    await authStore.createSession({ token, userId, expiresAt: Date.now() + SESSION_DAYS * 86400_000 });
    reply.header('set-cookie', cookie(token, SESSION_DAYS * 86400));
  };
  const getUser = async (req: FastifyRequest): Promise<User | null> => {
    const token = parseCookies(req.headers.cookie)['miles_session'];
    if (!token) return null;
    const s = await authStore.getSession(token);
    return s ? authStore.getUserById(s.userId) : null;
  };
  const requireUser = async (req: FastifyRequest, reply: FastifyReply): Promise<User | null> => {
    const u = await getUser(req);
    if (!u) reply.code(401).send({ error: 'not signed in' });
    return u;
  };

  // ── pages (gated: no account → login) ──
  app.get('/', async (req, reply) => {
    const u = await getUser(req);
    return reply.type('text/html').send(u ? dashboardPage : loginPage);
  });
  app.get('/login', async (_req, reply) => reply.type('text/html').send(loginPage));
  app.get('/favicon.ico', async (_req, reply) => reply.code(204).send());
  app.get('/health', async () => ({ ok: true, interpreter: interpreter.name, connector: connector.name, store: authStore.name }));

  // ── auth ──
  app.post('/auth/signup', async (req, reply) => {
    const b = (req.body ?? {}) as { email?: string; password?: string; name?: string };
    if (!b.email || !b.password || b.password.length < 6)
      return reply.code(400).send({ error: 'Enter an email and a password of at least 6 characters.' });
    if (await authStore.getUserByEmail(b.email))
      return reply.code(409).send({ error: 'An account with that email already exists — try logging in.' });
    const user: User = {
      id: newUserId(),
      email: b.email.toLowerCase(),
      name: b.name,
      passwordHash: hashPassword(b.password),
      createdAt: new Date().toISOString(),
    };
    await authStore.createUser(user);
    await startSession(reply, user.id);
    return { ok: true, user: { id: user.id, email: user.email, name: user.name } };
  });
  app.post('/auth/login', async (req, reply) => {
    const b = (req.body ?? {}) as { email?: string; password?: string };
    const u = b.email ? await authStore.getUserByEmail(b.email) : null;
    if (!u || !verifyPassword(b.password ?? '', u.passwordHash))
      return reply.code(401).send({ error: 'Wrong email or password.' });
    await startSession(reply, u.id);
    return { ok: true, user: { id: u.id, email: u.email, name: u.name } };
  });
  app.post('/auth/logout', async (req, reply) => {
    const token = parseCookies(req.headers.cookie)['miles_session'];
    if (token) await authStore.deleteSession(token);
    reply.header('set-cookie', cookie('', 0));
    return { ok: true };
  });
  app.get('/auth/me', async (req, reply) => {
    const u = await getUser(req);
    if (!u) return reply.code(401).send({ error: 'not signed in' });
    const data = await authStore.getUserData(u.id);
    return { user: { id: u.id, email: u.email, name: u.name }, profile: data.profile ?? null };
  });

  // ── customer profile (the onboarding intake, saved + editable) ──
  app.get('/api/profile', async (req, reply) => {
    const u = await requireUser(req, reply);
    if (!u) return;
    const data = await authStore.getUserData(u.id);
    return { profile: data.profile ?? null };
  });
  app.put('/api/profile', async (req, reply) => {
    const u = await requireUser(req, reply);
    if (!u) return;
    const data = await authStore.getUserData(u.id);
    data.profile = { ...((data.profile as object) ?? {}), ...((req.body as object) ?? {}), updatedAt: new Date().toISOString() };
    await authStore.setUserData(u.id, data);
    return { ok: true, profile: data.profile };
  });

  // Marketing Hub — campaigns/folders holding saved copy + images, per workspace.
  app.get('/api/hub', async (req, reply) => {
    const u = await requireUser(req, reply);
    if (!u) return;
    const data = await authStore.getUserData(u.id);
    return { hub: data.hub ?? { campaigns: [] } };
  });
  app.put('/api/hub', async (req, reply) => {
    const u = await requireUser(req, reply);
    if (!u) return;
    const data = await authStore.getUserData(u.id);
    data.hub = (req.body as { hub?: unknown })?.hub ?? { campaigns: [] };
    await authStore.setUserData(u.id, data);
    return { ok: true };
  });

  // Persisted chat history, per workspace (last 200 turns).
  app.get('/api/chat', async (req, reply) => {
    const u = await requireUser(req, reply);
    if (!u) return;
    const data = await authStore.getUserData(u.id);
    return { messages: (data.chat as unknown[]) ?? [] };
  });
  app.put('/api/chat', async (req, reply) => {
    const u = await requireUser(req, reply);
    if (!u) return;
    const data = await authStore.getUserData(u.id);
    const msgs = (req.body as { messages?: unknown[] })?.messages ?? [];
    data.chat = Array.isArray(msgs) ? msgs.slice(-200) : [];
    await authStore.setUserData(u.id, data);
    return { ok: true };
  });

  // Honest integration status — the Integrations page reads this instead of
  // hard-coded "Connected" badges. Real apps connect through Pipedream, so their
  // status follows whether Pipedream itself is configured.
  app.get<{ Querystring: { sessionId?: string } }>('/api/connections', async (req) => {
    const cfg = loadConfig();
    const pdReady = pipedreamReady(cfg);
    // An app is "connected" only if the user has actually linked that account —
    // we ask the connector for their real accounts, never assume.
    let connectedApps: string[] = [];
    const sessionId = req.query?.sessionId;
    if (sessionId) {
      try {
        const accts = await connector.listAccounts(sessionId);
        connectedApps = [...new Set(accts.map((a) => a.app))];
      } catch {
        /* leave empty on any error */
      }
    }
    return { connector: connector.name, hub: { ready: pdReady }, connectedApps };
  });

  // Mint a Pipedream connect link the customer opens to connect an app account.
  // Pipedream requires the target app in the Connect URL, so we append it.
  app.post<{ Body: { sessionId?: string; app?: string } }>('/api/connect-token', async (req, reply) => {
    const sessionId = req.body?.sessionId;
    const app = req.body?.app;
    if (!sessionId) return reply.code(400).send({ error: 'sessionId required' });
    try {
      const token = await connector.createConnectToken(sessionId);
      let connectUrl = token.connectUrl;
      if (app && connectUrl) {
        connectUrl += (connectUrl.includes('?') ? '&' : '?') + 'app=' + encodeURIComponent(app);
      }
      return { ...token, connectUrl };
    } catch (err) {
      return reply.code(503).send({ error: String((err as Error).message) });
    }
  });

  // The vertical roster — verticals, their categories, and CPA benchmarks (for
  // the tabs + the Meters page).
  app.get('/api/packs', async () =>
    listPacks().map((p) => ({
      id: p.id,
      label: p.label,
      description: p.description,
      cpa: p.economics.cpaBenchmark,
      categories: p.categories.map((c) => ({ id: c.id, label: c.label })),
    })),
  );

  // Browse/search the connector's app catalog (Pipedream's ~3,000 apps), paginated.
  app.get<{ Querystring: { q?: string; limit?: string; after?: string } }>('/api/apps', async (req) => {
    const q = req.query?.q;
    const limit = req.query?.limit ? Math.min(Number(req.query.limit) || 48, 100) : 48;
    try {
      return connector.listApps ? await connector.listApps(q, limit, req.query?.after) : { apps: [] };
    } catch (err) {
      return { apps: [], error: String((err as Error).message) };
    }
  });

  // Market research — real US Census demographics for a ZIP (VISION §5 / #11).
  app.get<{ Querystring: { zip?: string } }>('/api/research', async (req, reply) => {
    const zip = req.query?.zip;
    if (!zip) return reply.code(400).send({ error: 'zip required' });
    try {
      const d = await fetchDemographics(zip);
      if (!d) return reply.code(404).send({ error: 'No Census data for that ZIP — try a 5-digit US ZIP.' });
      return d;
    } catch (err) {
      return reply.code(502).send({ error: String((err as Error).message) });
    }
  });

  // Creative engine — generate ad copy (always) + a real photo when fal.ai is set.
  app.post<{ Body: CreativeRequest }>('/api/creative', async (req) => {
    const body = req.body ?? {};
    const creatives = generateAdCopy(body);
    if (falReady()) {
      await Promise.all(
        creatives.map(async (c) => {
          const url = await falGenerateImage(c.imagePrompt);
          if (url) c.imageUrl = url;
        }),
      );
    }
    return { creatives, imagesLive: falReady() };
  });

  // Real observed LSA economics (SearchLight benchmark) + the breakeven math.
  app.get('/api/benchmarks', async () => ({
    trades: LSA_TRADES,
    blended: LSA_BLENDED,
    vsGoogle: LSA_VS_GOOGLE,
    meta: BENCHMARK_META,
  }));

  // Weather-triggered marketing — live conditions for a ZIP + the campaign
  // actions Miles recommends when weather fires (native, no third-party platform).
  app.get<{ Querystring: { zip?: string; vertical?: string } }>('/api/weather', async (req, reply) => {
    const zip = req.query?.zip;
    if (!zip) return reply.code(400).send({ error: 'zip required' });
    try {
      const w = await fetchWeather(zip);
      if (!w) return reply.code(404).send({ error: 'No weather data for that ZIP — try a 5-digit US ZIP.' });
      return { weather: w, triggers: evaluateWeatherTriggers(w, req.query?.vertical) };
    } catch (err) {
      return reply.code(502).send({ error: String((err as Error).message) });
    }
  });

  // The intake math validator (VISION §5 / feature #14).
  app.post<{ Body: { vertical?: string; monthlyBudget?: number; targetLeads?: number } }>(
    '/api/validate',
    async (req, reply) => {
      const { vertical, monthlyBudget, targetLeads } = req.body ?? {};
      if (typeof monthlyBudget !== 'number' || typeof targetLeads !== 'number') {
        return reply.code(400).send({ error: 'monthlyBudget and targetLeads (numbers) required' });
      }
      return validateIntake(getPack(vertical), monthlyBudget, targetLeads);
    },
  );

  // One turn of the conversation.
  app.post<{ Body: { sessionId?: string; text?: string } }>('/api/message', async (req, reply) => {
    const { sessionId, text } = req.body ?? {};
    if (!sessionId || typeof text !== 'string') return reply.code(400).send({ error: 'sessionId and text required' });
    const session = store.getOrCreate(sessionId);
    const res = await agent.handle(session, text);
    store.save(sessionId, res.session);
    return res.reply;
  });

  // Start a fresh conversation (clears the stored intake/pending for this user).
  app.post<{ Body: { sessionId?: string } }>('/api/reset', async (req, reply) => {
    const u = await getUser(req);
    const id = u?.id ?? req.body?.sessionId;
    if (!id) return reply.code(400).send({ error: 'no session' });
    store.save(id, newSession(id));
    return { ok: true };
  });

  // Connect one or more apps for the user, then run the actions that were blocked.
  app.post<{ Body: { sessionId?: string; actions?: Array<{ actionId: string; app: string; label: string }> } }>(
    '/api/connect-and-run',
    async (req, reply) => {
      const { sessionId, actions } = req.body ?? {};
      if (!sessionId || !Array.isArray(actions)) return reply.code(400).send({ error: 'sessionId and actions required' });
      const launched: string[] = [];
      for (const a of actions) {
        connector.connect?.(sessionId, a.app);
        const r = await connector.runAction({ externalUserId: sessionId, actionId: a.actionId });
        if (r.ok) launched.push(a.label);
      }
      return { launched, apps: [...new Set(actions.map((a) => a.app))] };
    },
  );

  return app;
}
