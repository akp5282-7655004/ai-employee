import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { boardCopy, buildSkillsBoard } from '../src/dashboard/skillsboard.js';
import { playbookTrades } from '../src/agents/playbook.js';
import { SEVEN_SKILLS } from '../src/skills/seven.js';
import { SKILL_CATALOG } from '../src/skills/catalog.js';
import { listPacks } from '../src/packs/index.js';
import { buildServer } from '../src/server.js';
import { MemoryStore } from '../src/db/index.js';
import type { Connector } from '../src/connectors/types.js';

function text(board: ReturnType<typeof buildSkillsBoard>): string {
  return boardCopy(board).join('\n');
}

describe('skills and playbooks board', () => {
  it('lists every stored trade playbook with the same cost per lead the budget check uses', () => {
    const board = buildSkillsBoard({ trade: 'Painting' });
    const playbooks = board.cards.filter((card) => card.group === 'playbook');
    expect(playbooks.map((card) => card.id)).toEqual(playbookTrades().map((trade) => `playbook-${trade.key}`));
    const painting = playbooks.find((card) => card.id === 'playbook-painting')!;
    expect(painting.yours).toBe(true);
    expect(painting.status).toBe('Your trade');
    const study = painting.lines.find((line) => line.label === 'Cost per lead Miles uses')!.text;
    const planning = painting.lines.find((line) => line.label === 'Playbook planning range')!.text;
    expect(study).toMatch(/\$104 to \$149/);
    expect(study).toMatch(/similar home-services trades/);
    expect(study).toMatch(/budget check/);
    expect(planning).toMatch(/\$40 to \$90/);
    expect(planning).toMatch(/does not use it/);
    expect(painting.lines.find((line) => line.label === 'Season')!.text).toMatch(/spring/);
    expect(painting.summary).toMatch(/paused Google Search/);
    expect(painting.facts.join(' ')).toMatch(/\$104 to \$149/);
    expect(painting.facts.join(' ')).toMatch(/Season:/);
    expect(painting.badge).toBe('Available');
    expect(board.cards.filter((card) => card.group === 'playbook' || card.group === 'pack').every((card) => card.badge === 'Active' || card.badge === 'Available')).toBe(true);
    expect(painting.lines.find((line) => line.label === 'Campaign structure')!.text).toMatch(/prospecting group/);
    const roofing = playbooks.find((card) => card.id === 'playbook-roofing')!;
    expect(roofing.lines.find((line) => line.label === 'Campaign structure')!.text).toMatch(/pitched and shingle/);
    expect(roofing.lines.find((line) => line.label === 'Cost per lead Miles uses')!.text).toMatch(/\$124/);
    const copy = text(board);
    expect(copy.toLowerCase()).not.toContain('searchlight');
    expect(copy).not.toContain('\u2014');
  });

  it('includes the real packs and does not invent a dental cost per lead', () => {
    const board = buildSkillsBoard({});
    const packs = board.cards.filter((card) => card.group === 'pack');
    expect(packs.map((card) => card.id).sort()).toEqual(listPacks().map((pack) => `pack-${pack.id}`).sort());
    const dental = packs.find((card) => card.id === 'pack-dental')!;
    const joined = dental.lines.map((line) => line.text).join(' ');
    expect(joined).toMatch(/does not invent a cost per lead/);
    expect(joined).toMatch(/Emergency Dental/);
    expect(joined).not.toMatch(/\$78/);
  });

  it('marks only the skills this tenant has turned on', () => {
    const off = buildSkillsBoard({ trade: 'Plumbing' });
    const speedOff = off.cards.find((card) => card.id === 'speed-to-lead')!;
    expect(speedOff.active).toBe(false);
    expect(speedOff.status).toBe('Off');
    const on = buildSkillsBoard({
      trade: 'Plumbing',
      speedOn: true,
      reviewOn: true,
      activation: 'enabled',
      hasSearchPlan: true,
      socialConnected: true,
      scheduledPosts: 2,
      installed: ['google-ads'],
      deployed: ['loser-pauser'],
      ghlConnected: true,
      noShowOn: true,
    });
    expect(on.cards.find((card) => card.id === 'speed-to-lead')!.status).toBe('On');
    expect(on.cards.find((card) => card.id === 'speed-to-lead')!.badge).toBe('Active');
    expect(on.cards.find((card) => card.id === 'speed-to-lead')!.facts.join(' ')).toMatch(/text back|GoHighLevel|lead/i);
    expect(on.cards.find((card) => card.id === 'reviews')!.active).toBe(true);
    expect(on.cards.find((card) => card.id === 'google-search')!.status).toBe('Running');
    expect(on.cards.find((card) => card.id === 'social')!.status).toBe('2 scheduled');
    expect(on.cards.find((card) => card.id === 'seo-pages')!.status).toMatch(/draft/);
    expect(on.cards.find((card) => card.id === 'seo-pages')!.lines.map((line) => line.text).join(' ')).toMatch(/does not publish to WordPress/);
    expect(on.cards.find((card) => card.id === 'seven-loser-pauser')!.active).toBe(true);
    expect(on.cards.find((card) => card.id === 'seven-spend-pacing-monitor')!.active).toBe(false);
    expect(on.cards.find((card) => card.id === 'toolkit-google-ads')!.status).toBe('Installed');
    expect(on.cards.find((card) => card.id === 'toolkit-meta-ads')!.status).toBe('Not installed');
    expect(on.cards.filter((card) => card.group === 'schedule')).toHaveLength(SEVEN_SKILLS.length);
    expect(on.cards.filter((card) => card.group === 'toolkit')).toHaveLength(SKILL_CATALOG.length);
    expect(on.cards.find((card) => card.id === 'playbook-plumbing')!.active).toBe(true);
    expect(text(on).toLowerCase()).not.toContain('searchlight');
    expect(text(on)).not.toContain('\u2014');
  });
});

