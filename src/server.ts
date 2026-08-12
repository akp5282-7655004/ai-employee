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
import { falReady, falGenerateImage, falGenerateVideo, falGenerateAudio, type Aspect } from './creative/fal.js';
import { ASSET_TYPES, specFor, buildVisualPrompt, buildTextPrompt, fallbackText, optimizerSystem, type BrandContext } from './creative/studio.js';
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
  type AgentCtx,
  type ScheduledAgent,
  type AgentRun,
  type TaskType,
} from './agents/scheduled.js';
import { fetchDemographics } from './research/census.js';
import { fetchWeather, evaluateWeatherTriggers } from './research/weather.js';
import { importSite } from './research/site.js';
import { auditSite, buildAuditPrompt, fallbackAuditSummary } from './research/audit.js';
import { applyMeter, summarizeUsage, type MeterKind, type Usage } from './usage/meter.js';
import { modelsForKind, modelById, defaultModel, modelActive, recommendModel, type MediaKind } from './creative/models.js';
import { openaiGenerateImage } from './creative/openai_image.js';
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
  app.get('/favicon.ico', async (_req, reply) => reply.code(204).send());
  app.get('/health', async () => ({ ok: true, interpreter: interpreter.name, connector: connector.name, store: authStore.name }));

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
    if (text) return { text, live: true, skill: match.skill.name, play: match.play.label };
    return {
      text: `“${match.play.label}” is ready to generate. Add an OpenRouter key on Render and Miles will write this custom for ${biz} — expert ${match.skill.category.toLowerCase()} output, on-brand, in seconds.`,
      live: false,
      skill: match.skill.name,
      play: match.play.label,
    };
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
  app.put<{ Body: { model?: { mode?: string; quality?: string } } }>('/api/model', async (req, reply) => {
    const u = await requireUser(req, reply);
    if (!u) return;
    const data = await authStore.getUserData(u.id);
    const m = req.body?.model ?? {};
    data.model = {
      mode: m.mode === 'manual' ? 'manual' : 'auto',
      quality: ['value', 'balanced', 'max'].includes(m.quality ?? '') ? m.quality : 'balanced',
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
    return { connector: connector.name, hub: { ready: pdReady }, connectedApps };
  });

  // Closed-loop revenue attribution — ad spend correlated to CRM deals by UTM.
  app.get<{ Querystring: { sessionId?: string } }>('/api/revenue', async (req) => {
    const sessionId = req.query?.sessionId;
    if (!sessionId) return { report: null, deals: [], connected: false };
    try {
      const spend = connector.getAdSpend ? await connector.getAdSpend(sessionId) : [];
      const deals = connector.getDeals ? await connector.getDeals(sessionId) : [];
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
      return connector.listApps ? await connector.listApps(q, limit, req.query?.after) : { apps: [] };
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

  app.post<{ Body: { type?: string; prompt?: string; aspect?: Aspect; style?: string; quality?: 'standard' | 'premium'; duration?: number; model?: string } }>(
    '/api/studio',
    async (req, reply) => {
      const u = await requireUser(req, reply);
      if (!u) return;
      const body = req.body ?? {};
      const spec = specFor(body.type ?? 'image') ?? specFor('image')!;
      const data = await authStore.getUserData(u.id);
      const p = (data.profile ?? {}) as Record<string, string>;
      const brand: BrandContext = {
        business: p.businessName,
        vertical: p.industry,
        category: p.industry,
        city: (p.serviceAreas || '').split(',')[0]?.trim(),
        services: (p.services || '').split(',').map((s) => s.trim()).filter(Boolean),
      };
      if (spec.kind === 'text') {
        const { system, user } = buildTextPrompt(spec.type, body.prompt ?? '', brand);
        const text = (await generateText({ system, user })) ?? fallbackText(spec.type, body.prompt ?? '', brand);
        await meterUser(u.id, 'text');
        return { type: spec.type, kind: 'text', text, live: textLlmReady() };
      }
      // Resolve the chosen media model (registry id) or the reliable default for the kind.
      const mediaKind = spec.kind as MediaKind;
      const picked = modelById(body.model);
      const chosen = picked && picked.kind === mediaKind ? picked : defaultModel(mediaKind);
      const def = defaultModel(mediaKind);

      if (spec.kind === 'audio') {
        const url = await falGenerateAudio(body.prompt ?? '', { voice: body.style, model: chosen.falModel });
        await meterUser(u.id, 'audio', 1, chosen.credits);
        return { type: spec.type, kind: 'audio', url, model: chosen.id, live: falReady() };
      }
      const prompt = buildVisualPrompt(spec.type, body.prompt ?? '', brand, body.style);
      const aspect = (body.aspect ?? spec.defaultAspect) as Aspect;
      if (spec.kind === 'video') {
        let url = await falGenerateVideo(prompt, { aspect, duration: body.duration, model: chosen.falModel });
        // A premium pick that returns nothing falls back to the reliable default.
        if (!url && chosen.id !== def.id) url = await falGenerateVideo(prompt, { aspect, duration: body.duration, model: def.falModel });
        await meterUser(u.id, 'video', 1, chosen.credits);
        return { type: spec.type, kind: 'video', url, prompt, model: chosen.id, live: falReady() };
      }
      // image — route by provider, always falling back to the default fal model.
      let url: string | null = chosen.provider === 'openai'
        ? await openaiGenerateImage(prompt, { aspect })
        : await falGenerateImage(prompt, { aspect, model: chosen.falModel });
      if (!url && chosen.id !== def.id) url = await falGenerateImage(prompt, { aspect, model: def.falModel });
      await meterUser(u.id, 'image', 1, chosen.credits);
      return { type: spec.type, kind: 'image', url, prompt, model: chosen.id, live: falReady() };
    },
  );

  // "Optimize prompt" — rewrite a customer's rough idea into an expert prompt for
  // the asset type, so non-prompt-engineers get great results. Returns just the
  // improved prompt to drop back into the input for review before Generate.
  app.post<{ Body: { type?: string; prompt?: string } }>('/api/studio/optimize', async (req, reply) => {
    const u = await requireUser(req, reply);
    if (!u) return;
    const spec = specFor(req.body?.type ?? 'image') ?? specFor('image')!;
    const rough = (req.body?.prompt ?? '').trim();
    if (!rough) return reply.code(400).send({ error: 'Type a rough idea first.' });
    const data = await authStore.getUserData(u.id);
    const p = (data.profile ?? {}) as Record<string, string>;
    const who = `${p.businessName || 'a local business'} — ${p.industry || 'local-service'}${p.serviceAreas ? `, ${p.serviceAreas}` : ''}${p.services ? `. Services: ${p.services}` : ''}`;
    const improved = await generateText({
      system: optimizerSystem(spec.kind),
      user: `Business: ${who}.\nMaking: a ${spec.label.toLowerCase()}.\nTheir rough idea: "${rough}"\n\nRewrite it now.`,
      maxTokens: 500,
    });
    await meterUser(u.id, 'text');
    return { prompt: (improved || rough).trim(), improved: !!improved, live: textLlmReady() };
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
  async function runScheduledTask(userId: string, task: TaskType, spec?: CustomAgentSpec): Promise<{ title: string; body: string }> {
    const data = await authStore.getUserData(userId);
    const p = (data.profile ?? {}) as Record<string, string>;
    if (task === 'custom') {
      const dl = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
      if (!spec) return { title: 'Custom agent', body: 'This agent is missing its configuration — re-create it in the Agent Studio.' };
      let dataText = '';
      if (spec.dataSource === 'emails') {
        const e = connector.getRecentEmails ? await connector.getRecentEmails(userId, 25) : [];
        dataText = e.map((m, i) => `${i + 1}. From: ${m.from || '?'} | ${m.subject || '(none)'} | ${m.snippet || ''}`).join('\n');
      } else if (spec.dataSource === 'reviews') {
        const r = connector.getReviews ? await connector.getReviews(userId) : [];
        dataText = r.map((x) => `${x.rating}★ from ${x.author || 'a customer'}: ${x.text || ''}`).join('\n');
      } else if (spec.dataSource === 'leads') {
        const l = connector.getLeads ? await connector.getLeads(userId) : [];
        dataText = l.map((x) => `${x.name || 'Lead'} — ${x.service || 'inquiry'} (via ${x.source || 'unknown'})`).join('\n');
      } else if (spec.dataSource === 'social') {
        const m = connector.getSocialMetrics ? await connector.getSocialMetrics(userId) : null;
        dataText = m ? `impressions ${m.impressions}, clicks ${m.clicks}, likes ${m.likes}${m.followers ? `, followers ${m.followers}` : ''}` : '';
      } else if (spec.dataSource === 'adspend') {
        const s = connector.getAdSpend ? await connector.getAdSpend(userId) : [];
        dataText = s.map((x) => `${x.platform}/${x.campaign}: $${x.spend} spent, ${x.conversions} conversions`).join('\n');
      } else if (spec.dataSource === 'deals') {
        const d2 = connector.getDeals ? await connector.getDeals(userId) : [];
        dataText = d2.map((x) => `$${x.value} ${x.won ? 'won' : 'lost'} via ${x.utmSource || 'unknown'}`).join('\n');
      }
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
      const spend = connector.getAdSpend ? await connector.getAdSpend(userId) : [];
      const deals = connector.getDeals ? await connector.getDeals(userId) : [];
      const targetCpa = Number(p.targetCpa) || 85;
      const r = buildCpaReport(spend, deals, targetCpa);
      return { title: r.title, body: r.body };
    }
    if (task === 'email_tasklist') {
      const emails = connector.getRecentEmails ? await connector.getRecentEmails(userId, 25) : [];
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
      const metrics = connector.getSocialMetrics ? await connector.getSocialMetrics(userId) : null;
      const { system, user } = socialAgent(ctx);
      const post = (await generateText({ system, user, maxTokens: 500 })) ?? agentFallback('social_content', ctx);
      return { title: `Today's social post — ${dLabel}`, body: `${post}\n\n${metricsLine(metrics)}` };
    }
    if (task === 'review_responder') {
      const reviews = connector.getReviews ? await connector.getReviews(userId) : [];
      const cctx: AgentCtx = { ...ctx, reviews };
      const { system, user } = reviewAgent(cctx);
      const body = (await generateText({ system, user, maxTokens: 700 })) ?? agentFallback('review_responder', cctx);
      return { title: reviews.length ? `Review replies (${reviews.length}) — ${dLabel}` : `Review reply templates — ${dLabel}`, body };
    }
    if (task === 'lead_followup') {
      const leads = connector.getLeads ? await connector.getLeads(userId) : [];
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
    const run = appendRun(data, agent, result);
    agent.lastRunAt = run.ts;
    bumpMeter(data, 'agent_run');
    await authStore.setUserData(u.id, data);
    await deliverRun(u.email, (data.profile as Record<string, string>)?.phone, agent, run);
    return { ok: true, run };
  });

  // The scheduler tick — find every due agent across all users and run it. Called
  // on an interval by index.ts (never during tests). Best-effort: logged, never throws.
  (app as unknown as { runDueSchedules: () => Promise<void> }).runDueSchedules = async () => {
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
          const run = appendRun(data, agent, result);
          agent.lastRunAt = new Date().toISOString();
          bumpMeter(data, 'agent_run');
          if (agent.deliver?.email || agent.deliver?.sms) delivered.push({ agent, run });
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
