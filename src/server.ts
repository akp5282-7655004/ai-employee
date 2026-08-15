import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { Agent, newSession } from './agent/index.js';
import { MockInterpreter } from './agent/intent.js';
import { LlmInterpreter } from './agent/llm.js';
import { getConnector, type Connector } from './connectors/index.js';
import { loadConfig, pipedreamReady } from './config.js';
import { getPack, listPacks, validateIntake } from './packs/index.js';
import { LSA_TRADES, LSA_BLENDED, LSA_VS_GOOGLE, BENCHMARK_META, BENCHMARK_HUB, hubCoverage } from './packs/benchmarks.js';
import { generateAdCopy, type CreativeRequest } from './creative/creative.js';
import { falReady, falGenerateImage, falGenerateVideo, falGenerateAudio, type Aspect } from './creative/fal.js';
import { ASSET_TYPES, specFor, buildVisualPrompt, buildTextPrompt, fallbackText, optimizerSystem, type BrandContext } from './creative/studio.js';
import { resolveKit, kitHasGuidance, type BrandKit } from './brand/kit.js';
import { templatedReady, templatedListTemplates, templatedRender, type RenderLayer } from './creative/templated.js';
import { buildRecommendations, type Recommendation } from './agents/recommend.js';
import { adLibraryReady, searchCompetitorAds } from './research/adlibrary.js';
import { CMO_AREAS, AREA_TITLE, strategistPrompt, contentPrompt, socialPrompt, adsPrompt, fallbackStrategist, fallbackContribution, type TeamCtx } from './agents/team.js';
import { classifyRequest, titleFor, emailPrompt, socialPrompt as dwSocialPrompt, adsPrompt as dwAdsPrompt, fallbackWork } from './agents/dowork.js';
import { buildCampaignSpec, validateCampaignSpec, campaignSummary, type CampaignSpec } from './agents/campaign.js';
import { buildGrowthPlan } from './agents/growth.js';
import { generateText, textLlmReady } from './llm/text.js';
import { catalogForClient, findPlay } from './skills/catalog.js';
import {
  TASK_SPECS,
  isDue,
  buildMorningBrief,
  buildCpaReport,
  buildTaskListPrompt,
  fallbackTaskList,
  buildWrapupPrompt,
  fallbackWrapup,
  socialAgent,
  reviewAgent,
  leadAgent,
  competitorAgent,
  seoAgent,
  contentAgent,
  geoAgent,
  metricsLine,
  agentFallback,
  buildAgentDesignPrompt,
  parseAgentSpec,
  fallbackAgentDesign,
  customAgentRun,
  fallbackCustomAgent,
  DATA_SOURCES,
  type CustomAgentSpec,
  type AgentStep,
  type AgentCtx,
  type ScheduledAgent,
  type AgentRun,
  type TaskType,
} from './agents/scheduled.js';
import { fetchDemographics, zipAffluence } from './research/census.js';
import { fetchWeather, evaluateWeatherTriggers } from './research/weather.js';
import { importSite } from './research/site.js';
import { auditSite, buildAuditPrompt, fallbackAuditSummary } from './research/audit.js';
import { applyMeter, summarizeUsage, type MeterKind, type Usage } from './usage/meter.js';
import { modelsForKind, modelById, defaultModel, modelActive, recommendModel, type MediaKind } from './creative/models.js';
import { openaiGenerateImage } from './creative/openai_image.js';
import { higgsfieldGenerateImage, higgsfieldGenerateVideo } from './creative/higgsfield.js';
import { googleGenerateImage } from './creative/google_image.js';
import { PLATFORMS, platformById, postDue, rollupStatus, buildPost, type ScheduledPost, type PostResult } from './posts/schedule.js';
import { recordSnapshot, buildSocialReport, type DailySnapshot } from './agents/social_report.js';
import {
  emptyState as emptyStlState,
  selectNewLeads,
  instantReplyAgent,
  fallbackInstantReply,
  smsFromReply,
  responseSeconds,
  recordContact,
  responderStats,
  type SpeedToLeadState,
} from './agents/speed_to_lead.js';
import { aggregateNetwork, type WorkspaceSignal } from './usage/network.js';
import { deliveryStatus, sendEmail, sendSms, smsExcerpt } from './delivery/send.js';
import { searchCompetitors } from './research/places.js';
import { attributeRevenue } from './revenue/attribution.js';
import { MemorySessionStore, type SessionStore } from './session.js';
import { hashPassword, verifyPassword, newToken, newUserId, parseCookies } from './auth.js';
import { MemoryStore, type Store, type User } from './db/index.js';

