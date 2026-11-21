import { describe, expect, it } from 'vitest';
import { feasibility, searchlightGoogleCpl } from '../src/agents/feasibility.js';

describe('feasibility against Searchlight', () => {
  it('uses the LocaliQ painting cost per lead and does not invent one for solar', () => {
    expect(searchlightGoogleCpl('painting')).toBeNull();
    const f = feasibility({ dailyBudget: 20, leadsPerDay: 2, trade: 'painting', now: new Date('2026-04-15T12:00:00Z') });
    expect(f.benchmarkCpl).toBe(138.38);
    expect(f.requiredCpl).toBe(10);
    expect(f.realistic).toBe('unlikely');
    expect(f.message).toMatch(/LocaliQ 2025/);
    expect(f.message).toMatch(/Not enough Miles data yet/);
    expect(f.playbook.title).toBe('Running the painting playbook');
    expect(f.playbook.season).toMatch(/exterior/i);
    expect(f.playbook.splitNote).toMatch(/cannot create Local Services Ads/);
    const solar = feasibility({ dailyBudget: 20, leadsPerDay: 2, trade: 'solar' });
    expect(solar.benchmarkCpl).toBeNull();
    expect(solar.message).toMatch(/will not invent/);
  });

  it('calls an unrealistic plumbing target out against the Searchlight row', () => {
    const row = searchlightGoogleCpl('plumbing');
    expect(row?.value).toBe(183);
    const f = feasibility({ dailyBudget: 20, leadsPerDay: 2, trade: 'plumbing' });
    expect(f.realistic).toBe('unlikely');
    expect(f.benchmarkCpl).toBe(183);
    expect(f.message).toMatch(/not a reasonable expectation/);
  });
});
