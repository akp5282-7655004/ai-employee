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
  app.get('/favicon.ico', async (_req, reply) => reply.code(204).send());
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

  // Overview dashboard — everything at a glance, from real workspace data. Numbers
  // that need a connected tool say "connect" rather than showing a fake figure.
  app.get('/api/dashboard', async (req, reply) => {
    const u = await requireUser(req, reply);
    if (!u) return;
    const d = await authStore.getUserData(u.id);
    const p = (d.profile ?? {}) as Record<string, string>;
    const q = ((d.deploy as { queue?: Array<{ status?: string; ts?: string; label?: string; type?: string }> })?.queue) ?? [];
    const runs = (d.agentRuns as AgentRun[]) ?? [];
    const posts = (d.scheduledPosts as ScheduledPost[]) ?? [];
    const agents = (d.schedules as ScheduledAgent[]) ?? [];
    const within7 = (ts?: string) => { const t = Date.parse(ts || ''); return Number.isFinite(t) && Date.now() - t < 7 * 86_400_000; };
    const safe = async <T,>(fn: (() => Promise<T>) | undefined, empty: T): Promise<T> => { try { return fn ? await fn() : empty; } catch { return empty; } };
    const spend = await safe(connector.getAdSpend ? () => connector.getAdSpend!(u.id) : undefined, [] as import('./revenue/attribution.js').CampaignSpend[]);
    const deals = await safe(connector.getDeals ? () => connector.getDeals!(u.id) : undefined, [] as import('./revenue/attribution.js').Deal[]);
    const leads = await safe(connector.getLeads ? () => connector.getLeads!(u.id) : undefined, [] as import('./connectors/types.js').Lead[]);
    const reviews = await safe(connector.getReviews ? () => connector.getReviews!(u.id) : undefined, [] as import('./connectors/types.js').Review[]);
    const social = await safe(connector.getSocialMetrics ? () => connector.getSocialMetrics!(u.id) : undefined, null as import('./connectors/types.js').SocialMetrics | null);
    const totalSpend = spend.reduce((s, x) => s + (x.spend || 0), 0);
    const totalConv = spend.reduce((s, x) => s + (x.conversions || 0), 0);
    const revenue = deals.filter((x) => x.won).reduce((s, x) => s + (x.value || 0), 0);
    return {
      business: p.businessName || '',
      kpis: {
        pendingApprovals: q.filter((c) => c.status === 'pending').length,
        liveChanges: q.filter((c) => c.status === 'live').length,
        agentsDeployed: agents.length,
        agentRuns7d: runs.filter((r) => within7(r.ts)).length,
        scheduledPosts: posts.filter((x) => x.status === 'scheduled').length,
        publishedPosts: posts.filter((x) => x.status === 'published').length,
        creditsUsed: summarizeUsage(d.usage as Usage | undefined, new Date()).credits,
        weatherTriggers: ((d.weatherRules as Array<{ enabled?: boolean }>) ?? []).filter((r) => r.enabled).length,
      },
      marketing: { connected: spend.length > 0, spend: Math.round(totalSpend), conversions: totalConv, cpa: totalConv ? Math.round((totalSpend / totalConv) * 100) / 100 : null, revenue: Math.round(revenue), targetCpa: Number(p.targetCpa) || null },
      leads: { connected: leads.length > 0, count: leads.length, uncontacted: leads.filter((l) => !l.contacted).length },
      speedToLead: responderStats(d.speedToLead as SpeedToLeadState | undefined, new Date().toISOString()),
      reviews: { connected: reviews.length > 0, count: reviews.length, avg: reviews.length ? Math.round((reviews.reduce((s, r) => s + (r.rating || 0), 0) / reviews.length) * 10) / 10 : null },
      social,
      upcomingPosts: posts.filter((x) => x.status === 'scheduled').sort((a, b) => Date.parse(a.scheduledAt) - Date.parse(b.scheduledAt)).slice(0, 5).map((x) => ({ caption: x.caption, platforms: x.platforms, scheduledAt: x.scheduledAt, kind: x.kind })),
      recentRuns: runs.slice(0, 6).map((r) => ({ title: r.title, ts: r.ts, task: r.task })),
    };
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
  async function runScheduledTask(userId: string, task: TaskType, spec?: CustomAgentSpec): Promise<{ title: string; body: string; patch?: Record<string, unknown> }> {
    const data = await authStore.getUserData(userId);
    const p = (data.profile ?? {}) as Record<string, string>;
    if (task === 'custom') {
      const dl = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
      if (!spec) return { title: 'Custom agent', body: 'This agent is missing its configuration — re-create it in the Agent Studio.' };
      let dataText = '';
      if (spec.dataSource === 'emails') {
        const e = await safeConn(connector.getRecentEmails ? () => connector.getRecentEmails!(userId, 25) : undefined, []);
        dataText = e.map((m, i) => `${i + 1}. From: ${m.from || '?'} | ${m.subject || '(none)'} | ${m.snippet || ''}`).join('\n');
      } else if (spec.dataSource === 'reviews') {
        const r = await safeConn(connector.getReviews ? () => connector.getReviews!(userId) : undefined, []);
        dataText = r.map((x) => `${x.rating}★ from ${x.author || 'a customer'}: ${x.text || ''}`).join('\n');
      } else if (spec.dataSource === 'leads') {
        const l = await safeConn(connector.getLeads ? () => connector.getLeads!(userId) : undefined, []);
        dataText = l.map((x) => `${x.name || 'Lead'} — ${x.service || 'inquiry'} (via ${x.source || 'unknown'})`).join('\n');
      } else if (spec.dataSource === 'social') {
        const m = await safeConn(connector.getSocialMetrics ? () => connector.getSocialMetrics!(userId) : undefined, null);
        dataText = m ? `impressions ${m.impressions}, clicks ${m.clicks}, likes ${m.likes}${m.followers ? `, followers ${m.followers}` : ''}` : '';
      } else if (spec.dataSource === 'adspend') {
        const s = await safeConn(connector.getAdSpend ? () => connector.getAdSpend!(userId) : undefined, []);
        dataText = s.map((x) => `${x.platform}/${x.campaign}: $${x.spend} spent, ${x.conversions} conversions`).join('\n');
      } else if (spec.dataSource === 'deals') {
        const d2 = await safeConn(connector.getDeals ? () => connector.getDeals!(userId) : undefined, []);
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
      const spend = await safeConn(connector.getAdSpend ? () => connector.getAdSpend!(userId) : undefined, []);
      const deals = await safeConn(connector.getDeals ? () => connector.getDeals!(userId) : undefined, []);
      const targetCpa = Number(p.targetCpa) || 85;
      const r = buildCpaReport(spend, deals, targetCpa);
      return { title: r.title, body: r.body };
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
