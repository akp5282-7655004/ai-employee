import { describe, it, expect } from 'vitest';
import { buildRecommendations, type RecInput } from '../src/agents/recommend.js';

const DAY = new Date('2026-08-13T12:00:00Z');

function base(): RecInput {
  return { spend: [], deals: [], leads: [], reviews: [], emails: [], social: null, scheduledPosts: 3, targetCpa: 50, speedToLeadOn: true };
}

describe('buildRecommendations', () => {
  it('flags a platform that spent money with zero conversions', () => {
    const input = { ...base(), spend: [{ platform: 'facebook', campaign: 'AC', utm: '', spend: 620, clicks: 100, conversions: 0 }] };
    const recs = buildRecommendations(input, DAY);
    const r = recs.find((x) => x.category === 'ads');
    expect(r).toBeTruthy();
    expect(r!.title.toLowerCase()).toContain('facebook');
    expect(r!.severity).toBe('high');
    expect(r!.apply.kind).toBe('queue_change');
  });

  it('flags cost-per-lead over target', () => {
    const input = { ...base(), targetCpa: 30, spend: [{ platform: 'google_ads', campaign: 'x', utm: '', spend: 900, clicks: 200, conversions: 10 }] };
    const recs = buildRecommendations(input, DAY);
    const r = recs.find((x) => x.id.includes('cpa-high'));
    expect(r).toBeTruthy();
    expect(r!.title).toContain('over target');
  });

  it('recommends scaling a channel that beats target', () => {
    const input = { ...base(), targetCpa: 100, spend: [{ platform: 'google_ads', campaign: 'x', utm: '', spend: 400, clicks: 200, conversions: 20 }] };
    const recs = buildRecommendations(input, DAY);
    expect(recs.find((x) => x.id.includes('scale'))).toBeTruthy();
  });

  it('recommends turning on Speed-to-Lead when leads are uncontacted and it is off', () => {
    const input = { ...base(), speedToLeadOn: false, leads: [{ name: 'Sara', service: 'repaint', source: 'Google', contacted: false }] };
    const recs = buildRecommendations(input, DAY);
    const r = recs.find((x) => x.apply.kind === 'enable_speed_to_lead');
    expect(r).toBeTruthy();
    expect(r!.category).toBe('speed');
  });

  it('surfaces an unread hot email and a low review', () => {
    const input = {
      ...base(),
      emails: [{ from: 'Sarah', subject: 'Kitchen repaint quote?', snippet: 'can you quote this week?', unread: true }],
      reviews: [{ author: 'Dave', rating: 2, text: 'late', platform: 'Google' }],
    };
    const recs = buildRecommendations(input, DAY);
    expect(recs.find((x) => x.category === 'email')).toBeTruthy();
    expect(recs.find((x) => x.category === 'reputation')).toBeTruthy();
  });

  it('suggests scheduling posts when none are queued, and sorts high severity first', () => {
    const input = { ...base(), scheduledPosts: 0, spend: [{ platform: 'facebook', campaign: 'x', utm: '', spend: 300, clicks: 10, conversions: 0 }] };
    const recs = buildRecommendations(input, DAY);
    expect(recs.find((x) => x.category === 'content')).toBeTruthy();
    expect(recs[0]?.severity).toBe('high'); // dead-spend ad rec outranks the content one
  });

  it('produces stable ids for the same day and no recommendations when all is healthy', () => {
    const a = buildRecommendations(base(), DAY);
    const b = buildRecommendations(base(), DAY);
    expect(a).toEqual(b);
    expect(a.length).toBe(0);
  });
});
