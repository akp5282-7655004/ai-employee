import { describe, expect, it } from 'vitest';
import { feasibility, searchlightGoogleCpl } from '../src/agents/feasibility.js';

describe('feasibility against Searchlight', () => {
  it('does not invent a painting Google Ads cost per lead', () => {
    expect(searchlightGoogleCpl('painting')).toBeNull();
    const f = feasibility({ dailyBudget: 20, leadsPerDay: 2, trade: 'painting', now: new Date('2026-04-15T12:00:00Z') });
    expect(f.realistic).toBe('unknown');
    expect(f.requiredCpl).toBe(10);
    expect(f.message).toMatch(/will not invent/);
    expect(f.playbook.title).toBe('Running the painting playbook');
    expect(f.playbook.season).toMatch(/exterior/i);
    expect(f.playbook.splitNote).toMatch(/cannot create Local Services Ads/);
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
