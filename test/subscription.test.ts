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

describe('a renewal preserves the rest of the credit state', () => {
  /**
   * A renewal adds the month's bundle to `granted` and ends the launch offer.
   * It must touch nothing else. Rebuilding data.credits by hand here used to
   * reset `spent` to the ledger sum — which, because the ledger is capped,
   * let a long-running account spend past its balance forever — and switched
   * the customer's auto top-up back off every month.
   */
  const active = (): Record<string, unknown> => ({
    billing: { status: 'active', stripeCustomerId: 'cus_1', stripeSubscriptionId: 'sub_1', grantedInvoices: [], band: 'starter' },
    credits: {
      granted: 150, spent: 87.5, ledger: [{ ts: 'x', item: 'video', cost: 1.5 }],
      launchOffer: false, autoTopUp: true, topUps: 2,
      period: creditState({}).period, toppedUpThisMonth: 50, usedThisMonth: { video: 12 },
    },
  });

  it('adds the band bundle and leaves spend, top-ups and fair-use counters alone', () => {
    const data = active();
    const r = applyRenewal(data, invoice({ invoiceId: 'in_renew' }));
    expect(r.applied).toBe(true);

    const s = creditState(data);
    expect(s.granted).toBe(200);       // 150 + Starter's 50
    expect(s.spent).toBe(87.5);        // was being reset to the ledger sum (1.50)
    expect(s.remaining).toBe(112.5);   // and so the balance was overstated
    expect(s.autoTopUp).toBe(true);    // was being switched off every renewal
    expect(s.topUps).toBe(2);
    expect(s.toppedUpThisMonth).toBe(50);
    expect(s.usedThisMonth).toEqual({ video: 12 });
  });

  it('still ends the launch offer', () => {
    const data = active();
    (data.credits as Record<string, unknown>).launchOffer = true;
    applyRenewal(data, invoice({ invoiceId: 'in_offer' }));
    expect(creditState(data).launchOffer).toBe(false);
  });
});