describe('skills board route and nav', () => {
  it('serves the board and the marketing nav points at it', async () => {
    const ui = readFileSync(join(process.cwd(), 'web', 'index.html'), 'utf8');
    const marketing = ui.slice(ui.indexOf('data-group="marketing"'), ui.indexOf('data-group="insights"'));
    expect(marketing).toContain('data-page="library"');
    expect(marketing).toContain('Skills &amp; Playbooks');
    expect(ui).toContain('id="page-library"');
    expect(ui).toContain('lib-grid');
    expect(ui).toContain('repeat(3,minmax(0,1fr))');
    expect(ui).toContain('repeat(2,minmax(0,1fr))');
    expect(ui).toContain("setPage('library')");
    const connector = {
      name: 'mock',
      async createConnectToken() { return { token: 't', expiresAt: '2099-01-01', connectUrl: 'https://connect.example' }; },
      async listAccounts() { return []; },
      async runAction() { return { ok: false, actionId: 'x', app: 'google_ads', output: null }; },
    } as unknown as Connector;
    const app = buildServer({ authStore: new MemoryStore(), connector });
    const signed = await app.inject({ method: 'POST', url: '/auth/signup', payload: { email: 'lib@example.com', password: 'password1', tos: true } });
    const headers = { cookie: String(signed.headers['set-cookie']).split(';')[0] };
    await app.inject({ method: 'PUT', url: '/api/profile', headers, payload: { industry: 'Painting', businessName: 'Painters In Philly', serviceAreas: 'Philadelphia, PA' } });
    const res = await app.inject({ method: 'GET', url: '/api/marketing/library', headers });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.cards.find((card: { id: string }) => card.id === 'playbook-painting').yours).toBe(true);
    expect(JSON.stringify(body).toLowerCase()).not.toContain('searchlight');
    expect(JSON.stringify(body)).not.toContain('\u2014');
    await app.close();
  });
});
