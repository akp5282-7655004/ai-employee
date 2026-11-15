import { describe, expect, it } from 'vitest';
import { buildCampaignSpec } from '../src/agents/campaign.js';
import { buildMetaCampaignSpec } from '../src/agents/metacampaign.js';
import { rulesForTrade } from '../src/automation/rules.js';
import { weeklyReport, type DailyInput } from '../src/automation/skills.js';
import { buildSkillsBoard } from '../src/dashboard/skillsboard.js';
import { applyAudienceRules, usesProtectedTrait } from '../src/playbooks/guard.js';
import { audiencesFor, tradePlaybook } from '../src/playbooks/load.js';

const TRADES = ['Roofing', 'HVAC', 'Plumbing', 'Electrical', 'Painting', 'Solar', 'Landscaping'] as const;

describe('trade playbooks from the Nov 15 documents', () => {
  it('loads each trade playbook and falls back to the master template', () => {
    for (const trade of TRADES) {
      const book = tradePlaybook(trade);
      expect(book.id).toBe(trade.toLowerCase());
      expect(book.version).toBe('2026-11-15');
      expect(book.sections.length).toBeGreaterThan(5);
      expect(book.operatingRules?.[0]).toMatch(/cost per booked job/);
    }
    const unknown = tradePlaybook('Dentist');
    expect(unknown.id).toBe('master');
    expect(unknown.label).toBe('Master template');
    expect(unknown.baseNegatives).toEqual(expect.arrayContaining(['jobs', 'DIY', 'free']));
  });

  it('builds a painter plan, audiences, and skill thresholds from the painting playbook', () => {
    const book = tradePlaybook('painter');
    expect(book.negatives.join(' ')).toMatch(/paint store/);
    expect(book.negatives.join(' ')).toMatch(/auto painting/);
    expect(book.keywords.join(' ')).toMatch(/house painters/);
    const rules = rulesForTrade('Painting');
    expect(rules.junkTerms.join(' ')).toMatch(/paint store/);
    expect(rules.wastedSpendUsd).toBe(50);
    const spec = buildCampaignSpec(
      { goal: 'more jobs', dailyBudget: 20, finalUrl: 'https://painters.example' },
      { business: 'Painters In Philly', trade: 'Painting', city: 'Philadelphia', services: 'exterior painting' },
    );
    expect(spec.negatives.join(' ')).toMatch(/paint store/);
    const audiences = audiencesFor('Painting');
    expect(audiences.segments.map((row) => row.name)).toContain('Exterior repaint');
    expect(audiences.defaults.always_exclude.join(' ')).toMatch(/employees/);
    const meta = buildMetaCampaignSpec({}, { business: 'Painters', industry: 'Painting', city: 'Philadelphia', services: 'exterior painting', serviceAreas: '19103' });
    expect(meta.ageMin).toBe(25);
    expect(meta.exclusions?.join(' ')).toMatch(/employees/);
    const board = buildSkillsBoard({ trade: 'Painting' });
    const card = board.cards.find((row) => row.id === 'playbook-painting')!;
    expect(card.lines.find((line) => line.label === 'Loaded playbook')!.text).toMatch(/Painting/);
    expect(card.lines.find((line) => line.label === 'Loaded playbook')!.text).toMatch(/2026-11-15/);
    expect(card.lines.find((line) => line.label === 'Audiences')!.text).toMatch(/Exterior repaint/);
  });

  it('shows roofing cost per booked job and plumbing cost per lead in the weekly report', () => {
    const base = (trade: string): DailyInput => ({
      now: '2026-11-15T12:00:00.000Z',
      trade,
      monthlyBudget: 600,
      spentMonth: 200,
      dayOfMonth: 10,
      leads: 2,
      bookedJobs: 1,
      channels: { google: true, meta: false, gbp: false, ghl: false },
      campaigns: [{ name: 'Search', platform: 'google_ads', spend: 200, conversions: 1, clicks: 10 }],
      searchTerms: [],
      conversionActions: 1,
      callTracking: false,
      metaSpend: null,
      gbpCalls: null,
      ghlLeads: null,
    });
    expect(weeklyReport(base('Roofing'), []).detail).toMatch(/\$2,000/);
    expect(weeklyReport(base('Plumbing'), []).detail).toMatch(/\$110/);
    expect(weeklyReport(base('Painting'), []).detail).toMatch(/does not set a numeric ROAS/);
    expect(weeklyReport(base('Painting'), []).detail).not.toMatch(/\u2014/);
  });

  it('blocks protected traits and keeps platform audience rules', () => {
    expect(usesProtectedTrait('target by race and religion')).toBe(true);
    const applied = applyAudienceRules('Painting', [
      { id: 'bad', name: 'By ethnicity', demand: 'planned', age: '30-65', zip_income: 'median >= $75K', homeowner: 'required', zip_filters: '', meta: 'exclude by religion', google: '', seed: '' },
      ...audiencesFor('Painting').segments,
    ]);
    expect(applied.blocked).toContain('By ethnicity');
    expect(applied.segments.some((row) => row.name === 'By ethnicity')).toBe(false);
    expect(applied.metaAgeControl).toBe(25);
    expect(applied.googleDemographics).toMatch(/Observe first/);
    expect(applied.lsaDemographics).toMatch(/No demographic/);
    expect(applied.neverUse.join(' ')).toMatch(/protected traits/);
  });
});
