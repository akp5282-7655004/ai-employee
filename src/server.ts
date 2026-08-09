import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import { Agent } from './agent/index.js';
import { MockInterpreter } from './agent/intent.js';
import { LlmInterpreter } from './agent/llm.js';
import { getConnector, type Connector } from './connectors/index.js';
import { MemorySessionStore, type SessionStore } from './session.js';

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
}

// Served from the repo root (npm start / npm run dev both run from there).
const WEB_DIR = join(process.cwd(), 'web');

export function buildServer(deps: ServerDeps = {}): FastifyInstance {
  const app = Fastify({ logger: false });
  const store = deps.store ?? new MemorySessionStore();
  const connector = deps.connector ?? getConnector();
  const interpreter = process.env.ANTHROPIC_API_KEY ? new LlmInterpreter() : new MockInterpreter();
  const agent = new Agent({ connector, interpreter });

  const page = (() => {
    try {
      const html = readFileSync(join(WEB_DIR, 'index.html'), 'utf8');
      // Tell the page it's server-backed so it calls the real API instead of the
      // inline fallback engine.
      return html.replace('<body>', '<body>\n<script>window.MILES_SERVER=true;</script>');
    } catch {
      return '<!doctype html><title>Miles</title><p>Build the web/ dir.</p>';
    }
  })();

  app.get('/', async (_req, reply) => reply.type('text/html').send(page));
  app.get('/favicon.ico', async (_req, reply) => reply.code(204).send());
  app.get('/health', async () => ({ ok: true, interpreter: interpreter.name, connector: connector.name }));

  // One turn of the conversation.
  app.post<{ Body: { sessionId?: string; text?: string } }>('/api/message', async (req, reply) => {
    const { sessionId, text } = req.body ?? {};
    if (!sessionId || typeof text !== 'string') return reply.code(400).send({ error: 'sessionId and text required' });
    const session = store.getOrCreate(sessionId);
    const res = await agent.handle(session, text);
    store.save(sessionId, res.session);
    return res.reply;
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
