import { describe, expect, it } from 'vitest';
import {
  applyRenewal, billingState, emptyBilling, linkCheckout, markCanceled, markPastDue, updateBand,
} from '../src/billing/subscription.js';
import { creditState } from '../src/billing/credits.js';

const invoice = (over: Partial<Parameters<typeof applyRenewal>[1]> = {}) => ({
  invoiceId: 'in_1', customerId: 'cus_1', subscriptionId: 'sub_1', bandKey: 'starter' as const,
  periodEnd: '2026-09-18T00:00:00Z', ...over,
});

describe('billingState', () => {
  it('reads back an empty account as no subscription', () => {
    expect(billingState({})).toMatchObject(emptyBilling());
  });
  it('drops a corrupt status and band rather than trusting them', () => {
    const b = billingState({ billing: { status: 'literally anything', band: 'enterprise-ultra' } });
    expect(b.status).toBe('none');
    expect(b.band).toBeUndefined();
  });
  it('caps the granted-invoices list so it cannot grow forever', () => {
    const many = Array.from({ length: 80 }, (_, i) => 'in_' + i);
    expect(billingState({ billing: { grantedInvoices: many } }).grantedInvoices).toHaveLength(50);
  });
});

describe('linkCheckout', () => {
  it('attaches the Stripe identities and marks the subscription active, without granting anything', () => {
    const data: Record<string, unknown> = {};
    linkCheckout(data, 'cus_1', 'sub_1');
    expect(billingState(data)).toMatchObject({ stripeCustomerId: 'cus_1', stripeSubscriptionId: 'sub_1', status: 'active' });
    expect(data.credits).toBeUndefined();
  });
});

describe('applyRenewal', () => {
  it('grants that band’s monthly credits on top of what was already granted', () => {
    const data: Record<string, unknown> = { credits: { granted: 100, launchOffer: true, ledger: [] } };
    const r = applyRenewal(data, invoice());
    expect(r.applied).toBe(true);
    expect(r.granted).toBe(50); // Starter's monthlyCredits
    expect(creditState(data).granted).toBe(150);
  });
  it('turns off the launch-offer flag once a real subscription pays', () => {
    const data: Record<string, unknown> = { credits: { granted: 100, launchOffer: true, ledger: [] } };
    applyRenewal(data, invoice());
    expect(creditState(data).launchOffer).toBe(false);
  });
  it('records the band and status and marks the subscription active', () => {
    const data: Record<string, unknown> = {};
    applyRenewal(data, invoice({ bandKey: 'growth' }));
    expect(billingState(data)).toMatchObject({ band: 'growth', status: 'active', stripeSubscriptionId: 'sub_1' });
  });
  it('never grants twice for the same invoice — Stripe can send a webhook more than once', () => {
    const data: Record<string, unknown> = { credits: { granted: 0, ledger: [] } };
    applyRenewal(data, invoice());
    const second = applyRenewal(data, invoice()); // same invoiceId
    expect(second.applied).toBe(false);
    expect(creditState(data).granted).toBe(50); // not 100
  });
  it('does grant again for a genuinely new invoice — the next month', () => {
    const data: Record<string, unknown> = { credits: { granted: 0, ledger: [] } };
    applyRenewal(data, invoice({ invoiceId: 'in_1' }));
    applyRenewal(data, invoice({ invoiceId: 'in_2', periodEnd: '2026-10-18T00:00:00Z' }));
    expect(creditState(data).granted).toBe(100);
  });
  it('refuses a band that does not exist rather than granting something arbitrary', () => {
    const data: Record<string, unknown> = { credits: { granted: 0, ledger: [] } };
    const r = applyRenewal(data, invoice({ bandKey: 'nonexistent' as any }));
    expect(r.applied).toBe(false);
    expect(creditState(data).granted).toBe(0);
  });
});

describe('markPastDue / markCanceled', () => {
  it('marks the known subscription past due without touching credits', () => {
    const data: Record<string, unknown> = {};
    applyRenewal(data, invoice());
    markPastDue(data, 'sub_1');
    expect(billingState(data).status).toBe('past_due');
  });
  it('ignores a status update for a subscription id that is not this account’s', () => {
    const data: Record<string, unknown> = {};
    applyRenewal(data, invoice());
    markPastDue(data, 'sub_someone_else');
    expect(billingState(data).status).toBe('active'); // unchanged
  });
  it('marks canceled', () => {
    const data: Record<string, unknown> = {};
    applyRenewal(data, invoice());
    markCanceled(data, 'sub_1');
    expect(billingState(data).status).toBe('canceled');
  });
});

describe('updateBand', () => {
  it('updates the band on file for this account’s subscription', () => {
    const data: Record<string, unknown> = {};
    applyRenewal(data, invoice({ bandKey: 'starter' }));
    updateBand(data, 'sub_1', 'scale');
    expect(billingState(data).band).toBe('scale');
  });
  it('ignores an update for a different subscription id', () => {
    const data: Record<string, unknown> = {};
    applyRenewal(data, invoice({ bandKey: 'starter' }));
    updateBand(data, 'sub_other', 'scale');
    expect(billingState(data).band).toBe('starter');
  });
  it('ignores an unknown band key', () => {
    const data: Record<string, unknown> = {};
    applyRenewal(data, invoice({ bandKey: 'starter' }));
    updateBand(data, 'sub_1', 'made-up' as any);
    expect(billingState(data).band).toBe('starter');
  });
});