/**
 * The real backend — one engine, one source of truth. It serves the app and
 * exposes the agent loop over HTTP so the dashboard runs the *actual* TypeScript
 * engine (packs + planner + connector), not a browser copy (docs/VISION.md §3).
 *
 * The interpreter upgrades automatically: OpenRouter when OPENROUTER_API_KEY is
 * set (one key, every vendor), else Claude when ANTHROPIC_API_KEY is set, else
 * the deterministic mock. The connector is mock until Pipedream credentials are
 * set. Nothing about the routes changes when either goes live.
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

// Read external data through a connector method, degrading to an empty value if the
// method is missing or throws. Keeps a flaky live connector from 500-ing an endpoint
// or — worse — throwing out of a scheduler tick and discarding sibling work.
async function safeConn<T>(fn: (() => Promise<T>) | undefined, empty: T): Promise<T> {
  try {
    return fn ? await fn() : empty;
  } catch {
    return empty;
  }
}

// Render one image with the chosen model (routing by provider), always falling back
// to the reliable default so a premium pick that isn't configured never dead-ends.
async function renderAdImage(prompt: string, modelId?: string): Promise<string | null> {
  const picked = modelById(modelId);
  const chosen = picked && picked.kind === 'image' ? picked : defaultModel('image');
  const def = defaultModel('image');
  const aspect: Aspect = '4:5';
  let url: string | null = null;
  if (chosen.provider === 'higgsfield') url = (await higgsfieldGenerateImage(prompt, { aspect })).url;
  else if (chosen.provider === 'google') url = await googleGenerateImage(prompt, { aspect });
  else if (chosen.provider === 'openai') url = await openaiGenerateImage(prompt, { aspect });
  else url = await falGenerateImage(prompt, { aspect, model: chosen.falModel });
  if (!url && chosen.id !== def.id) url = await falGenerateImage(prompt, { aspect, model: def.falModel });
  return url;
}

export function buildServer(deps: ServerDeps = {}): FastifyInstance {
  const app = Fastify({ logger: false });
  const store = deps.store ?? new MemorySessionStore();
  const connector = deps.connector ?? getConnector();
  const interpreter =
    process.env.OPENROUTER_API_KEY || process.env.ANTHROPIC_API_KEY ? new LlmInterpreter() : new MockInterpreter();
  const agent = new Agent({
    connector,
    interpreter,
    textGen: (system, user) => generateText({ system, user, maxTokens: 900 }),
  });

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

  // ── owner/admin: who runs this workspace ──
  // Admin = the user whose email matches ADMIN_EMAIL, or (if unset) the very first
  // account created. That owner can view/remove users and gate signups.
  const adminEmail = () => (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const adminUserId = async (): Promise<string | null> => {
    const e = adminEmail();
    if (e) return (await authStore.getUserByEmail(e))?.id ?? null;
    return (await authStore.listUsers())[0]?.id ?? null;
  };
  const isAdmin = async (u: User): Promise<boolean> => {
    const e = adminEmail();
    if (e) return u.email.toLowerCase() === e;
    return u.id === (await adminUserId());
  };
  const getAdminSettings = async (): Promise<{ inviteOnly: boolean; allowed: string[] }> => {
    const id = await adminUserId();
    if (!id) return { inviteOnly: false, allowed: [] };
    const data = await authStore.getUserData(id);
    const s = (data.adminSettings ?? {}) as { inviteOnly?: boolean; allowed?: string[] };
    return { inviteOnly: !!s.inviteOnly, allowed: Array.isArray(s.allowed) ? s.allowed : [] };
  };

  // ── pages (gated: no account → login) ──
  app.get('/', async (req, reply) => {
    const u = await getUser(req);
    return reply.type('text/html').send(u ? dashboardPage : loginPage);
  });
  app.get('/login', async (_req, reply) => reply.type('text/html').send(loginPage));
  // ── Public demo — a no-login link that lands on a populated dashboard. It signs
  // the visitor into a shared, isolated demo account seeded with sample data, so
  // anyone can look around Miles without signing up. No real customer data here. ──
  app.get('/demo', async (_req, reply) => {
    let demo = await authStore.getUserByEmail('demo@miles.local');
    if (!demo) {
      demo = { id: newUserId(), email: 'demo@miles.local', name: 'Demo', passwordHash: hashPassword(newToken()), createdAt: new Date().toISOString() };
      await authStore.createUser(demo);
    }
    const data = await authStore.getUserData(demo.id);
    // Re-seed a clean sample business every visit so the demo always looks right.
    data.profile = {
      businessName: 'Painters In Philly',
      industry: 'Painting',
      serviceAreas: 'Philadelphia, PA',
      phone: '(215) 555-0142',
      targetCpa: '30',
      currentOffers: '10% off interior painting',
      services: 'Interior painting, exterior painting, cabinet refinishing',
      updatedAt: new Date().toISOString(),
    };
    data.recState = { applied: {}, dismissed: {} };
    data.deploy = (data.deploy as Record<string, unknown>) ?? { auto: false, queue: [] };
    await authStore.setUserData(demo.id, data);
    // Seed mock-connected accounts so the dashboard shows live-looking data.
    const c = connector as unknown as { name: string; connect?: (u: string, app: string) => unknown; listAccounts: (u: string) => Promise<Array<{ app: string }>> };
    if (c.name === 'mock' && typeof c.connect === 'function') {
      const linked = new Set((await c.listAccounts(demo.id)).map((a) => a.app));
      for (const app of ['google_ads', 'facebook', 'gohighlevel', 'google_my_business', 'gmail']) if (!linked.has(app)) c.connect(demo.id, app);
    }
    await startSession(reply, demo.id);
    return reply.type('text/html').send(dashboardPage);
  });
  app.get('/favicon.ico', async (_req, reply) => reply.code(204).send());
  // Self-hosted third-party assets (the TOAST UI image editor + fabric.js). Served
  // from web/vendor so the editor has no runtime CDN dependency. Read-only, no auth.
  app.get<{ Params: Record<string, string> }>('/vendor/*', async (req, reply) => {
    const rel = req.params['*'] ?? '';
    if (!rel || rel.includes('..') || rel.startsWith('/')) return reply.code(400).send('bad path');
    const ext = rel.slice(rel.lastIndexOf('.') + 1).toLowerCase();
    const types: Record<string, string> = {
      js: 'application/javascript; charset=utf-8',
      css: 'text/css; charset=utf-8',
      svg: 'image/svg+xml',
      png: 'image/png',
      map: 'application/json',
    };
    try {
      const buf = readFileSync(join(WEB_DIR, 'vendor', rel));
      reply.header('content-type', types[ext] ?? 'application/octet-stream');
      reply.header('cache-control', 'public, max-age=86400');
      return reply.send(buf);
    } catch {
      return reply.code(404).send('not found');
    }
  });
  // Scheduler heartbeat — last time the due-tick ran (in-process or via cron).
  let lastTickAt: string | null = null;
  app.get('/health', async () => ({ ok: true, interpreter: interpreter.name, connector: connector.name, store: authStore.name, schedulerLastTick: lastTickAt }));

  // External cron trigger — lets a durable pinger (Render Cron, cron-job.org, a
  // GitHub Action) guarantee the schedule fires even if the in-process timer stalls
  // or the instance sleeps. Protected by CRON_SECRET; a no-op if it isn't configured.
  app.post('/api/cron/tick', async (req, reply) => {
    const secret = process.env.CRON_SECRET;
    if (!secret) return reply.code(503).send({ error: 'Cron not configured — set CRON_SECRET in Render to enable an external heartbeat.' });
    const given = (req.headers['x-cron-secret'] as string) || (req.query as { secret?: string })?.secret;
    if (given !== secret) return reply.code(401).send({ error: 'bad cron secret' });
    const runDue = (app as unknown as { runDueSchedules?: () => Promise<void> }).runDueSchedules;
    if (runDue) await runDue().catch(() => {});
    return { ok: true, ranAt: new Date().toISOString() };
  });

  // ── auth ──
  app.post('/auth/signup', async (req, reply) => {
    const b = (req.body ?? {}) as { email?: string; password?: string; name?: string };
    if (!b.email || !b.password || b.password.length < 6)
      return reply.code(400).send({ error: 'Enter an email and a password of at least 6 characters.' });
    if (await authStore.getUserByEmail(b.email))
      return reply.code(409).send({ error: 'An account with that email already exists — try logging in.' });
    // Invite-only gate (the very first account is always allowed — it becomes the owner).
    const existing = await authStore.listUsers();
    if (existing.length > 0) {
      const settings = await getAdminSettings();
      if (settings.inviteOnly) {
        const email = b.email.toLowerCase();
        const ok = email === adminEmail() || settings.allowed.map((e) => e.toLowerCase()).includes(email);
        if (!ok)
          return reply.code(403).send({ error: 'Sign-ups are invite-only right now. Ask the owner to add your email to the invite list.' });
      }
    }
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
  // Forgot password — email a one-hour reset link (when email delivery is configured).
  // Always returns ok so it never reveals whether an email is registered.
  app.post('/auth/forgot', async (req, reply) => {
    const email = ((req.body as { email?: string })?.email || '').trim().toLowerCase();
    const u = email ? await authStore.getUserByEmail(email) : null;
    if (u) {
      const token = newToken();
      const data = await authStore.getUserData(u.id);
      data.resetToken = { token, exp: Date.now() + 3600_000 };
      await authStore.setUserData(u.id, data);
      const base = (process.env.APP_URL || `https://${req.headers.host}`).replace(/\/$/, '');
      const link = `${base}/login?reset=${token}&uid=${encodeURIComponent(u.id)}`;
      if (deliveryStatus().email) await sendEmail(u.email, 'Reset your Miles password', `Reset your Miles password with this link (expires in 1 hour):\n\n${link}\n\nIf you didn't request this, you can ignore this email.`);
    }
    return { ok: true, emailConfigured: deliveryStatus().email };
  });
  // Complete a reset from the emailed (or admin-generated) link.
  app.post('/auth/reset', async (req, reply) => {
    const b = (req.body ?? {}) as { uid?: string; token?: string; password?: string };
    if (!b.uid || !b.token || !b.password || b.password.length < 6) return reply.code(400).send({ error: 'Enter a new password (at least 6 characters).' });
    const u = await authStore.getUserById(b.uid);
    if (!u) return reply.code(400).send({ error: 'Invalid reset link.' });
    const data = await authStore.getUserData(u.id);
    const rt = data.resetToken as { token?: string; exp?: number } | undefined;
    if (!rt || rt.token !== b.token || !rt.exp || rt.exp < Date.now()) return reply.code(400).send({ error: 'This reset link is invalid or has expired — request a new one.' });
    await authStore.updateUser(u.id, { passwordHash: hashPassword(b.password) });
    delete data.resetToken;
    await authStore.setUserData(u.id, data);
    await startSession(reply, u.id);
    return { ok: true, user: { id: u.id, email: u.email } };
  });
  app.get('/auth/me', async (req, reply) => {
    const u = await getUser(req);
    if (!u) return reply.code(401).send({ error: 'not signed in' });
    const data = await authStore.getUserData(u.id);
    return { user: { id: u.id, email: u.email, name: u.name }, profile: data.profile ?? null, admin: await isAdmin(u) };
  });

  // ── owner admin: list/remove users, gate signups (owner-only) ──
  app.get('/api/admin', async (req, reply) => {
    const u = await requireUser(req, reply);
    if (!u) return;
    if (!(await isAdmin(u))) return { isAdmin: false };
    return { isAdmin: true, adminId: await adminUserId(), users: await authStore.listUsers(), settings: await getAdminSettings() };
  });
  app.post<{ Body: { id?: string } }>('/api/admin/remove', async (req, reply) => {
    const u = await requireUser(req, reply);
    if (!u) return;
    if (!(await isAdmin(u))) return reply.code(403).send({ error: 'owner only' });
    const id = req.body?.id;
    if (!id) return reply.code(400).send({ error: 'id required' });
    if (id === (await adminUserId())) return reply.code(400).send({ error: "You can't remove the owner account." });
    await authStore.deleteUser(id);
    return { ok: true };
  });
  // Owner-only: generate a reset link for a locked-out customer (works with no email provider).
  app.post<{ Body: { id?: string } }>('/api/admin/reset-link', async (req, reply) => {
    const u = await requireUser(req, reply);
    if (!u) return;
    if (!(await isAdmin(u))) return reply.code(403).send({ error: 'owner only' });
    const id = req.body?.id;
    const target = id ? await authStore.getUserById(id) : null;
    if (!target) return reply.code(404).send({ error: 'user not found' });
    const token = newToken();
    const data = await authStore.getUserData(target.id);
    data.resetToken = { token, exp: Date.now() + 3600_000 };
    await authStore.setUserData(target.id, data);
    const base = (process.env.APP_URL || `https://${req.headers.host}`).replace(/\/$/, '');
    return { ok: true, link: `${base}/login?reset=${token}&uid=${encodeURIComponent(target.id)}`, email: target.email };
  });
  app.put<{ Body: { inviteOnly?: boolean; allowed?: string[] } }>('/api/admin/settings', async (req, reply) => {
    const u = await requireUser(req, reply);
    if (!u) return;
    if (!(await isAdmin(u))) return reply.code(403).send({ error: 'owner only' });
    const id = await adminUserId();
    if (!id) return reply.code(400).send({ error: 'no owner resolved' });
    const data = await authStore.getUserData(id);
    data.adminSettings = {
      inviteOnly: !!req.body?.inviteOnly,
      allowed: Array.isArray(req.body?.allowed)
        ? req.body!.allowed!.map((e) => String(e).trim().toLowerCase()).filter((e) => e.includes('@')).slice(0, 500)
        : [],
    };
    await authStore.setUserData(id, data);
    return { ok: true };
  });

  // ── customer feedback: any tester submits; the owner reads it in one inbox ──
  app.post<{ Body: { message?: string; rating?: number; page?: string } }>('/api/feedback', async (req, reply) => {
    const u = await requireUser(req, reply);
    if (!u) return;
    const message = (req.body?.message ?? '').trim().slice(0, 2000);
    if (!message) return reply.code(400).send({ error: 'Say a little about what you think.' });
    const ownerId = await adminUserId();
    if (!ownerId) return { ok: true }; // no owner yet — nothing to store against
    const data = await authStore.getUserData(ownerId);
    const entry = {
      id: newToken().slice(0, 10),
      ts: new Date().toISOString(),
      email: u.email,
      name: u.name ?? '',
      rating: Math.max(0, Math.min(5, Number(req.body?.rating) || 0)),
      page: (req.body?.page ?? '').slice(0, 40),
      message,
      resolved: false,
    };
    data.feedback = [entry, ...((data.feedback as unknown[]) ?? [])].slice(0, 500);
    await authStore.setUserData(ownerId, data);
    return { ok: true };
  });
  app.get('/api/feedback', async (req, reply) => {
    const u = await requireUser(req, reply);
    if (!u) return;
    if (!(await isAdmin(u))) return { isAdmin: false };
    const id = await adminUserId();
    const data = id ? await authStore.getUserData(id) : {};
    return { isAdmin: true, feedback: (data.feedback as unknown[]) ?? [] };
  });
  app.post<{ Body: { id?: string; resolved?: boolean; remove?: boolean } }>('/api/feedback/update', async (req, reply) => {
    const u = await requireUser(req, reply);
    if (!u) return;
    if (!(await isAdmin(u))) return reply.code(403).send({ error: 'owner only' });
    const ownerId = await adminUserId();
    if (!ownerId) return reply.code(400).send({ error: 'no owner' });
    const data = await authStore.getUserData(ownerId);
    let list = (data.feedback as Array<{ id: string; resolved?: boolean }>) ?? [];
    if (req.body?.remove) list = list.filter((f) => f.id !== req.body?.id);
    else list = list.map((f) => (f.id === req.body?.id ? { ...f, resolved: !!req.body?.resolved } : f));
    data.feedback = list;
    await authStore.setUserData(ownerId, data);
    return { ok: true };
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

  // Autopilot — graduated control (autonomy %) + operating settings, per workspace.
  const DEFAULT_GUARDRAILS = { maxBudgetChangePct: 10, protectProven: true, approveHighImpact: true };
  app.get('/api/autopilot', async (req, reply) => {
    const u = await requireUser(req, reply);
    if (!u) return;
    const data = await authStore.getUserData(u.id);
    const ap = (data.autopilot as any) ?? {};
    return { autopilot: { autonomy: ap.autonomy ?? 50, guardrails: { ...DEFAULT_GUARDRAILS, ...(ap.guardrails ?? {}) } } };
  });
  app.put<{ Body: { autopilot?: any } }>('/api/autopilot', async (req, reply) => {
    const u = await requireUser(req, reply);
    if (!u) return;
    const data = await authStore.getUserData(u.id);
    const a = req.body?.autopilot ?? {};
    const lvl = Number(a.autonomy);
    const g = a.guardrails ?? {};
    data.autopilot = {
      autonomy: [10, 20, 50, 100].includes(lvl) ? lvl : 50,
      guardrails: {
        maxBudgetChangePct: [5, 10, 15, 25, 100].includes(Number(g.maxBudgetChangePct)) ? Number(g.maxBudgetChangePct) : 10,
        protectProven: !!g.protectProven,
        approveHighImpact: g.approveHighImpact !== false,
      },
    };
    await authStore.setUserData(u.id, data);
    return { ok: true, autopilot: data.autopilot };
  });

  // Installed skills (Marketplace bundles) for the workspace.
  app.get('/api/skills', async (req, reply) => {
    const u = await requireUser(req, reply);
    if (!u) return;
    const data = await authStore.getUserData(u.id);
    return { installed: (data.skills as string[]) ?? [], catalog: catalogForClient(), textLive: textLlmReady() };
  });
  app.put<{ Body: { installed?: string[] } }>('/api/skills', async (req, reply) => {
    const u = await requireUser(req, reply);
    if (!u) return;
    const data = await authStore.getUserData(u.id);
    data.skills = Array.isArray(req.body?.installed) ? req.body!.installed!.slice(0, 200) : [];
    await authStore.setUserData(u.id, data);
    return { ok: true };
  });
  // Run one of a skill's plays — real expert output from the LLM, on-brand from the
  // business profile. Demo-safe: falls back to a templated deliverable with no key.
  app.post<{ Body: { skillId?: string; playId?: string } }>('/api/skills/play', async (req, reply) => {
    const u = await requireUser(req, reply);
    if (!u) return;
    const match = findPlay(req.body?.skillId ?? '', req.body?.playId ?? '');
    if (!match) return reply.code(404).send({ error: 'play not found' });
    const data = await authStore.getUserData(u.id);
    const p = (data.profile ?? {}) as Record<string, string>;
    const biz = p.businessName || 'the business';
    const trade = (p.industry || 'local-service').toString();
    const svc = p.services ? ` Services: ${p.services}.` : '';
    const loc = p.serviceAreas ? ` Area: ${p.serviceAreas}.` : '';
    const user = `Business: ${biz} (${trade}).${svc}${loc}`;
    const text = await generateText({ system: match.play.system, user, maxTokens: 900 });
    if (text) return { text, live: true, skill: match.skill.name, play: match.play.label, push: match.play.push ?? null };
    return {
      text: `“${match.play.label}” is ready to generate. Add an OpenRouter key on Render and Miles will write this custom for ${biz} — expert ${match.skill.category.toLowerCase()} output, on-brand, in seconds.`,
      live: false,
      skill: match.skill.name,
      play: match.play.label,
      push: match.play.push ?? null,
    };
  });
  // Push a skill's output to a connected app (e.g. send a review-request SMS via the
  // CRM). Honest: holds if the app isn't connected instead of pretending it sent.
  app.post<{ Body: { skillId?: string; playId?: string; text?: string; recipient?: string } }>('/api/skills/push', async (req, reply) => {
    const u = await requireUser(req, reply);
    if (!u) return;
    const match = findPlay(req.body?.skillId ?? '', req.body?.playId ?? '');
    if (!match?.play.push) return reply.code(400).send({ error: 'This play can’t be pushed to an app.' });
    const text = (req.body?.text ?? '').trim();
    if (!text) return reply.code(400).send({ error: 'Nothing to send.' });
    if (!connector.runAppTask) return reply.code(400).send({ error: 'Live actions need the connector — configure Pipedream.' });
    const r = await connector.runAppTask({ externalUserId: u.id, app: match.play.push.app, query: match.play.push.verb, params: { message: text, phone: (req.body?.recipient ?? '').trim() } });
    return { ok: !!r.ok, note: r.note || r.summary || (r.ok ? 'Sent.' : 'Could not send.'), held: !r.ok };
  });

  // ── settings: account, API keys, team, usage ──
  app.get('/api/settings', async (req, reply) => {
    const u = await requireUser(req, reply);
    if (!u) return;
    const data = await authStore.getUserData(u.id);
    const keys = ((data.apiKeys as any[]) ?? []).map((k) => ({
      id: k.id, name: k.name, createdAt: k.createdAt,
      masked: 'miles_sk_…' + String(k.key || '').slice(-4),
    }));
    const team = (data.team as any[]) ?? [{ email: u.email, role: 'Owner', status: 'active' }];
    return { account: { name: u.name ?? '', email: u.email }, keys, team };
  });
  app.put<{ Body: { name?: string } }>('/api/account', async (req, reply) => {
    const u = await requireUser(req, reply);
    if (!u) return;
    await authStore.updateUser(u.id, { name: (req.body?.name ?? '').slice(0, 120) });
    return { ok: true };
  });
  app.post<{ Body: { current?: string; next?: string } }>('/auth/change-password', async (req, reply) => {
    const u = await requireUser(req, reply);
    if (!u) return;
    const b = req.body ?? {};
    if (!b.next || b.next.length < 6) return reply.code(400).send({ error: 'New password must be at least 6 characters.' });
    if (!verifyPassword(b.current ?? '', u.passwordHash)) return reply.code(401).send({ error: 'Your current password is wrong.' });
    await authStore.updateUser(u.id, { passwordHash: hashPassword(b.next) });
    return { ok: true };
  });
  app.post<{ Body: { name?: string } }>('/api/keys', async (req, reply) => {
    const u = await requireUser(req, reply);
    if (!u) return;
    const data = await authStore.getUserData(u.id);
    const key = 'miles_sk_' + newToken();
    const entry = { id: newToken().slice(0, 12), name: (req.body?.name || 'API key').slice(0, 60), key, createdAt: new Date().toISOString() };
    data.apiKeys = [...((data.apiKeys as any[]) ?? []), entry];
    await authStore.setUserData(u.id, data);
    return { ok: true, key, id: entry.id, name: entry.name };
  });
  app.post<{ Body: { id?: string } }>('/api/keys/delete', async (req, reply) => {
    const u = await requireUser(req, reply);
    if (!u) return;
    const data = await authStore.getUserData(u.id);
    data.apiKeys = ((data.apiKeys as any[]) ?? []).filter((k) => k.id !== req.body?.id);
    await authStore.setUserData(u.id, data);
    return { ok: true };
  });
  app.put<{ Body: { team?: unknown[] } }>('/api/team', async (req, reply) => {
    const u = await requireUser(req, reply);
    if (!u) return;
    const data = await authStore.getUserData(u.id);
    data.team = Array.isArray(req.body?.team) ? req.body!.team!.slice(0, 50) : [];
    await authStore.setUserData(u.id, data);
    return { ok: true };
  });
  // Model Router setting — Auto vs Manual + quality tier (spec §8), per workspace.
  app.get('/api/model', async (req, reply) => {
    const u = await requireUser(req, reply);
    if (!u) return;
    const data = await authStore.getUserData(u.id);
    return { model: data.model ?? { mode: 'auto', quality: 'balanced' } };
  });
  app.put<{ Body: { model?: { mode?: string; quality?: string; manualModel?: string } } }>('/api/model', async (req, reply) => {
    const u = await requireUser(req, reply);
    if (!u) return;
    const data = await authStore.getUserData(u.id);
    const m = req.body?.model ?? {};
    data.model = {
      mode: m.mode === 'manual' ? 'manual' : 'auto',
      quality: ['value', 'balanced', 'max'].includes(m.quality ?? '') ? m.quality : 'balanced',
      manualModel: typeof m.manualModel === 'string' ? m.manualModel.slice(0, 100) : undefined,
    };
    await authStore.setUserData(u.id, data);
    return { ok: true, model: data.model };
  });

  // Credit metering — bump the current-month usage on the loaded blob (caller saves).
  // Pass `credits` to override the flat per-kind cost (e.g. a specific media model).
  const bumpMeter = (data: Record<string, unknown>, kind: MeterKind, n = 1, credits?: number): void => {
    data.usage = applyMeter(data.usage as Usage | undefined, kind, new Date(), n, credits);
  };
  // For endpoints that don't otherwise persist: load, meter, save.
  const meterUser = async (userId: string, kind: MeterKind, n = 1, credits?: number): Promise<void> => {
    const d = await authStore.getUserData(userId);
    bumpMeter(d, kind, n, credits);
    await authStore.setUserData(userId, d);
  };

  app.get('/api/usage', async (req, reply) => {
    const u = await requireUser(req, reply);
    if (!u) return;
    const d = await authStore.getUserData(u.id);
    const hub = (d.hub as any) ?? { campaigns: [] };
    const campaigns = (hub.campaigns ?? []).length;
    const savedAds = (hub.campaigns ?? []).reduce((n: number, c: any) => n + (c.items?.length ?? 0), 0);
    const triggers = ((d.weatherRules as any[]) ?? []).length;
    const deploys = ((d.deploy as any)?.queue ?? []).filter((c: any) => c.status === 'live').length;
    const chats = ((d.chat as any[]) ?? []).length;
    const meter = summarizeUsage(d.usage as Usage | undefined, new Date());
    return { campaigns, savedAds, triggers, deploys, chats, meter };
  });

  // Network learning — anonymized, cross-workspace benchmarks (numbers only, no PII).
  app.get('/api/network', async (req, reply) => {
    const u = await requireUser(req, reply);
    if (!u) return;
    const mine = (await authStore.getUserData(u.id)).profile as Record<string, string> | undefined;
    const yourTrade = mine?.industry;
    let ids: string[] = [];
    try {
      ids = await authStore.listUserIds();
    } catch {
      ids = [];
    }
    const signals: WorkspaceSignal[] = [];
    for (const id of ids) {
      try {
        const d = await authStore.getUserData(id);
        const p = (d.profile ?? {}) as Record<string, string>;
        const agents = (d.schedules as Array<{ task: string }>) ?? [];
        const runs = ((d.agentRuns as unknown[]) ?? []).length;
        signals.push({ trade: p.industry, agentTasks: agents.map((a) => a.task), targetCpa: Number(p.targetCpa) || undefined, agentRuns: runs });
      } catch {
        /* skip a workspace we can't read */
      }
    }
    return { network: aggregateNetwork(signals, yourTrade) };
  });

  // Delivery — which channels (email/SMS) are live, based on configured provider keys.
  app.get('/api/delivery/status', async (req, reply) => {
    const u = await requireUser(req, reply);
    if (!u) return;
    return { status: deliveryStatus() };
  });

  // Overview dashboard — everything at a glance, from real workspace data. Numbers
  // that need a connected tool say "connect" rather than showing a fake figure.
  app.get<{ Querystring: { range?: string } }>('/api/dashboard', async (req, reply) => {
    const u = await requireUser(req, reply);
    if (!u) return;
    // Marketing date window. Only accept known Google-Ads-style presets.
    const RANGES = new Set(['LAST_7_DAYS', 'LAST_14_DAYS', 'LAST_30_DAYS', 'THIS_MONTH', 'LAST_MONTH']);
    const range = RANGES.has(String(req.query?.range)) ? String(req.query?.range) : 'LAST_30_DAYS';
    const d = await authStore.getUserData(u.id);
    const p = (d.profile ?? {}) as Record<string, string>;
    const q = ((d.deploy as { queue?: Array<{ status?: string; ts?: string; label?: string; type?: string }> })?.queue) ?? [];
    const runs = (d.agentRuns as AgentRun[]) ?? [];
    const posts = (d.scheduledPosts as ScheduledPost[]) ?? [];
    const agents = (d.schedules as ScheduledAgent[]) ?? [];
    // Resolve the selected preset to a concrete [start,end] window so every
    // date-based metric on the dashboard moves together. Items without a parseable
    // timestamp are kept (we can't place them), never silently dropped.
    const nowMs = Date.now();
    const win = (() => {
      if (range === 'THIS_MONTH') { const dt = new Date(); return { start: new Date(dt.getFullYear(), dt.getMonth(), 1).getTime(), end: nowMs }; }
      if (range === 'LAST_MONTH') { const dt = new Date(); return { start: new Date(dt.getFullYear(), dt.getMonth() - 1, 1).getTime(), end: new Date(dt.getFullYear(), dt.getMonth(), 1).getTime() }; }
      const days = range === 'LAST_7_DAYS' ? 7 : range === 'LAST_14_DAYS' ? 14 : 30;
      return { start: nowMs - days * 86_400_000, end: nowMs };
    })();
    const inWin = (ts?: string) => { const t = Date.parse(ts || ''); return !Number.isFinite(t) || (t >= win.start && t <= win.end); };
    const safe = async <T,>(fn: (() => Promise<T>) | undefined, empty: T): Promise<T> => { try { return fn ? await fn() : empty; } catch { return empty; } };
    const spend = await safe(connector.getAdSpend ? () => connector.getAdSpend!(u.id, range) : undefined, [] as import('./revenue/attribution.js').CampaignSpend[]);
    const deals = await safe(connector.getDeals ? () => connector.getDeals!(u.id) : undefined, [] as import('./revenue/attribution.js').Deal[]);
    const leads = await safe(connector.getLeads ? () => connector.getLeads!(u.id) : undefined, [] as import('./connectors/types.js').Lead[]);
    const reviews = await safe(connector.getReviews ? () => connector.getReviews!(u.id) : undefined, [] as import('./connectors/types.js').Review[]);
    const social = await safe(connector.getSocialMetrics ? () => connector.getSocialMetrics!(u.id) : undefined, null as import('./connectors/types.js').SocialMetrics | null);
    const totalSpend = spend.reduce((s, x) => s + (x.spend || 0), 0);
    const totalConv = spend.reduce((s, x) => s + (x.conversions || 0), 0);
    const leadsWin = leads.filter((l) => inWin(l.createdAt));
    const revenue = deals.filter((x) => x.won && inWin(x.createdAt)).reduce((s, x) => s + (x.value || 0), 0);
    // Which apps are actually LINKED (OAuth done) — separate from whether data has
    // synced yet, so a connected-but-empty card says "connected, syncing", not "connect".
    let linked = new Set<string>();
    try {
      linked = new Set((await connector.listAccounts(u.id)).map((a) => a.app));
    } catch {
      /* none */
    }
    const has = (...apps: string[]) => apps.some((a) => linked.has(a));
    const adsLinked = has('google_ads', 'facebook', 'google_lsa');
    const crmLinked = has('gohighlevel', 'hubspot', 'salesforce_rest_api', 'servicetitan', 'jobber', 'housecall_pro');
    const gmbLinked = has('google_my_business', 'gmb');
    const socialLinked = has('facebook', 'instagram', 'linkedin');
    return {
      business: p.businessName || '',
      range,
      kpis: {
        pendingApprovals: q.filter((c) => c.status === 'pending').length,
        liveChanges: q.filter((c) => c.status === 'live').length,
        agentsDeployed: agents.length,
        agentRuns: runs.filter((r) => inWin(r.ts)).length,
        scheduledPosts: posts.filter((x) => x.status === 'scheduled').length,
        publishedPosts: posts.filter((x) => x.status === 'published').length,
        creditsUsed: summarizeUsage(d.usage as Usage | undefined, new Date()).credits,
        weatherTriggers: ((d.weatherRules as Array<{ enabled?: boolean }>) ?? []).filter((r) => r.enabled).length,
      },
      marketing: { connected: adsLinked || spend.length > 0, hasData: spend.length > 0, range, spend: Math.round(totalSpend), conversions: totalConv, cpa: totalConv ? Math.round((totalSpend / totalConv) * 100) / 100 : null, revenue: Math.round(revenue), targetCpa: Number(p.targetCpa) || null },
      leads: { connected: crmLinked || leads.length > 0, hasData: leadsWin.length > 0, count: leadsWin.length, uncontacted: leadsWin.filter((l) => !l.contacted).length },
      speedToLead: responderStats(d.speedToLead as SpeedToLeadState | undefined, new Date().toISOString()),
      reviews: { connected: gmbLinked || reviews.length > 0, hasData: reviews.length > 0, count: reviews.length, avg: reviews.length ? Math.round((reviews.reduce((s, r) => s + (r.rating || 0), 0) / reviews.length) * 10) / 10 : null },
      social: social ? { connected: true, hasData: true, ...social } : (socialLinked ? { connected: true, hasData: false, impressions: 0, clicks: 0, likes: 0, followers: 0 } : null),
      upcomingPosts: posts.filter((x) => x.status === 'scheduled').sort((a, b) => Date.parse(a.scheduledAt) - Date.parse(b.scheduledAt)).slice(0, 5).map((x) => ({ caption: x.caption, platforms: x.platforms, scheduledAt: x.scheduledAt, kind: x.kind })),
      recentRuns: runs.slice(0, 6).map((r) => ({ title: r.title, ts: r.ts, task: r.task })),
    };
  });

  // Diagnostic — confirm a connected app actually returns live data (and expose the
  // raw shape so the field mapping can be locked in). Reads only the caller's own data.
  app.get<{ Querystring: { app?: string; query?: string } }>('/api/diag/probe', async (req, reply) => {
    const u = await requireUser(req, reply);
    if (!u) return;
    const app = (req.query?.app || 'google_ads').toString();
    let linked: string[] = [];
    try {
      linked = [...new Set((await connector.listAccounts(u.id)).map((a) => a.app))];
    } catch {
      /* none */
    }
    const probe = connector.probe ? await connector.probe(u.id, app, req.query?.query) : { connected: linked.includes(app), count: 0, sample: null, error: 'probe not supported by this connector' };
    return { connector: connector.name, requestedApp: app, connectedApps: linked, probe };
  });

  // Marketing Hub — campaigns/folders holding saved copy + images, per workspace.
  // Ads Manager — per-campaign live view (spend, clicks, leads, CPC, cost/lead)
  // across the selected window, tuned to home-services metrics (not e-commerce).
  app.get<{ Querystring: { range?: string } }>('/api/ads/campaigns', async (req, reply) => {
    const u = await requireUser(req, reply);
    if (!u) return;
    const RANGES = new Set(['LAST_7_DAYS', 'LAST_14_DAYS', 'LAST_30_DAYS', 'THIS_MONTH', 'LAST_MONTH']);
    const range = RANGES.has(String(req.query?.range)) ? String(req.query?.range) : 'LAST_30_DAYS';
    const spend = await safeConn(connector.getAdSpend ? () => connector.getAdSpend!(u.id, range) : undefined, [] as import('./revenue/attribution.js').CampaignSpend[]);
    const deals = await safeConn(connector.getDeals ? () => connector.getDeals!(u.id) : undefined, [] as import('./revenue/attribution.js').Deal[]);
    let connected = false;
    try { connected = (await connector.listAccounts(u.id)).some((a) => ['google_ads', 'facebook', 'google_lsa'].includes(a.app)); } catch { /* none */ }
    const r2 = (n: number) => Math.round(n * 100) / 100;
    const revFor = (utm: string, name: string) => { const k = (utm || name || '').toLowerCase(); return deals.filter((d) => d.won && (d.value || 0) > 0 && String(d.utmCampaign || '').toLowerCase() === k).reduce((s, d) => s + (d.value || 0), 0); };
    const campaigns = spend
      .map((c) => {
        const s = Math.round(c.spend || 0); const clicks = c.clicks || 0; const conv = c.conversions || 0; const revenue = Math.round(revFor(c.utm || '', c.campaign));
        return { platform: c.platform, name: c.campaign, spend: s, clicks, leads: conv, revenue, roas: s ? r2(revenue / s) : null, cpc: clicks ? r2(s / clicks) : null, costPerLead: conv ? r2(s / conv) : null };
      })
      .sort((a, b) => b.spend - a.spend);
    const totSpend = campaigns.reduce((a, c) => a + c.spend, 0);
    const totClicks = campaigns.reduce((a, c) => a + c.clicks, 0);
    const totLeads = campaigns.reduce((a, c) => a + c.leads, 0);
    const totRev = campaigns.reduce((a, c) => a + c.revenue, 0);
    return {
      connected, hasData: campaigns.length > 0, range,
      totals: { spend: totSpend, clicks: totClicks, leads: totLeads, revenue: totRev, roas: totSpend ? r2(totRev / totSpend) : null, roiPct: totSpend ? Math.round(((totRev - totSpend) / totSpend) * 100) : null, cpc: totClicks ? r2(totSpend / totClicks) : null, costPerLead: totLeads ? r2(totSpend / totLeads) : null },
      campaigns,
    };
  });

  // Offline conversion upload — report won jobs back to Google Ads so Smart
  // Bidding optimizes toward leads that become paying customers, not just clicks.
  const eligibleDeals = (deals: import('./revenue/attribution.js').Deal[]) =>
    deals.filter((d) => d.won && (d.value || 0) > 0 && (d.gclid || d.email || d.phone));
  app.get('/api/conversions/preview', async (req, reply) => {
    const u = await requireUser(req, reply);
    if (!u) return;
    const deals = await safeConn(connector.getDeals ? () => connector.getDeals!(u.id) : undefined, [] as import('./revenue/attribution.js').Deal[]);
    let connected = false, hasCrm = false;
    try { const apps = new Set((await connector.listAccounts(u.id)).map((a) => a.app)); connected = apps.has('google_ads'); hasCrm = ['gohighlevel', 'hubspot', 'salesforce_rest_api', 'servicetitan', 'jobber', 'housecall_pro'].some((a) => apps.has(a)); } catch { /* none */ }
    const won = deals.filter((d) => d.won && (d.value || 0) > 0);
    const eligible = eligibleDeals(deals);
    const mask = (d: import('./revenue/attribution.js').Deal) => d.gclid ? 'Google Click ID' : d.email ? `${d.email[0]}•••@${d.email.split('@')[1] ?? ''}` : d.phone ? `•••${d.phone.slice(-4)}` : '—';
    return {
      connected, hasCrm,
      count: eligible.length,
      ineligible: won.length - eligible.length,
      totalValue: Math.round(eligible.reduce((s, d) => s + (d.value || 0), 0)),
      items: eligible.slice(0, 100).map((d) => ({ dealId: d.id, value: Math.round(d.value || 0), source: d.utmSource || '—', match: d.gclid ? 'GCLID' : d.email ? 'Email' : 'Phone', identifier: mask(d), wonAt: d.wonAt || d.createdAt })),
    };
  });
  app.post<{ Body: { confirm?: boolean; dealIds?: string[] } }>('/api/conversions/upload', async (req, reply) => {
    const u = await requireUser(req, reply);
    if (!u) return;
    if (req.body?.confirm !== true) return reply.code(400).send({ error: 'Explicit confirm required.' });
    if (!connector.uploadOfflineConversions) return reply.code(400).send({ error: 'This connector cannot upload conversions.' });
    const deals = await safeConn(connector.getDeals ? () => connector.getDeals!(u.id) : undefined, [] as import('./revenue/attribution.js').Deal[]);
    let eligible = eligibleDeals(deals);
    if (Array.isArray(req.body?.dealIds) && req.body!.dealIds!.length) { const ids = new Set(req.body!.dealIds); eligible = eligible.filter((d) => ids.has(d.id)); }
    if (!eligible.length) return reply.code(400).send({ error: 'No eligible won jobs to upload (need a Google Click ID, email, or phone + a value).' });
    const items = eligible.map((d) => ({ dealId: d.id, value: d.value, gclid: d.gclid, email: d.email, phone: d.phone, conversionTime: d.wonAt || d.createdAt }));
    const result = await connector.uploadOfflineConversions(u.id, items);
    const data = await authStore.getUserData(u.id);
    const deploy = (data.deploy as { auto?: boolean; queue?: any[] }) ?? { auto: false, queue: [] };
    deploy.queue = Array.isArray(deploy.queue) ? deploy.queue : [];
    deploy.queue.unshift({ id: newToken().slice(0, 10), label: `Offline conversions → Google Ads (${result.uploaded}/${items.length} jobs, $${items.reduce((s, i) => s + i.value, 0).toLocaleString()})`, type: 'conversion', status: result.ok ? (result.live ? 'live' : 'pending') : 'reverted', ts: new Date().toISOString(), detail: result.note });
    data.deploy = deploy; await authStore.setUserData(u.id, data);
    if (result.live && result.uploaded) await meterUser(u.id, 'agent_run');
    return result;
  });

  app.get('/api/hub', async (req, reply) => {
    const u = await requireUser(req, reply);
    if (!u) return;
    const data = await authStore.getUserData(u.id);
    return { hub: data.hub ?? { campaigns: [] } };
  });

  // ── Growth Autopilot — analyze campaigns (ROI/ROAS vs target) and propose
  // budget moves that respect the owner's autonomy + guardrails. Apply is gated. ──
  app.get<{ Querystring: { range?: string } }>('/api/growth/plan', async (req, reply) => {
    const u = await requireUser(req, reply);
    if (!u) return;
    const RANGES = new Set(['LAST_7_DAYS', 'LAST_14_DAYS', 'LAST_30_DAYS', 'THIS_MONTH', 'LAST_MONTH']);
    const range = RANGES.has(String(req.query?.range)) ? String(req.query?.range) : 'LAST_30_DAYS';
    const data = await authStore.getUserData(u.id);
    const p = (data.profile ?? {}) as Record<string, string>;
    const ap = (data.autopilot as any) ?? {};
    const guardrails = { maxBudgetChangePct: 10, protectProven: true, ...(ap.guardrails ?? {}) };
    const spend = await safeConn(connector.getAdSpend ? () => connector.getAdSpend!(u.id, range) : undefined, [] as import('./revenue/attribution.js').CampaignSpend[]);
    const deals = await safeConn(connector.getDeals ? () => connector.getDeals!(u.id) : undefined, [] as import('./revenue/attribution.js').Deal[]);
    let connected = false;
    try { connected = (await connector.listAccounts(u.id)).some((a) => ['google_ads', 'facebook', 'google_lsa'].includes(a.app)); } catch { /* none */ }
    const plan = buildGrowthPlan(spend, deals, { targetCpa: Number(p.targetCpa) || null, guardrailPct: Number(guardrails.maxBudgetChangePct) || 10, protectProven: !!guardrails.protectProven, autonomy: Number(ap.autonomy) || 50 });
    return { connected, hasData: spend.length > 0, range, ...plan };
  });

  app.post<{ Body: { confirm?: boolean; changes?: import('./connectors/types.js').BudgetChange[] } }>('/api/growth/apply', async (req, reply) => {
    const u = await requireUser(req, reply);
    if (!u) return;
    if (req.body?.confirm !== true) return reply.code(400).send({ error: 'Explicit confirm required — no budget moves without it.' });
    const changes = (Array.isArray(req.body?.changes) ? req.body!.changes! : []).filter((c) => c && c.campaign && c.action && c.action !== 'hold').slice(0, 50);
    if (!changes.length) return reply.code(400).send({ error: 'No budget moves to apply.' });
    if (!connector.adjustCampaignBudgets) return reply.code(400).send({ error: 'This connector cannot adjust budgets.' });
    const data = await authStore.getUserData(u.id);
    const autonomy = Number((data.autopilot as any)?.autonomy) || 50;
    const result = await connector.adjustCampaignBudgets(u.id, changes);
    // Log every approved move to the deploy/change log (pending unless full autonomy).
    const deploy = (data.deploy as { auto?: boolean; queue?: any[] }) ?? { auto: false, queue: [] };
    deploy.queue = Array.isArray(deploy.queue) ? deploy.queue : [];
    const status = result.live && result.ok ? 'live' : autonomy >= 100 && result.ok ? 'live' : 'pending';
    deploy.queue.unshift({
      id: newToken().slice(0, 10),
      label: `Growth Autopilot — ${changes.length} budget move${changes.length === 1 ? '' : 's'} (${changes.filter((c) => c.action === 'scale').length} scale, ${changes.filter((c) => c.action === 'cut' || c.action === 'pause').length} cut/pause)`,
      type: 'budget',
      status,
      ts: new Date().toISOString(),
      detail: changes.map((c) => `${c.action === 'scale' ? '▲' : c.action === 'pause' ? '⏸' : '▼'} ${c.campaign}: ${c.action}${c.deltaPct ? ' ' + (c.deltaPct > 0 ? '+' : '') + c.deltaPct + '%' : ''}`).join('\n') + (result.note ? '\n\n' + result.note : ''),
    });
    deploy.queue = deploy.queue.slice(0, 300);
    data.deploy = deploy;
    await authStore.setUserData(u.id, data);
    if (result.live && result.applied) await meterUser(u.id, 'agent_run');
    return { ...result, queuedStatus: status };
  });
  app.put('/api/hub', async (req, reply) => {
    const u = await requireUser(req, reply);
    if (!u) return;
    const data = await authStore.getUserData(u.id);
    data.hub = (req.body as { hub?: unknown })?.hub ?? { campaigns: [] };
    await authStore.setUserData(u.id, data);
    return { ok: true };
  });

  // Brand assets — logo, brand info, services, and uploaded photos (first-party
  // data used to generate on-brand ads). Stored per workspace.
  app.get('/api/assets', async (req, reply) => {
    const u = await requireUser(req, reply);
    if (!u) return;
    const data = await authStore.getUserData(u.id);
    return { assets: data.assets ?? { photos: [] } };
  });
  app.put('/api/assets', async (req, reply) => {
    const u = await requireUser(req, reply);
    if (!u) return;
    const data = await authStore.getUserData(u.id);
    data.assets = (req.body as { assets?: unknown })?.assets ?? { photos: [] };
    await authStore.setUserData(u.id, data);
    return { ok: true };
  });

  // Customer-defined weather triggers (condition → action), per workspace.
  app.get('/api/weather-rules', async (req, reply) => {
    const u = await requireUser(req, reply);
    if (!u) return;
    const data = await authStore.getUserData(u.id);
    return { rules: (data.weatherRules as unknown[]) ?? [] };
  });
  app.put('/api/weather-rules', async (req, reply) => {
    const u = await requireUser(req, reply);
    if (!u) return;
    const data = await authStore.getUserData(u.id);
    const rules = (req.body as { rules?: unknown[] })?.rules ?? [];
    data.weatherRules = Array.isArray(rules) ? rules.slice(0, 100) : [];
    await authStore.setUserData(u.id, data);
    return { ok: true };
  });

  // Import brand data from a customer's website to pre-fill their Assets.
  app.post<{ Body: { url?: string } }>('/api/import-site', async (req, reply) => {
    const u = await requireUser(req, reply);
    if (!u) return;
    const url = req.body?.url;
    if (!url) return reply.code(400).send({ error: 'url required' });
    try {
      const d = await importSite(url);
      if (!d) return reply.code(404).send({ error: 'Couldn’t read that site — check the URL and try again.' });
      return d;
    } catch (err) {
      return reply.code(502).send({ error: String((err as Error).message) });
    }
  });

  // Website audit — crawl a site and score it, with a plain-English fix plan.
  app.post<{ Body: { url?: string } }>('/api/audit', async (req, reply) => {
    const u = await requireUser(req, reply);
    if (!u) return;
    const data = await authStore.getUserData(u.id);
    const p = (data.profile ?? {}) as Record<string, string>;
    const url = (req.body?.url || p.website || '').trim();
    if (!url) return reply.code(400).send({ error: 'Enter a website URL (or add one to your Business Profile).' });
    try {
      const result = await auditSite(url);
      if (!result) return reply.code(404).send({ error: 'Couldn’t reach that site — check the URL and try again.' });
      const { system, user } = buildAuditPrompt(result, p.businessName);
      const summary = (await generateText({ system, user, maxTokens: 700 })) ?? fallbackAuditSummary(result);
      await meterUser(u.id, 'audit');
      return { ...result, summary };
    } catch (err) {
      return reply.code(502).send({ error: String((err as Error).message) });
    }
  });

  // Deploy queue — staged marketing changes + auto-deploy flag, per workspace.
  app.get('/api/deploy', async (req, reply) => {
    const u = await requireUser(req, reply);
    if (!u) return;
    const data = await authStore.getUserData(u.id);
    return { deploy: data.deploy ?? { auto: false, queue: [] } };
  });
  app.put('/api/deploy', async (req, reply) => {
    const u = await requireUser(req, reply);
    if (!u) return;
    const data = await authStore.getUserData(u.id);
    const d = (req.body as { deploy?: any })?.deploy ?? { auto: false, queue: [] };
    if (Array.isArray(d.queue)) d.queue = d.queue.slice(0, 300);
    data.deploy = d;
    await authStore.setUserData(u.id, data);
    return { ok: true };
  });

  // ── "Miles, do this" — a plain-language request becomes a finished draft ───
  // Miles picks the workflow, builds it on-brand, and drops it in the review queue.
  app.post<{ Body: { request?: string } }>('/api/miles/task', async (req, reply) => {
    const u = await requireUser(req, reply);
    if (!u) return;
    const request = (req.body?.request ?? '').toString().trim().slice(0, 600);
    if (!request) return reply.code(400).send({ error: 'request is required' });
    const data = await authStore.getUserData(u.id);
    const p = (data.profile ?? {}) as Record<string, string>;
    const kit = brandKitFor(data);
    const ctx: TeamCtx = {
      business: p.businessName,
      trade: p.industry,
      city: (p.serviceAreas || '').split(',')[0]?.trim(),
      services: p.services,
      offers: p.currentOffers,
      voice: kit.voice,
    };
    const kind = classifyRequest(request);
    let body: string;
    let live = false;
    if (kind === 'campaign') {
      const sp = strategistPrompt(request, ctx);
      const rawAngle = await generateText({ system: sp.system, user: sp.user, maxTokens: 500 });
      if (rawAngle) live = true;
      const angle = rawAngle ?? fallbackStrategist(request, ctx);
      const parts: string[] = [`### The angle\n\n${angle}`];
      for (const id of ['content', 'social', 'ads']) {
        const pr = id === 'content' ? contentPrompt(request, angle, ctx) : id === 'social' ? socialPrompt(request, angle, ctx) : adsPrompt(request, angle, ctx);
        const raw = await generateText({ system: pr.system, user: pr.user, maxTokens: 700 });
        if (raw) live = true;
        parts.push(`### ${AREA_TITLE[id] ?? id}\n\n${raw ?? fallbackContribution(id, request, ctx)}`);
      }
      body = parts.join('\n\n');
    } else {
      const pr = kind === 'email' ? emailPrompt(request, ctx) : kind === 'social' ? dwSocialPrompt(request, ctx) : dwAdsPrompt(request, ctx);
      const raw = await generateText({ system: pr.system, user: pr.user, maxTokens: 900 });
      if (raw) live = true;
      body = raw ?? fallbackWork(kind, request, ctx);
    }
    const item = { id: newToken().slice(0, 10), kind, title: titleFor(kind, request), request, body, createdAt: new Date().toISOString(), status: 'review' };
    data.reviewQueue = [item, ...((data.reviewQueue as any[]) ?? [])].slice(0, 50);
    await authStore.setUserData(u.id, data);
    if (live) await meterUser(u.id, 'text');
    return { ok: true, id: item.id, kind, title: item.title, live };
  });

  // The review queue — finished drafts waiting for the owner's OK.
  app.get('/api/review', async (req, reply) => {
    const u = await requireUser(req, reply);
    if (!u) return;
    const data = await authStore.getUserData(u.id);
    const items = ((data.reviewQueue as any[]) ?? [])
      .filter((i) => i.status === 'review')
      .map((i) => ({ id: i.id, kind: i.kind, title: i.title, body: i.body, createdAt: i.createdAt }));
    return { items };
  });
  app.post<{ Body: { id?: string } }>('/api/review/approve', async (req, reply) => {
    const u = await requireUser(req, reply);
    if (!u) return;
    const id = (req.body?.id ?? '').toString();
    const data = await authStore.getUserData(u.id);
    const item = ((data.reviewQueue as any[]) ?? []).find((i) => i.id === id);
    if (!item) return reply.code(404).send({ error: 'not found' });
    item.status = 'approved';
    const deploy = (data.deploy as { auto?: boolean; queue?: any[] }) ?? { auto: false, queue: [] };
    deploy.queue = Array.isArray(deploy.queue) ? deploy.queue : [];
    const status = deploy.auto ? 'live' : 'pending';
    deploy.queue.unshift({ id: item.id, label: item.title, type: item.kind, status, ts: new Date().toISOString(), detail: String(item.body || '').slice(0, 4000) });
    deploy.queue = deploy.queue.slice(0, 300);
    data.deploy = deploy;
    await authStore.setUserData(u.id, data);
    // For an email draft, actually send it once a provider is connected. Without a
    // customer list we send the finished campaign to the owner's own inbox (their
    // broadcast list lives in their email tool); honest about that either way.
    let emailed = false;
    if (item.kind === 'email' && deliveryStatus().email && u.email) {
      const m = /subject[:*\s]+([^\n]+)/i.exec(String(item.body || ''));
      const subject = (m?.[1] || item.title).replace(/[*#]/g, '').trim().slice(0, 160);
      const bodyText = String(item.body || '').replace(/\*\*/g, '').replace(/^#+\s*/gm, '');
      try {
        await sendEmail(u.email, subject, bodyText);
        emailed = true;
      } catch {
        /* delivery is best-effort */
      }
    }
    return { ok: true, status, emailed, emailReady: deliveryStatus().email };
  });
  app.post<{ Body: { id?: string } }>('/api/review/dismiss', async (req, reply) => {
    const u = await requireUser(req, reply);
    if (!u) return;
    const id = (req.body?.id ?? '').toString();
    const data = await authStore.getUserData(u.id);
    const item = ((data.reviewQueue as any[]) ?? []).find((i) => i.id === id);
    if (item) item.status = 'dismissed';
    await authStore.setUserData(u.id, data);
    return { ok: true };
  });

  // ── Launch a Campaign — build a complete Google Ads Search campaign, review
  // every setting, then (only on explicit approve) run the live write-chain. ──
  app.post<{ Body: { goal?: string; dailyBudget?: number; finalUrl?: string; locations?: string[] } }>('/api/campaign/draft', async (req, reply) => {
    const u = await requireUser(req, reply);
    if (!u) return;
    const data = await authStore.getUserData(u.id);
    const p = (data.profile ?? {}) as Record<string, string>;
    const ctx = { business: p.businessName, trade: p.industry, city: (p.serviceAreas || '').split(',')[0]?.trim(), services: p.services, offers: p.currentOffers };
    const spec = buildCampaignSpec({ goal: req.body?.goal, dailyBudget: req.body?.dailyBudget, finalUrl: req.body?.finalUrl || p.website, locations: req.body?.locations }, ctx);
    let gadsConnected = false;
    try { gadsConnected = (await connector.listAccounts(u.id)).some((a) => a.app === 'google_ads'); } catch { /* none */ }
    return { ok: true, spec, summary: campaignSummary(spec), gadsConnected };
  });

  app.post<{ Body: { spec?: CampaignSpec; confirm?: boolean } }>('/api/campaign/launch', async (req, reply) => {
    const u = await requireUser(req, reply);
    if (!u) return;
    const spec = req.body?.spec;
    if (!spec || typeof spec !== 'object') return reply.code(400).send({ error: 'spec is required' });
    if (req.body?.confirm !== true) return reply.code(400).send({ error: 'Explicit confirm required — nothing goes live without it.' });
    const problems = validateCampaignSpec(spec);
    if (problems.length) return reply.code(400).send({ error: 'Campaign not ready to launch', problems });
    if (!connector.launchCampaign) return reply.code(400).send({ error: 'This connector cannot launch campaigns.' });
    const result = await connector.launchCampaign(u.id, spec);
    // Record the launch attempt in the deploy/change log with the full spec attached.
    const data = await authStore.getUserData(u.id);
    const deploy = (data.deploy as { auto?: boolean; queue?: any[] }) ?? { auto: false, queue: [] };
    deploy.queue = Array.isArray(deploy.queue) ? deploy.queue : [];
    deploy.queue.unshift({
      id: newToken().slice(0, 10),
      label: `Google Ads campaign — ${spec.name} (${spec.status})`,
      type: 'ads',
      status: result.ok ? (result.live ? 'live' : 'pending') : 'reverted',
      ts: new Date().toISOString(),
      link: result.link,
      detail: campaignSummary(spec) + '\n\n' + result.steps.map((s) => `${s.ok ? '✓' : '✗'} ${s.step}${s.error ? ' — ' + s.error : ''}`).join('\n'),
    });
    deploy.queue = deploy.queue.slice(0, 300);
    data.deploy = deploy;
    await authStore.setUserData(u.id, data);
    if (result.live && result.ok) await meterUser(u.id, 'agent_run');
    return result;
  });

  // Saved campaign drafts — build one, save it, come back to it in the builder.
  // Purely local; nothing here touches Google Ads.
  app.get('/api/campaign/drafts', async (req, reply) => {
    const u = await requireUser(req, reply);
    if (!u) return;
    const data = await authStore.getUserData(u.id);
    let gadsConnected = false;
    try { gadsConnected = (await connector.listAccounts(u.id)).some((a) => a.app === 'google_ads'); } catch { /* none */ }
    return { drafts: (data.campaignDrafts as any[]) ?? [], gadsConnected };
  });
  app.post<{ Body: { spec?: CampaignSpec } }>('/api/campaign/drafts', async (req, reply) => {
    const u = await requireUser(req, reply);
    if (!u) return;
    const spec = req.body?.spec;
    if (!spec || typeof spec !== 'object') return reply.code(400).send({ error: 'spec is required' });
    const data = await authStore.getUserData(u.id);
    const drafts = ((data.campaignDrafts as any[]) ?? []).filter((d) => d && d.id);
    const draft = { id: newToken().slice(0, 10), spec, summary: campaignSummary(spec), savedAt: new Date().toISOString() };
    data.campaignDrafts = [draft, ...drafts].slice(0, 30);
    await authStore.setUserData(u.id, data);
    return { ok: true, id: draft.id };
  });
  app.post<{ Body: { id?: string } }>('/api/campaign/drafts/delete', async (req, reply) => {
    const u = await requireUser(req, reply);
    if (!u) return;
    const data = await authStore.getUserData(u.id);
    data.campaignDrafts = ((data.campaignDrafts as any[]) ?? []).filter((d) => d.id !== req.body?.id);
    await authStore.setUserData(u.id, data);
    return { ok: true };
  });

  // ── Competitor Ad Watch (Meta Ad Library) ────────────────────────────────
  // Shows the ads a shop's local competitors are running, so the owner can make
  // their own version of what's already converting. Gated by META_AD_LIBRARY_TOKEN.
  app.get<{ Querystring: { q?: string } }>('/api/competitor-ads', async (req, reply) => {
    const u = await requireUser(req, reply);
    if (!u) return;
    if (!adLibraryReady()) return { ready: false, ads: [] as unknown[], query: '' };
    const data = await authStore.getUserData(u.id);
    const p = (data.profile ?? {}) as Record<string, string>;
    const q =
      (req.query?.q ?? '').trim() ||
      [p.industry, (p.serviceAreas || '').split(',')[0]?.trim()].filter(Boolean).join(' ') ||
      p.industry ||
      'home services';
    const ads = await searchCompetitorAds({ terms: q, countries: ['US'], limit: 24 });
    return { ready: true, ads, query: q };
  });

  // ── Miles as CMO — one AI employee who runs the whole marketing function ───
  app.get('/api/team', async (req, reply) => {
    const u = await requireUser(req, reply);
    if (!u) return;
    return { areas: CMO_AREAS };
  });

  // Run a campaign: Miles sets the angle first, then builds the content, social
  // and ads from that same brief — one coherent campaign, one voice.
  app.post<{ Body: { goal?: string } }>('/api/team/campaign', async (req, reply) => {
    const u = await requireUser(req, reply);
    if (!u) return;
    const goal = (req.body?.goal ?? '').toString().trim().slice(0, 400);
    if (!goal) return reply.code(400).send({ error: 'goal is required' });
    const data = await authStore.getUserData(u.id);
    const p = (data.profile ?? {}) as Record<string, string>;
    const kit = brandKitFor(data);
    const ctx: TeamCtx = {
      business: p.businessName,
      trade: p.industry,
      city: (p.serviceAreas || '').split(',')[0]?.trim(),
      services: p.services,
      offers: p.currentOffers,
      voice: kit.voice,
    };
    // 1) Miles sets the angle the rest of the campaign is built on.
    const sp = strategistPrompt(goal, ctx);
    const rawAngle = await generateText({ system: sp.system, user: sp.user, maxTokens: 500 });
    const angle = rawAngle ?? fallbackStrategist(goal, ctx);
    let live = !!rawAngle;
    // 2) Miles builds each part from that same brief.
    const parts: Array<{ id: string; title: string; body: string }> = [];
    for (const id of ['content', 'social', 'ads']) {
      const pr = id === 'content' ? contentPrompt(goal, angle, ctx) : id === 'social' ? socialPrompt(goal, angle, ctx) : adsPrompt(goal, angle, ctx);
      const raw = await generateText({ system: pr.system, user: pr.user, maxTokens: 700 });
      if (raw) live = true;
      parts.push({ id, title: AREA_TITLE[id] ?? id, body: raw ?? fallbackContribution(id, goal, ctx) });
    }
    if (live) await meterUser(u.id, 'text');
    return { goal, angle, parts, live };
  });

  // ── Agent Recommendation Engine ──────────────────────────────────────────
  // Reviews the shop's live marketing data daily and proposes specific, approvable
  // optimizations. Approving one queues the change into the Deploy pipeline (or
  // applies a direct toggle like Speed-to-Lead) — the same gate every change uses.
  const recState = (data: Record<string, unknown>) =>
    (data.recState as { applied?: Record<string, string>; dismissed?: Record<string, string> }) ?? { applied: {}, dismissed: {} };

  app.get('/api/recommendations', async (req, reply) => {
    const u = await requireUser(req, reply);
    if (!u) return;
    const data = await authStore.getUserData(u.id);
    const p = (data.profile ?? {}) as Record<string, string>;
    const spend = await safeConn(connector.getAdSpend ? () => connector.getAdSpend!(u.id) : undefined, [] as import('./revenue/attribution.js').CampaignSpend[]);
    const deals = await safeConn(connector.getDeals ? () => connector.getDeals!(u.id) : undefined, [] as import('./revenue/attribution.js').Deal[]);
    const leads = await safeConn(connector.getLeads ? () => connector.getLeads!(u.id) : undefined, [] as import('./connectors/types.js').Lead[]);
    const reviews = await safeConn(connector.getReviews ? () => connector.getReviews!(u.id) : undefined, [] as import('./connectors/types.js').Review[]);
    const emails = await safeConn(connector.getRecentEmails ? () => connector.getRecentEmails!(u.id, 25) : undefined, [] as import('./connectors/types.js').EmailMessage[]);
    const social = await safeConn(connector.getSocialMetrics ? () => connector.getSocialMetrics!(u.id) : undefined, null as import('./connectors/types.js').SocialMetrics | null);
    const scheduledPosts = ((data.scheduledPosts as ScheduledPost[]) ?? []).filter((x) => x.status === 'scheduled').length;
    const stl = (data.speedToLead as { enabled?: boolean } | undefined)?.enabled ?? false;
    const recs = buildRecommendations(
      { spend, deals, leads, reviews, emails, social, scheduledPosts, targetCpa: Number(p.targetCpa) || null, speedToLeadOn: stl },
      new Date(),
    );
    const st = recState(data);
    const open = recs.filter((r) => !st.applied?.[r.id] && !st.dismissed?.[r.id]);
    const connected = spend.length + leads.length + reviews.length + emails.length > 0;
    const digestOn = ((data.schedules as ScheduledAgent[]) ?? []).some((a) => a.task === 'recommend' && a.enabled);
    return { recommendations: open, connected, appliedToday: Object.keys(st.applied ?? {}).length, digestOn };
  });

  // Turn the daily morning recommendations digest on/off (a scheduled 'recommend' agent).
  app.post<{ Body: { enabled?: boolean; tzOffset?: number } }>('/api/recommendations/digest', async (req, reply) => {
    const u = await requireUser(req, reply);
    if (!u) return;
    const data = await authStore.getUserData(u.id);
    const agents = ((data.schedules as ScheduledAgent[]) ?? []).slice();
    const existing = agents.find((a) => a.task === 'recommend');
    const enabled = req.body?.enabled !== false;
    const tz = typeof req.body?.tzOffset === 'number' ? req.body!.tzOffset : existing?.tzOffset ?? 0;
    if (enabled) {
      if (existing) {
        existing.enabled = true;
        existing.deliver = { ...(existing.deliver ?? {}), email: true };
        existing.tzOffset = tz;
      } else {
        agents.push({ id: newToken().slice(0, 10), name: 'Daily recommendations', task: 'recommend', deliver: { email: true }, time: '08:15', days: [1, 2, 3, 4, 5], enabled: true, tzOffset: tz, createdAt: new Date().toISOString() });
      }
    } else if (existing) {
      existing.enabled = false;
    }
    data.schedules = agents.slice(0, 25);
    await authStore.setUserData(u.id, data);
    return { ok: true, digestOn: enabled, emailReady: deliveryStatus().email };
  });

  app.post<{ Body: { rec?: Recommendation } }>('/api/recommendations/apply', async (req, reply) => {
    const u = await requireUser(req, reply);
    if (!u) return;
    const rec = req.body?.rec;
    if (!rec?.id) return reply.code(400).send({ error: 'rec is required' });
    const data = await authStore.getUserData(u.id);
    const deploy = (data.deploy as { auto?: boolean; queue?: any[] }) ?? { auto: false, queue: [] };
    deploy.queue = Array.isArray(deploy.queue) ? deploy.queue : [];
    const status = deploy.auto ? 'live' : 'pending';
    if (rec.apply?.kind === 'enable_speed_to_lead') {
      const s = (data.speedToLead as Record<string, unknown>) ?? {};
      s.enabled = true;
      data.speedToLead = s;
    }
    deploy.queue.unshift({ id: rec.id, label: rec.apply?.label || rec.title || 'Optimization', type: 'optimization', status, ts: new Date().toISOString(), detail: [rec.why, rec.action && `Action: ${rec.action}`].filter(Boolean).join('\n\n') });
    deploy.queue = deploy.queue.slice(0, 300);
    data.deploy = deploy;
    const st = recState(data);
    st.applied = { ...(st.applied ?? {}), [rec.id]: new Date().toISOString() };
    data.recState = st;
    await authStore.setUserData(u.id, data);
    return { ok: true, status };
  });

  app.post<{ Body: { id?: string } }>('/api/recommendations/dismiss', async (req, reply) => {
    const u = await requireUser(req, reply);
    if (!u) return;
    const id = (req.body?.id ?? '').toString();
    if (!id) return reply.code(400).send({ error: 'id is required' });
    const data = await authStore.getUserData(u.id);
    const st = recState(data);
    st.dismissed = { ...(st.dismissed ?? {}), [id]: new Date().toISOString() };
    data.recState = st;
    await authStore.setUserData(u.id, data);
    return { ok: true };
  });

  // Version snapshots — point-in-time restore points for undo / rollback.
  // `assets` is deliberately excluded: logos/photos are large base64 data URLs that the
  // client strips from snapshots to keep them small, so restoring assets would wipe images.
  // Campaigns (hub) and weather triggers (weatherRules) are the real undo targets and are lossless.
  const RESTORE_DOMAINS = ['hub', 'weatherRules', 'profile', 'skills', 'autopilot', 'model'];
  app.get('/api/versions', async (req, reply) => {
    const u = await requireUser(req, reply);
    if (!u) return;
    const data = await authStore.getUserData(u.id);
    return { versions: ((data.versions as any[]) ?? []).map((v) => ({ id: v.id, ts: v.ts, label: v.label })) };
  });
  app.post<{ Body: { id?: string; label?: string; state?: any } }>('/api/versions', async (req, reply) => {
    const u = await requireUser(req, reply);
    if (!u) return;
    const data = await authStore.getUserData(u.id);
    // Accept a client-supplied id so a change-log entry and its restore point share one id.
    const id = (req.body?.id || newToken().slice(0, 10)).toString().slice(0, 40);
    const v = { id, ts: new Date().toISOString(), label: (req.body?.label || 'Change').slice(0, 120), state: req.body?.state ?? {} };
    data.versions = [...((data.versions as any[]) ?? []), v].slice(-30);
    await authStore.setUserData(u.id, data);
    return { ok: true, id: v.id };
  });
  app.post<{ Body: { id?: string } }>('/api/versions/restore', async (req, reply) => {
    const u = await requireUser(req, reply);
    if (!u) return;
    const data = await authStore.getUserData(u.id);
    const v = ((data.versions as any[]) ?? []).find((x) => x.id === req.body?.id);
    if (!v) return reply.code(404).send({ error: 'restore point not found' });
    for (const k of RESTORE_DOMAINS) if (k in (v.state ?? {})) (data as any)[k] = v.state[k];
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
    return { connector: connector.name, hub: { ready: pdReady, env: cfg.pipedream.environment }, connectedApps };
  });

  // Closed-loop revenue attribution — ad spend correlated to CRM deals by UTM.
  app.get<{ Querystring: { sessionId?: string } }>('/api/revenue', async (req) => {
    const sessionId = req.query?.sessionId;
    if (!sessionId) return { report: null, deals: [], connected: false };
    try {
      const spend = await safeConn(connector.getAdSpend ? () => connector.getAdSpend!(sessionId) : undefined, []);
      const deals = await safeConn(connector.getDeals ? () => connector.getDeals!(sessionId) : undefined, []);
      return { report: attributeRevenue(spend, deals), deals, connected: spend.length > 0 || deals.length > 0 };
    } catch (err) {
      return { report: null, deals: [], connected: false, error: String((err as Error).message) };
    }
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
      return await safeConn(connector.listApps ? () => connector.listApps!(q, limit, req.query?.after) : undefined, { apps: [] });
    } catch (err) {
      return { apps: [], error: String((err as Error).message) };
    }
  });

  // Real competitor listings near a ZIP (Google Places) — names, ratings, reviews.
  app.get<{ Querystring: { zip?: string; q?: string } }>('/api/competitors', async (req, reply) => {
    const u = await requireUser(req, reply);
    if (!u) return;
    const zip = req.query?.zip;
    const q = (req.query?.q || 'home services contractors').trim();
    const query = zip ? `${q} in ${zip}` : q;
    const configured = !!process.env.GOOGLE_PLACES_KEY;
    try {
      const list = await searchCompetitors(query);
      return { competitors: list ?? [], configured };
    } catch {
      return { competitors: [], configured };
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

  // Affluence targeting — rank a service area's ZIPs by ability-to-spend, so
  // premium offers go where the money is and value offers go everywhere.
  app.post<{ Body: { zips?: string[]; text?: string } }>('/api/market/affluence', async (req, reply) => {
    const u = await requireUser(req, reply);
    if (!u) return;
    const raw = Array.isArray(req.body?.zips) ? req.body!.zips!.join(' ') : '';
    const text = `${raw} ${req.body?.text ?? ''}`;
    const zips = (text.match(/\b\d{5}\b/g) ?? []);
    if (!zips.length) return reply.code(400).send({ error: 'Enter at least one 5-digit ZIP in your service area.' });
    try {
      const r = await zipAffluence(zips);
      return r;
    } catch (err) {
      return reply.code(502).send({ error: String((err as Error).message) });
    }
  });

  // Creative engine — generate ad copy (always) + a real photo when fal.ai is set.
  app.post<{ Body: CreativeRequest }>('/api/creative', async (req) => {
    const body = req.body ?? {};
    const creatives = generateAdCopy(body);
    // Generate each visual with the chosen quality tier (routing by provider, with a
    // reliable fallback). Attempt regardless of which single key is set; imagesLive
    // reflects whether anything actually came back.
    await Promise.all(
      creatives.map(async (c) => {
        const url = await renderAdImage(c.imagePrompt, body.model);
        if (url) c.imageUrl = url;
      }),
    );
    const usedModel = modelById(body.model)?.kind === 'image' ? modelById(body.model)!.id : defaultModel('image').id;
    return { creatives, imagesLive: creatives.some((c) => !!c.imageUrl), model: usedModel };
  });

  // Creative Studio — every marketing asset from one place. Visual types render
  // an image/video (fal.ai); copy/doc render text (the LLM). All degrade to a
  // demo-safe fallback so nothing breaks before FAL_KEY / an LLM key is set.
  app.get('/api/studio', async (req, reply) => {
    const u = await requireUser(req, reply);
    if (!u) return;
    return { types: ASSET_TYPES, imagesLive: falReady(), textLive: textLlmReady() };
  });
  // Which models a given asset type can use, plus the recommended pick for a prompt.
  app.get<{ Querystring: { type?: string; prompt?: string } }>('/api/studio/models', async (req, reply) => {
    const u = await requireUser(req, reply);
    if (!u) return;
    const spec = specFor(req.query?.type ?? 'image') ?? specFor('image')!;
    if (spec.kind === 'text') return { kind: 'text', models: [], recommended: null, defaultId: null };
    const kind = spec.kind as MediaKind;
    const models = modelsForKind(kind).map((m) => ({
      id: m.id, label: m.label, blurb: m.blurb, credits: m.credits,
      provider: m.provider, requiresEnv: m.requiresEnv, active: modelActive(m),
      default: !!m.default, eta: m.etaSec,
    }));
    const rec = recommendModel(kind, req.query?.prompt ?? '');
    return { kind, models, recommended: rec, defaultId: defaultModel(kind).id };
  });

  // The Brand Kit — one source of truth folded into every creative surface, so
  // generated & optimized assets follow the same palette, voice, and rules.
  function brandKitFor(data: Record<string, unknown>): BrandKit {
    return resolveKit(
      data.brandKit as Partial<BrandKit> | undefined,
      (data.profile ?? {}) as Record<string, unknown>,
      (data.assets ?? {}) as Record<string, unknown>,
    );
  }
  function brandContextFor(data: Record<string, unknown>): BrandContext {
    const p = (data.profile ?? {}) as Record<string, string>;
    const kit = brandKitFor(data);
    return {
      business: p.businessName,
      vertical: p.industry,
      category: p.industry,
      city: (p.serviceAreas || '').split(',')[0]?.trim(),
      services: (p.services || '').split(',').map((s) => s.trim()).filter(Boolean),
      colors: kit.colors,
      fonts: kit.fonts,
      voice: kit.voice,
      tagline: kit.tagline,
      keywords: kit.keywords,
      avoid: kit.avoid,
    };
  }

  // Brand Kit read/save. GET returns the resolved kit (auto-seeded from profile +
  // assets) so the section is never blank on first open.
  app.get('/api/brand', async (req, reply) => {
    const u = await requireUser(req, reply);
    if (!u) return;
    const data = await authStore.getUserData(u.id);
    const kit = brandKitFor(data);
    return { kit, active: kitHasGuidance(kit), stored: !!data.brandKit };
  });
  app.put<{ Body: { kit?: Partial<BrandKit> } }>('/api/brand', async (req, reply) => {
    const u = await requireUser(req, reply);
    if (!u) return;
    const data = await authStore.getUserData(u.id);
    const inb = req.body?.kit ?? {};
    // Store a clean, bounded kit.
    const kit: BrandKit = {
      name: (inb.name ?? '').toString().slice(0, 120) || undefined,
      tagline: (inb.tagline ?? '').toString().slice(0, 200) || undefined,
      colors: Array.isArray(inb.colors) ? inb.colors.map((c) => String(c).slice(0, 9)).slice(0, 5) : [],
      fonts: (inb.fonts ?? '').toString().slice(0, 200) || undefined,
      logoUrl: (inb.logoUrl ?? '').toString().slice(0, 500_000) || undefined,
      voice: (inb.voice ?? '').toString().slice(0, 400) || undefined,
      audience: (inb.audience ?? '').toString().slice(0, 300) || undefined,
      keywords: Array.isArray(inb.keywords) ? inb.keywords.map((k) => String(k).slice(0, 60)).slice(0, 20) : [],
      avoid: (inb.avoid ?? '').toString().slice(0, 400) || undefined,
    };
    data.brandKit = kit;
    await authStore.setUserData(u.id, data);
    return { ok: true, kit, active: kitHasGuidance(kit) };
  });

  // ── Template library (Templated.io) ──────────────────────────────────────
  // A curated library of professional, commercially-licensed templates. Miles
  // fills each template's named layers with the shop's brand + offer and returns
  // a finished image. Enabled by TEMPLATED_API_KEY; degrades honestly otherwise.
  app.get('/api/templates', async (req, reply) => {
    const u = await requireUser(req, reply);
    if (!u) return;
    if (!templatedReady()) return { ready: false, templates: [] as unknown[] };
    return { ready: true, templates: await templatedListTemplates() };
  });

  app.post<{ Body: { templateId?: string; offer?: string; headline?: string } }>(
    '/api/templates/render',
    async (req, reply) => {
      const u = await requireUser(req, reply);
      if (!u) return;
      const templateId = (req.body?.templateId ?? '').toString();
      if (!templateId) return reply.code(400).send({ error: 'templateId is required' });
      if (!templatedReady()) return { url: null, live: false, note: 'Add TEMPLATED_API_KEY on Render to render designs.' };
      const data = await authStore.getUserData(u.id);
      const p = (data.profile ?? {}) as Record<string, string>;
      const kit = brandKitFor(data);
      const primary = (kit.colors ?? [])[0];
      const logo = kit.logoUrl && /^https?:\/\//i.test(kit.logoUrl) ? kit.logoUrl : undefined;
      const offer = (req.body?.offer ?? p.currentOffers ?? 'Special Offer').toString().slice(0, 200);
      const headline = (req.body?.headline ?? p.industry ?? '').toString().slice(0, 120);
      const layers: Record<string, RenderLayer> = { cta: { text: 'Call Today' } };
      if (offer) layers.offer = { text: offer, ...(primary ? { color: primary } : {}) };
      if (headline) layers.headline = { text: headline };
      if (p.businessName) layers.company = { text: p.businessName };
      if (p.phone) layers.phone = { text: p.phone };
      if (logo) layers.logo = { image_url: logo };
      const url = await templatedRender(templateId, layers);
      if (url) await meterUser(u.id, 'image');
      return {
        url,
        live: !!url,
        note: url ? undefined : 'No image came back — check that the template uses layer names offer / headline / company / phone / cta / logo in Templated.',
      };
    },
  );

  app.post<{ Body: { type?: string; prompt?: string; aspect?: Aspect; style?: string; quality?: 'standard' | 'premium'; duration?: number; model?: string } }>(
    '/api/studio',
    async (req, reply) => {
      const u = await requireUser(req, reply);
      if (!u) return;
      const body = req.body ?? {};
      const spec = specFor(body.type ?? 'image') ?? specFor('image')!;
      const data = await authStore.getUserData(u.id);
      const brand = brandContextFor(data);
      if (spec.kind === 'text') {
        const { system, user } = buildTextPrompt(spec.type, body.prompt ?? '', brand);
        const gen = await generateText({ system, user });
        const text = gen ?? fallbackText(spec.type, body.prompt ?? '', brand);
        if (gen) await meterUser(u.id, 'text'); // only bill for a real generation
        return { type: spec.type, kind: 'text', text, live: !!gen };
      }
      // Resolve the chosen media model (registry id) or the reliable default for the kind.
      const mediaKind = spec.kind as MediaKind;
      const picked = modelById(body.model);
      const chosen = picked && picked.kind === mediaKind ? picked : defaultModel(mediaKind);
      const def = defaultModel(mediaKind);

      if (spec.kind === 'audio') {
        const url = await falGenerateAudio(body.prompt ?? '', { voice: body.style, model: chosen.falModel });
        if (url) await meterUser(u.id, 'audio', 1, chosen.credits); // bill only on a real render
        return { type: spec.type, kind: 'audio', url, model: chosen.id, live: !!url };
      }
      const prompt = buildVisualPrompt(spec.type, body.prompt ?? '', brand, body.style);
      const aspect = (body.aspect ?? spec.defaultAspect) as Aspect;
      if (spec.kind === 'video') {
        let url: string | null = null;
        let errNote: string | undefined;
        if (chosen.provider === 'higgsfield') {
          const r = await higgsfieldGenerateVideo(prompt, { aspect });
          url = r.url;
          if (!url && r.error) errNote = r.error;
        } else {
          url = await falGenerateVideo(prompt, { aspect, duration: body.duration, model: chosen.falModel });
        }
        // A premium pick that returns nothing falls back to the reliable default —
        // then bill for and report the model that actually produced the asset.
        let used = chosen;
        let note = errNote;
        if (!url && chosen.id !== def.id) {
          const fb = await falGenerateVideo(prompt, { aspect, duration: body.duration, model: def.falModel });
          if (fb) { url = fb; used = def; note = `${chosen.label} was unavailable — generated with ${def.label} instead.`; }
        }
        if (url) await meterUser(u.id, 'video', 1, used.credits);
        return { type: spec.type, kind: 'video', url, prompt, model: used.id, note, live: !!url };
      }
      // image — route by provider, always falling back to the default fal model.
      let url: string | null = null;
      let errNote: string | undefined;
      if (chosen.provider === 'higgsfield') {
        const r = await higgsfieldGenerateImage(prompt, { aspect });
        url = r.url;
        if (!url && r.error) errNote = `Higgsfield: ${r.error}`;
      } else if (chosen.provider === 'google') {
        url = await googleGenerateImage(prompt, { aspect });
      } else if (chosen.provider === 'openai') {
        url = await openaiGenerateImage(prompt, { aspect });
      } else {
        url = await falGenerateImage(prompt, { aspect, model: chosen.falModel });
      }
      let used = chosen;
      let note = errNote;
      if (!url && chosen.id !== def.id) {
        const fb = await falGenerateImage(prompt, { aspect, model: def.falModel });
        if (fb) { url = fb; used = def; note = `${chosen.label} was unavailable — generated with ${def.label} instead.`; }
      }
      if (url) await meterUser(u.id, 'image', 1, used.credits); // bill only on a real render, for the model that ran
      return { type: spec.type, kind: 'image', url, prompt, model: used.id, note, live: !!url };
    },
  );

  // "Optimize prompt" — rewrite a customer's rough idea into an expert prompt for
  // the asset type, so non-prompt-engineers get great results. Returns just the
  // improved prompt to drop back into the input for review before Generate.
  app.post<{ Body: { type?: string; prompt?: string; mode?: string } }>('/api/studio/optimize', async (req, reply) => {
    const u = await requireUser(req, reply);
    if (!u) return;
    const spec = specFor(req.body?.type ?? 'image') ?? specFor('image')!;
    const rough = (req.body?.prompt ?? '').trim();
    if (!rough) return reply.code(400).send({ error: 'Type a rough idea first.' });
    // Two modes: weave in the business, or just optimize the idea (experiments).
    const forBusiness = (req.body?.mode ?? 'business') !== 'general';
    const data = await authStore.getUserData(u.id);
    const p = (data.profile ?? {}) as Record<string, string>;
    const who = `${p.businessName || 'a local business'} — ${p.industry || 'local-service'}${p.serviceAreas ? `, ${p.serviceAreas}` : ''}${p.services ? `. Services: ${p.services}` : ''}`;
    // Business mode carries the brand kit so the optimized prompt already reflects it.
    const kit = brandKitFor(data);
    const brandBlock =
      forBusiness && kitHasGuidance(kit)
        ? `\nBrand guidelines to follow:${kit.colors.length ? `\n- Colors: ${kit.colors.join(', ')}` : ''}${kit.fonts ? `\n- Fonts: ${kit.fonts}` : ''}${kit.voice ? `\n- Voice: ${kit.voice}` : ''}${kit.tagline ? `\n- Tagline: "${kit.tagline}"` : ''}${kit.keywords.length ? `\n- Themes: ${kit.keywords.join(', ')}` : ''}${kit.avoid ? `\n- Avoid: ${kit.avoid}` : ''}`
        : '';
    const user = forBusiness
      ? `Business: ${who}.${brandBlock}\nMaking: a ${spec.label.toLowerCase()}.\nTheir rough idea: "${rough}"\n\nRewrite it now.`
      : `Making: a ${spec.label.toLowerCase()}.\nRough idea: "${rough}"\n\nRewrite it now.`;
    const improved = await generateText({ system: optimizerSystem(spec.kind, forBusiness), user, maxTokens: 500 });
    if (improved) await meterUser(u.id, 'text'); // only bill when the optimizer actually ran
    return { prompt: (improved || rough).trim(), improved: !!improved, live: !!improved };
  });

  // Agent Studio — turn a plain-language problem into a runnable agent spec for the
  // customer to approve, then deploy via /api/schedules like any other agent.
  app.post<{ Body: { problem?: string } }>('/api/studio/agent', async (req, reply) => {
    const u = await requireUser(req, reply);
    if (!u) return;
    const problem = (req.body?.problem ?? '').trim();
    if (!problem) return reply.code(400).send({ error: 'Describe the problem you want an agent to solve.' });
    const { system, user } = buildAgentDesignPrompt(problem);
    const raw = await generateText({ system, user, maxTokens: 700 });
    const spec = (raw && parseAgentSpec(raw)) || fallbackAgentDesign(problem);
    const source = DATA_SOURCES.find((s) => s.id === spec.dataSource)!;
    await meterUser(u.id, 'agent_design');
    return { spec, source, live: textLlmReady() };
  });

  // ── Scheduled agents — recurring, unattended work (morning brief, CPA report) ──
  // Runs a task now and returns its written result. Reused by the endpoint + scheduler.
  // Read one data source to text (+ a short summary), degrading cleanly if unconnected.
  async function readSourceText(source: string, userId: string): Promise<{ text: string; summary: string }> {
    if (source === 'emails') {
      const e = await safeConn(connector.getRecentEmails ? () => connector.getRecentEmails!(userId, 25) : undefined, []);
      return { text: e.map((m, i) => `${i + 1}. From: ${m.from || '?'} | ${m.subject || '(none)'} | ${m.snippet || ''}`).join('\n'), summary: `${e.length} emails` };
    }
    if (source === 'reviews') {
      const r = await safeConn(connector.getReviews ? () => connector.getReviews!(userId) : undefined, []);
      return { text: r.map((x) => `${x.rating}★ from ${x.author || 'a customer'}: ${x.text || ''}`).join('\n'), summary: `${r.length} reviews` };
    }
    if (source === 'leads') {
      const l = await safeConn(connector.getLeads ? () => connector.getLeads!(userId) : undefined, []);
      return { text: l.map((x) => `${x.name || 'Lead'} — ${x.service || 'inquiry'} (via ${x.source || 'unknown'})`).join('\n'), summary: `${l.length} leads` };
    }
    if (source === 'social') {
      const m = await safeConn(connector.getSocialMetrics ? () => connector.getSocialMetrics!(userId) : undefined, null);
      return { text: m ? `impressions ${m.impressions}, clicks ${m.clicks}, likes ${m.likes}${m.followers ? `, followers ${m.followers}` : ''}` : '', summary: m ? 'social metrics' : 'no metrics' };
    }
    if (source === 'adspend') {
      const s = await safeConn(connector.getAdSpend ? () => connector.getAdSpend!(userId) : undefined, []);
      return { text: s.map((x) => `${x.platform}/${x.campaign}: $${x.spend} spent, ${x.conversions} conversions`).join('\n'), summary: `${s.length} campaigns` };
    }
    if (source === 'deals') {
      const d2 = await safeConn(connector.getDeals ? () => connector.getDeals!(userId) : undefined, []);
      return { text: d2.map((x) => `$${x.value} ${x.won ? 'won' : 'lost'} via ${x.utmSource || 'unknown'}`).join('\n'), summary: `${d2.length} deals` };
    }
    return { text: '', summary: '' };
  }

  // Run a wireframe-built agent — its ordered steps (read → create → act), in sequence.
  async function runAgentSteps(steps: AgentStep[], userId: string, business: string, title: string): Promise<{ title: string; body: string }> {
    let connectedApps = new Set<string>();
    try {
      connectedApps = new Set((await connector.listAccounts(userId)).map((a) => a.app));
    } catch {
      /* nothing connected */
    }
    let ctx = `Business: ${business || 'the business'}.`;
    let lastOut = '';
    const lines: string[] = [];
    for (let i = 0; i < steps.length; i++) {
      const st = steps[i]!;
      const n = i + 1;
      const custom = (st.custom || '').trim();
      if (st.kind === 'read') {
        if (st.tool === 'custom') {
          ctx += `\n\n[Custom source the owner defined]\n${custom || '(no description given)'}`;
          lines.push(`📥 Step ${n} · Read (custom): ${custom || 'describe the source'} — connect this source in Integrations to pull it live`);
        } else {
          const { text, summary } = await readSourceText(st.tool, userId);
          ctx += `\n\n[Data from ${st.tool}]\n${text || '(nothing to read — source not connected)'}`;
          const need = DATA_SOURCES.find((d) => d.id === st.tool)?.connect;
          lines.push(`📥 Step ${n} · Read ${st.tool} — ${text ? summary : `needs ${need || 'a connection'}`}`);
        }
      } else if (st.kind === 'generate') {
        const task = st.tool === 'custom' ? (custom || st.instruction) : st.instruction;
        const sys = `You are performing ONE step of an automated workflow for the business. Task: ${task || 'produce the requested output'}. Use the context provided by earlier steps. Return only the output, plain text.`;
        const out = (await generateText({ system: sys, user: ctx, maxTokens: 700 })) ?? `(${task || 'generated output'} — add an OpenRouter key to run this live.)`;
        lastOut = out;
        ctx += `\n\n[Step ${n} output]\n${out}`;
        lines.push(`🧠 Step ${n} · ${task || 'Create'}\n${out}`);
      } else if (st.kind === 'act') {
        if (st.tool === 'custom') {
          lines.push(`⚡ Step ${n} · Custom action: ${custom || 'describe the action'} — ready (connect the tool in Integrations to run it) ⚠︎`);
          continue;
        }
        const [app = '', verb = ''] = String(st.tool).split('|');
        let ok = false;
        if (connector.runAppTask && connectedApps.has(app)) {
          try {
            const r = await connector.runAppTask({ externalUserId: userId, app, query: verb || st.instruction, params: { message: lastOut || st.instruction } });
            ok = !!r.ok;
          } catch {
            /* held */
          }
        }
        lines.push(ok ? `⚡ Step ${n} · ${verb || st.instruction} — done ✅` : `⚡ Step ${n} · ${verb || st.instruction} — ready (connect ${app || 'the app'} in Integrations to run it) ⚠︎`);
      }
    }
    return { title, body: lines.join('\n\n') };
  }

  async function runScheduledTask(userId: string, task: TaskType, spec?: CustomAgentSpec): Promise<{ title: string; body: string; patch?: Record<string, unknown> }> {
    const data = await authStore.getUserData(userId);
    const p = (data.profile ?? {}) as Record<string, string>;
    if (task === 'custom') {
      const dl = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
      if (!spec) return { title: 'Custom agent', body: 'This agent is missing its configuration — re-create it in the Agent Studio.' };
      // Wireframe-built agents run their ordered steps.
      if (spec.steps && spec.steps.length) {
        return runAgentSteps(spec.steps, userId, p.businessName || '', `${spec.name || 'Custom agent'} — ${dl}`);
      }
      const { text: dataText } = spec.dataSource === 'none' ? { text: '' } : await readSourceText(spec.dataSource, userId);
      if (spec.dataSource !== 'none' && !dataText) {
        const src = DATA_SOURCES.find((x) => x.id === spec.dataSource);
        return {
          title: `${spec.name} — ${dl}`,
          body: `${spec.name} is ready: ${spec.description}. It just needs ${src?.connect || 'its data source'} connected in Integrations — there’s nothing to read yet. Once connected, it runs automatically and drops its report here.`,
        };
      }
      const { system, user } = customAgentRun(spec, p.businessName, dataText);
      const body = (await generateText({ system, user, maxTokens: 900 })) ?? fallbackCustomAgent(spec);
      return { title: `${spec.name} — ${dl}`, body };
    }
    if (task === 'cpa_report') {
      const spend = await safeConn(connector.getAdSpend ? () => connector.getAdSpend!(userId) : undefined, []);
      const deals = await safeConn(connector.getDeals ? () => connector.getDeals!(userId) : undefined, []);
      const targetCpa = Number(p.targetCpa) || 85;
      const r = buildCpaReport(spend, deals, targetCpa);
      return { title: r.title, body: r.body };
    }
    if (task === 'recommend') {
      const dl = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
      const spend = await safeConn(connector.getAdSpend ? () => connector.getAdSpend!(userId) : undefined, []);
      const deals = await safeConn(connector.getDeals ? () => connector.getDeals!(userId) : undefined, []);
      const leads = await safeConn(connector.getLeads ? () => connector.getLeads!(userId) : undefined, []);
      const reviews = await safeConn(connector.getReviews ? () => connector.getReviews!(userId) : undefined, []);
      const emails = await safeConn(connector.getRecentEmails ? () => connector.getRecentEmails!(userId, 25) : undefined, []);
      const social = await safeConn(connector.getSocialMetrics ? () => connector.getSocialMetrics!(userId) : undefined, null);
      const scheduledPosts = ((data.scheduledPosts as ScheduledPost[]) ?? []).filter((x) => x.status === 'scheduled').length;
      const stl = (data.speedToLead as { enabled?: boolean } | undefined)?.enabled ?? false;
      const recs = buildRecommendations({ spend, deals, leads, reviews, emails, social, scheduledPosts, targetCpa: Number(p.targetCpa) || null, speedToLeadOn: stl }, new Date());
      if (!recs.length) return { title: `Recommendations — ${dl}`, body: `You’re all optimized today — nothing needs your attention. Nice work.` };
      const urgent = recs.filter((r) => r.severity === 'high').length;
      const lines = recs.map((r, i) => `${i + 1}. ${r.title}\n   Why: ${r.why}\n   Do: ${r.action}`).join('\n\n');
      const body = `You have ${recs.length} recommendation${recs.length > 1 ? 's' : ''}${urgent ? ` — ${urgent} need action now` : ''}. Open Miles and approve the ones you want:\n\n${lines}`;
      return { title: `${recs.length} recommendation${recs.length > 1 ? 's' : ''} — ${dl}`, body };
    }
    if (task === 'email_tasklist') {
      const emails = await safeConn(connector.getRecentEmails ? () => connector.getRecentEmails!(userId, 25) : undefined, []);
      const dateLabel = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
      if (!emails.length)
        return {
          title: 'Morning task list',
          body: 'Connect Gmail in Integrations and each morning I’ll read your inbox and turn it into a prioritized to-do list — new leads and money items first, newsletters ignored.',
        };
      const { system, user } = buildTaskListPrompt(emails, p.businessName);
      const body = (await generateText({ system, user, maxTokens: 800 })) ?? fallbackTaskList(emails);
      return { title: `Morning task list — ${dateLabel}`, body };
    }
    if (task === 'daily_wrapup') {
      const dateLabel = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
      const today = new Date().toDateString();
      const isToday = (ts?: string) => { try { return ts ? new Date(ts).toDateString() === today : false; } catch { return false; } };
      const q = ((data.deploy as { queue?: Array<{ label?: string; status?: string; ts?: string }> })?.queue) ?? [];
      const runs = ((data.agentRuns as AgentRun[]) ?? []).filter((r) => isToday(r.ts) && r.task !== 'daily_wrapup');
      const activity = {
        accomplished: q.filter((c) => isToday(c.ts) && c.status === 'live').map((c) => c.label || 'change'),
        pending: q.filter((c) => c.status === 'pending').map((c) => c.label || 'change'),
        agentRuns: runs.map((r) => r.title),
      };
      const { system, user } = buildWrapupPrompt(activity, p.businessName);
      const body = (await generateText({ system, user, maxTokens: 700 })) ?? fallbackWrapup(activity, dateLabel);
      return { title: `Daily wrap-up — ${dateLabel}`, body };
    }
    // ── content agents (social / reviews / leads / competitors) ──
    const dLabel = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
    const ctx: AgentCtx = {
      business: p.businessName,
      trade: p.industry || 'local-service',
      city: (p.serviceAreas || '').split(',')[0]?.trim() || p.city,
      services: p.services,
      offers: p.currentOffers,
    };
    if (task === 'social_content') {
      const metrics = await safeConn(connector.getSocialMetrics ? () => connector.getSocialMetrics!(userId) : undefined, null);
      const { system, user } = socialAgent(ctx);
      const post = (await generateText({ system, user, maxTokens: 500 })) ?? agentFallback('social_content', ctx);
      return { title: `Today's social post — ${dLabel}`, body: `${post}\n\n${metricsLine(metrics)}` };
    }
    if (task === 'review_responder') {
      const reviews = await safeConn(connector.getReviews ? () => connector.getReviews!(userId) : undefined, []);
      const cctx: AgentCtx = { ...ctx, reviews };
      const { system, user } = reviewAgent(cctx);
      const body = (await generateText({ system, user, maxTokens: 700 })) ?? agentFallback('review_responder', cctx);
      return { title: reviews.length ? `Review replies (${reviews.length}) — ${dLabel}` : `Review reply templates — ${dLabel}`, body };
    }
    if (task === 'lead_followup') {
      const leads = await safeConn(connector.getLeads ? () => connector.getLeads!(userId) : undefined, []);
      const cctx: AgentCtx = { ...ctx, leads };
      const { system, user } = leadAgent(cctx);
      const body = (await generateText({ system, user, maxTokens: 700 })) ?? agentFallback('lead_followup', cctx);
      return { title: leads.length ? `Lead follow-ups (${leads.length}) — ${dLabel}` : `Lead follow-up sequence — ${dLabel}`, body };
    }
    if (task === 'competitor_watch') {
      const { system, user } = competitorAgent(ctx);
      const body = (await generateText({ system, user, maxTokens: 700 })) ?? agentFallback('competitor_watch', ctx);
      return { title: `Competitor watch — ${dLabel}`, body };
    }
    if (task === 'seo_agent') {
      const { system, user } = seoAgent(ctx);
      const body = (await generateText({ system, user, maxTokens: 700 })) ?? agentFallback('seo_agent', ctx);
      return { title: `Local SEO play — ${dLabel}`, body };
    }
    if (task === 'content_writer') {
      const { system, user } = contentAgent(ctx);
      const body = (await generateText({ system, user, maxTokens: 900 })) ?? agentFallback('content_writer', ctx);
      return { title: `SEO blog draft — ${dLabel}`, body };
    }
    if (task === 'geo_agent') {
      const { system, user } = geoAgent(ctx);
      const body = (await generateText({ system, user, maxTokens: 800 })) ?? agentFallback('geo_agent', ctx);
      return { title: `AI-search (GEO) kit — ${dLabel}`, body };
    }
    if (task === 'social_poster') {
      // The full workflow in one run: generate image → write caption → publish to connected socials.
      const brand = brandContextFor(data);
      const vprompt = buildVisualPrompt('social', p.currentOffers || p.services || 'a friendly promotion', brand);
      const imageUrl = falReady() ? await falGenerateImage(vprompt, { aspect: '4:5' }) : null;
      const sa = socialAgent(ctx);
      const caption = (await generateText({ system: sa.system, user: sa.user, maxTokens: 400 })) ?? agentFallback('social_content', ctx);
      let accts: Array<{ app: string }> = [];
      try {
        accts = (await connector.listAccounts(userId)) as Array<{ app: string }>;
      } catch {
        /* none */
      }
      const connectedApps = new Set(accts.map((a) => a.app));
      const targetIds = PLATFORMS.filter((pl) => connectedApps.has(pl.app)).map((pl) => pl.id);
      let statusLine: string;
      if (!imageUrl) statusLine = '🖼 Add FAL_KEY in Render so the daily image generates automatically.';
      else if (!targetIds.length) statusLine = '✅ Image + caption are ready. Connect a social account in Integrations and next run I’ll auto-publish it.';
      else {
        const transient: ScheduledPost = { id: 'agent', assetUrl: imageUrl, kind: 'image', caption, platforms: targetIds, scheduledAt: new Date().toISOString(), status: 'scheduled', createdAt: '' };
        await publishPost(userId, transient);
        const ok = (transient.results || []).filter((r) => r.ok).map((r) => r.platform);
        const bad = (transient.results || []).filter((r) => !r.ok).map((r) => r.platform);
        statusLine = (ok.length ? `✅ Published to ${ok.join(', ')}. ` : '') + (bad.length ? `⚠︎ Couldn’t post to ${bad.join(', ')}.` : '');
      }
      const body = `${caption}\n\n${imageUrl ? `🖼 On-brand image generated: ${imageUrl}` : ''}\n${statusLine}`.trim();
      return { title: `Social media post — ${dLabel}`, body };
    }
    if (task === 'social_report') {
      const metrics = await safeConn(connector.getSocialMetrics ? () => connector.getSocialMetrics!(userId) : undefined, null);
      const nowISO = new Date().toISOString();
      const history = recordSnapshot((data.socialHistory as DailySnapshot[]) ?? [], metrics, nowISO);
      const report = buildSocialReport(history, nowISO);
      return { title: report.title, body: report.body, patch: { socialHistory: history } };
    }
    // morning_brief
    let weatherLine: string | undefined;
    let weatherOpportunity: string | undefined;
    const zip = (p.zip || '').replace(/\D/g, '').slice(0, 5);
    if (zip) {
      try {
        const w = await fetchWeather(zip);
        if (w) {
          weatherLine = `${Math.round(w.tempF)}°F${w.shortForecast ? `, ${w.shortForecast}` : ''}`;
          const trigs = evaluateWeatherTriggers(w, p.industry);
          if (trigs[0]) weatherOpportunity = trigs[0].action || trigs[0].label;
        }
      } catch {
        /* weather is best-effort */
      }
    }
    const deploy = (data.deploy ?? {}) as { queue?: Array<{ status?: string }> };
    const pendingApprovals = (deploy.queue ?? []).filter((c) => c.status === 'pending').length;
    const activeTriggers = ((data.weatherRules as Array<{ enabled?: boolean }>) ?? []).filter((r) => r.enabled).length;
    const dateLabel = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
    return buildMorningBrief({ business: p.businessName, dateLabel, weatherLine, weatherOpportunity, pendingApprovals, activeTriggers });
  }

  function appendRun(data: Record<string, unknown>, agent: ScheduledAgent, result: { title: string; body: string }): AgentRun {
    const run: AgentRun = { id: newToken().slice(0, 10), agentId: agent.id, task: agent.task, ts: new Date().toISOString(), ...result };
    data.agentRuns = [run, ...(((data.agentRuns as AgentRun[]) ?? []))].slice(0, 50);
    return run;
  }

  // Deliver a run to the owner via any channel they've enabled AND that's configured.
  // Best-effort: delivery never breaks (or blocks) an agent run.
  async function deliverRun(email: string | undefined, phone: string | undefined, agent: ScheduledAgent, run: { title: string; body: string }): Promise<void> {
    if (!agent.deliver?.email && !agent.deliver?.sms) return;
    const st = deliveryStatus();
    try {
      if (agent.deliver?.email && st.email && email) await sendEmail(email, run.title, run.body);
      if (agent.deliver?.sms && st.sms && phone) await sendSms(phone, smsExcerpt(run.title, run.body));
    } catch {
      /* delivery failures never surface as run failures */
    }
  }

  // ── Content scheduler — publish a created asset to social platforms on a schedule ──
  // Publishing goes through the connector (Pipedream when live). A platform the
  // customer hasn't connected holds the post rather than pretending it published.
  async function publishPost(userId: string, post: ScheduledPost): Promise<ScheduledPost> {
    let connectedApps = new Set<string>();
    try {
      const accts = await connector.listAccounts(userId);
      connectedApps = new Set(accts.map((a) => a.app));
    } catch {
      /* treat as nothing connected */
    }
    const results: PostResult[] = [];
    for (const pid of post.platforms) {
      const plat = platformById(pid);
      if (!plat) continue;
      if (!connectedApps.has(plat.app)) {
        results.push({ platform: pid, ok: false, note: 'not connected' });
        continue;
      }
      try {
        const r = connector.runAppTask
          ? await connector.runAppTask({ externalUserId: userId, app: plat.app, query: `Create ${post.kind} post`, params: { caption: post.caption, media: post.assetUrl } })
          : null;
        results.push({ platform: pid, ok: !!r?.ok, note: r?.note || r?.summary || (r?.ok ? 'posted' : 'no publisher available') });
      } catch (err) {
        results.push({ platform: pid, ok: false, note: String((err as Error).message) });
      }
    }
    post.results = results;
    post.status = rollupStatus(results);
    post.publishedAt = new Date().toISOString();
    return post;
  }

  // Speed-to-Lead — the keystone: answer brand-new leads within the tick they appear.
  // Runs on every scheduler tick when enabled. Drafts a personalized first touch per
  // new lead and sends it over the CRM when connected; otherwise holds it ready. Mutates
  // `data.speedToLead` (the dedup ledger + log) and returns a run summary, or null when
  // it's off or there's nothing new. Best-effort — a send failure just holds the draft.
  async function runSpeedToLead(userId: string, data: Record<string, unknown>): Promise<{ run: { title: string; body: string } } | null> {
    const st = (data.speedToLead as SpeedToLeadState) ?? null;
    if (!st?.enabled) return null;
    const leads = await safeConn(connector.getLeads ? () => connector.getLeads!(userId) : undefined, []);
    const fresh = selectNewLeads(leads, st.contacted);
    if (!fresh.length) return null;
    const p = (data.profile ?? {}) as Record<string, string>;
    const ctx = {
      business: p.businessName,
      trade: p.industry || 'local-service',
      city: (p.serviceAreas || '').split(',')[0]?.trim() || p.city,
      services: p.services,
      offers: p.currentOffers,
    };
    let connectedApps = new Set<string>();
    try {
      connectedApps = new Set((await connector.listAccounts(userId)).map((a) => a.app));
    } catch {
      /* nothing connected */
    }
    const canSend = connectedApps.has('gohighlevel') && !!connector.runAppTask;
    const nowISO = new Date().toISOString();
    let state = st;
    const blocks: string[] = [];
    for (const lead of fresh) {
      const { system, user } = instantReplyAgent(lead, ctx);
      const reply = (await generateText({ system, user, maxTokens: 400 })) ?? fallbackInstantReply(lead, ctx);
      const channels: string[] = [];
      if (canSend) {
        try {
          const r = await connector.runAppTask!({ externalUserId: userId, app: 'gohighlevel', query: 'Send SMS to new lead', params: { message: smsFromReply(reply), name: lead.name ?? '', phone: lead.phone ?? '' } });
          if (r?.ok) channels.push('sms');
        } catch {
          /* held — draft stays ready */
        }
      }
      const held = channels.length === 0;
      state = recordContact(state, lead, nowISO, channels, held, responseSeconds(lead, nowISO));
      blocks.push(`• ${lead.name || 'New lead'} — ${lead.service || 'inquiry'} (via ${lead.source || 'website'}): ${held ? 'drafted, ready to send' : `sent ${channels.join(' + ')}`}\n${reply}`);
    }
    data.speedToLead = state;
    const title = `Speed-to-Lead: answered ${fresh.length} new lead${fresh.length === 1 ? '' : 's'}`;
    const head = canSend ? '' : '⚠︎ Connect your CRM (GoHighLevel) in Integrations and these send automatically. Drafts are ready below.\n\n';
    return { run: { title, body: head + blocks.join('\n\n') } };
  }

  // Speed-to-Lead config + live status.
  app.get('/api/speed-to-lead', async (req, reply) => {
    const u = await requireUser(req, reply);
    if (!u) return;
    const data = await authStore.getUserData(u.id);
    const st = (data.speedToLead as SpeedToLeadState) ?? emptyStlState();
    let canSend = false;
    try {
      canSend = new Set((await connector.listAccounts(u.id)).map((a) => a.app)).has('gohighlevel');
    } catch {
      /* none */
    }
    return { enabled: !!st.enabled, canSend, stats: responderStats(st, new Date().toISOString()), recent: st.log.slice(0, 10) };
  });
  app.post<{ Body: { enabled?: boolean } }>('/api/speed-to-lead', async (req, reply) => {
    const u = await requireUser(req, reply);
    if (!u) return;
    const data = await authStore.getUserData(u.id);
    const st = (data.speedToLead as SpeedToLeadState) ?? emptyStlState();
    st.enabled = !!req.body?.enabled;
    data.speedToLead = st;
    await authStore.setUserData(u.id, data);
    return { ok: true, enabled: st.enabled };
  });
  app.post('/api/speed-to-lead/run', async (req, reply) => {
    const u = await requireUser(req, reply);
    if (!u) return;
    const data = await authStore.getUserData(u.id);
    const st = (data.speedToLead as SpeedToLeadState) ?? emptyStlState();
    if (!st.enabled) { st.enabled = true; data.speedToLead = st; }
    const result = await runSpeedToLead(u.id, data);
    if (result) {
      const stlAgent: ScheduledAgent = { id: 'speed-to-lead', name: 'Speed-to-Lead', task: 'speed_to_lead', time: '', days: [], enabled: true, tzOffset: 0, createdAt: '' };
      appendRun(data, stlAgent, result.run);
      bumpMeter(data, 'agent_run');
    }
    await authStore.setUserData(u.id, data);
    return { ok: true, ran: !!result, run: result?.run ?? null, stats: responderStats(data.speedToLead as SpeedToLeadState, new Date().toISOString()) };
  });

  app.get('/api/posts', async (req, reply) => {
    const u = await requireUser(req, reply);
    if (!u) return;
    const data = await authStore.getUserData(u.id);
    let connected: string[] = [];
    try {
      connected = [...new Set((await connector.listAccounts(u.id)).map((a) => a.app))];
    } catch {
      /* none */
    }
    const platforms = PLATFORMS.map((p) => ({ id: p.id, label: p.label, icon: p.icon, accepts: p.accepts, connected: connected.includes(p.app) }));
    return { posts: (data.scheduledPosts as ScheduledPost[]) ?? [], platforms };
  });
  app.post<{ Body: Partial<ScheduledPost> }>('/api/posts', async (req, reply) => {
    const u = await requireUser(req, reply);
    if (!u) return;
    const { post, error } = buildPost(req.body ?? {}, new Date());
    if (error || !post) return reply.code(400).send({ error: error || 'Invalid post.' });
    post.id = newToken().slice(0, 10);
    const data = await authStore.getUserData(u.id);
    const list = ((data.scheduledPosts as ScheduledPost[]) ?? []).concat(post).slice(-200);
    data.scheduledPosts = list;
    await authStore.setUserData(u.id, data);
    return { ok: true, post };
  });
  app.post<{ Body: { id?: string } }>('/api/posts/delete', async (req, reply) => {
    const u = await requireUser(req, reply);
    if (!u) return;
    const data = await authStore.getUserData(u.id);
    data.scheduledPosts = ((data.scheduledPosts as ScheduledPost[]) ?? []).filter((p) => p.id !== req.body?.id);
    await authStore.setUserData(u.id, data);
    return { ok: true };
  });
  app.post<{ Body: { id?: string } }>('/api/posts/run', async (req, reply) => {
    const u = await requireUser(req, reply);
    if (!u) return;
    const data = await authStore.getUserData(u.id);
    const list = (data.scheduledPosts as ScheduledPost[]) ?? [];
    const post = list.find((p) => p.id === req.body?.id);
    if (!post) return reply.code(404).send({ error: 'post not found' });
    await publishPost(u.id, post);
    await authStore.setUserData(u.id, data);
    return { ok: true, post };
  });

  app.get('/api/schedules', async (req, reply) => {
    const u = await requireUser(req, reply);
    if (!u) return;
    const data = await authStore.getUserData(u.id);
    return { agents: (data.schedules as ScheduledAgent[]) ?? [], runs: (data.agentRuns as AgentRun[]) ?? [], tasks: TASK_SPECS };
  });
  app.put<{ Body: { agents?: ScheduledAgent[] } }>('/api/schedules', async (req, reply) => {
    const u = await requireUser(req, reply);
    if (!u) return;
    const data = await authStore.getUserData(u.id);
    data.schedules = (req.body?.agents ?? []).slice(0, 25);
    await authStore.setUserData(u.id, data);
    return { ok: true };
  });
  app.post<{ Body: { id?: string } }>('/api/schedules/run', async (req, reply) => {
    const u = await requireUser(req, reply);
    if (!u) return;
    const data = await authStore.getUserData(u.id);
    const agent = ((data.schedules as ScheduledAgent[]) ?? []).find((a) => a.id === req.body?.id);
    if (!agent) return reply.code(404).send({ error: 'agent not found' });
    const result = await runScheduledTask(u.id, agent.task, agent.spec);
    if (result.patch) Object.assign(data, result.patch);
    const run = appendRun(data, agent, { title: result.title, body: result.body });
    agent.lastRunAt = run.ts;
    bumpMeter(data, 'agent_run');
    await authStore.setUserData(u.id, data);
    await deliverRun(u.email, (data.profile as Record<string, string>)?.phone, agent, run);
    return { ok: true, run };
  });

  // ── Agent Wireframes — visually-built custom agents (Trigger → steps) ──
  interface Wireframe { id: string; name: string; time: string; days: number[]; steps: AgentStep[]; createdAt: string }
  function cleanSteps(raw: unknown): AgentStep[] {
    if (!Array.isArray(raw)) return [];
    return raw
      .slice(0, 12)
      .map((s) => {
        const o = (s ?? {}) as Record<string, unknown>;
        const kind = o.kind === 'read' || o.kind === 'generate' || o.kind === 'act' ? o.kind : 'generate';
        const step: AgentStep = { kind, tool: String(o.tool ?? '').slice(0, 80), instruction: String(o.instruction ?? '').slice(0, 500) };
        if (o.tool === 'custom' && o.custom) step.custom = String(o.custom).slice(0, 300);
        return step;
      })
      .filter((s) => s.tool || s.instruction || s.custom);
  }
  function specFromWireframe(wf: { name?: string; time?: string; days?: number[]; steps?: unknown }): CustomAgentSpec {
    const steps = cleanSteps(wf.steps);
    const time = typeof wf.time === 'string' && /^\d{1,2}:\d{2}$/.test(wf.time) ? wf.time : '09:00';
    const days = Array.isArray(wf.days) && wf.days.length ? wf.days.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6) : [1, 2, 3, 4, 5];
    return { name: String(wf.name ?? '').slice(0, 80) || 'Custom agent', description: `A ${steps.length}-step custom agent built in the wireframe.`, dataSource: 'none', systemPrompt: '', time, days, steps };
  }

  app.get('/api/wireframes', async (req, reply) => {
    const u = await requireUser(req, reply);
    if (!u) return;
    const data = await authStore.getUserData(u.id);
    return { wireframes: (data.wireframes as Wireframe[]) ?? [] };
  });
  app.put<{ Body: { wireframes?: Wireframe[] } }>('/api/wireframes', async (req, reply) => {
    const u = await requireUser(req, reply);
    if (!u) return;
    const data = await authStore.getUserData(u.id);
    const list = (req.body?.wireframes ?? []).slice(0, 30).map((w) => ({
      id: String(w.id ?? newToken().slice(0, 10)),
      name: String(w.name ?? '').slice(0, 80),
      time: w.time ?? '09:00',
      days: Array.isArray(w.days) ? w.days : [1, 2, 3, 4, 5],
      steps: cleanSteps(w.steps),
      createdAt: w.createdAt ?? new Date().toISOString(),
    }));
    data.wireframes = list;
    await authStore.setUserData(u.id, data);
    return { ok: true };
  });
  // Preview-run a wireframe without deploying it (builds a transient spec).
  app.post<{ Body: { name?: string; time?: string; days?: number[]; steps?: unknown } }>('/api/wireframes/run', async (req, reply) => {
    const u = await requireUser(req, reply);
    if (!u) return;
    const spec = specFromWireframe(req.body ?? {});
    if (!spec.steps?.length) return reply.code(400).send({ error: 'Add at least one step first.' });
    const result = await runScheduledTask(u.id, 'custom', spec);
    return { ok: true, run: { title: result.title, body: result.body } };
  });
  // Deploy a wireframe as a scheduled custom agent that runs its steps on schedule.
  app.post<{ Body: { name?: string; time?: string; days?: number[]; steps?: unknown; tzOffset?: number } }>('/api/wireframes/deploy', async (req, reply) => {
    const u = await requireUser(req, reply);
    if (!u) return;
    const spec = specFromWireframe(req.body ?? {});
    if (!spec.steps?.length) return reply.code(400).send({ error: 'Add at least one step before deploying.' });
    const data = await authStore.getUserData(u.id);
    const agent: ScheduledAgent = {
      id: newToken().slice(0, 10),
      name: spec.name,
      task: 'custom',
      spec,
      time: spec.time,
      days: spec.days,
      enabled: true,
      tzOffset: Number(req.body?.tzOffset) || 0,
      createdAt: new Date().toISOString(),
    };
    data.schedules = ((data.schedules as ScheduledAgent[]) ?? []).concat(agent).slice(0, 25);
    await authStore.setUserData(u.id, data);
    return { ok: true, agent };
  });

  // The scheduler tick — find every due agent across all users and run it. Called
  // on an interval by index.ts (never during tests). Best-effort: logged, never throws.
  (app as unknown as { runDueSchedules: () => Promise<void> }).runDueSchedules = async () => {
    lastTickAt = new Date().toISOString();
    const now = new Date();
    let ids: string[];
    try {
      ids = await authStore.listUserIds();
    } catch {
      return;
    }
    for (const uid of ids) {
      try {
        const data = await authStore.getUserData(uid);
        const agents = (data.schedules as ScheduledAgent[]) ?? [];
        const delivered: Array<{ agent: ScheduledAgent; run: { title: string; body: string } }> = [];
        let changed = false;
        for (const agent of agents) {
          if (!isDue(agent, now)) continue;
          const result = await runScheduledTask(uid, agent.task, agent.spec);
          if (result.patch) Object.assign(data, result.patch);
          const run = appendRun(data, agent, { title: result.title, body: result.body });
          agent.lastRunAt = new Date().toISOString();
          bumpMeter(data, 'agent_run');
          if (agent.deliver?.email || agent.deliver?.sms) delivered.push({ agent, run });
          changed = true;
        }
        // Publish any content posts whose scheduled time has arrived.
        const posts = (data.scheduledPosts as ScheduledPost[]) ?? [];
        for (const post of posts) {
          if (!postDue(post, now)) continue;
          await publishPost(uid, post);
          changed = true;
        }
        // Speed-to-Lead — answer brand-new leads on this tick (near real-time).
        const stl = await runSpeedToLead(uid, data);
        if (stl) {
          const stlAgent: ScheduledAgent = { id: 'speed-to-lead', name: 'Speed-to-Lead', task: 'speed_to_lead', time: '', days: [], enabled: true, tzOffset: 0, createdAt: '' };
          appendRun(data, stlAgent, stl.run);
          bumpMeter(data, 'agent_run');
          changed = true;
        }
        if (changed) await authStore.setUserData(uid, data);
        if (delivered.length) {
          const user = await authStore.getUserById(uid);
          const phone = (data.profile as Record<string, string>)?.phone;
          for (const { agent, run } of delivered) await deliverRun(user?.email, phone, agent, run);
        }
      } catch {
        /* one user's failure never stops the rest */
      }
    }
  };

  // Real observed LSA economics (SearchLight benchmark) + the breakeven math.
  app.get('/api/benchmarks', async () => ({
    trades: LSA_TRADES,
    blended: LSA_BLENDED,
    vsGoogle: LSA_VS_GOOGLE,
    meta: BENCHMARK_META,
    hub: BENCHMARK_HUB,
    coverage: hubCoverage(),
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
    // Seed the conversation with the owner's business profile so anything Miles builds
    // (email campaigns, content) is on-brand even if they didn't restate it in chat.
    const u = await getUser(req);
    if (u) {
      const data = await authStore.getUserData(u.id);
      const p = (data.profile ?? {}) as Record<string, string>;
      if (!session.intake.businessName && p.businessName) session.intake.businessName = p.businessName;
      if (!session.intake.category && p.industry) session.intake.category = p.industry;
      if (!session.intake.services && p.services)
        session.intake.services = String(p.services).split(',').map((x) => x.trim()).filter(Boolean);
    }
    const res = await agent.handle(session, text);
    store.save(sessionId, res.session);
    return res.reply;
  });

  // Conversational chat — a general assistant (ask questions, do research), seeded
  // with the owner's business profile, with a selectable depth/research mode.
  app.post<{ Body: { messages?: Array<{ role?: string; text?: string }>; mode?: string } }>('/api/chat/ask', async (req, reply) => {
    const u = await requireUser(req, reply);
    if (!u) return;
    const data = await authStore.getUserData(u.id);
    const p = (data.profile ?? {}) as Record<string, string>;
    const mode = ['easy', 'medium', 'high', 'research'].includes(req.body?.mode ?? '') ? (req.body!.mode as string) : 'medium';
    const cfg: Record<string, { tokens: number; style: string }> = {
      easy: { tokens: 500, style: 'Answer briefly and plainly — a few sentences, straight to the point, no filler.' },
      medium: { tokens: 900, style: 'Give a clear, helpful answer with light structure (a short intro and bullets where useful).' },
      high: { tokens: 1500, style: 'Think it through thoroughly. Give a well-structured, step-by-step answer with specifics, examples, and the reasoning behind your advice.' },
      research: { tokens: 2200, style: 'Act as a research analyst. Produce an in-depth, well-organized report: use Markdown headings and bullets, cover options and trade-offs, cite concrete numbers/benchmarks where you know them, state assumptions, and finish with clear, prioritized recommendations.' },
    };
    const m = cfg[mode]!;
    const bizBits = [p.businessName && `the business "${p.businessName}"`, p.industry && `industry: ${p.industry}`, p.serviceAreas && `area: ${p.serviceAreas}`, p.services && `services: ${p.services}`].filter(Boolean).join('; ');
    const system =
      `You are Miles, an expert AI marketing and business assistant for local-service / home-services businesses. ` +
      `Answer questions and do research for the owner like a sharp, practical consultant. ` +
      (bizBits ? `Context about the owner's business — ${bizBits}. Use it when relevant. ` : '') +
      m.style +
      ` Be accurate and honest; if you don't know or can't verify something, say so plainly rather than guessing. Use plain text with light Markdown (headings, **bold**, bullet lists) for readability. Never invent statistics.`;
    const msgs = (req.body?.messages ?? []).filter((x) => x && x.text).slice(-16);
    const convo = msgs.map((x) => `${x.role === 'user' ? 'User' : 'Miles'}: ${x.text}`).join('\n\n') || 'The user just opened the chat.';
    const text = await generateText({ system, user: convo, maxTokens: m.tokens });
    if (text) await meterUser(u.id, 'text');
    return { text: text ?? "I can't reach my language model right now — add an OPENROUTER_API_KEY on Render and I'll answer live.", live: !!text, mode };
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
