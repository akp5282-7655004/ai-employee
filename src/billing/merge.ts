/**
 * Fold two credit blobs that were edited from the same read.
 * A debit and a grant that both started from the stored balance both survive.
 * A second debit that would push the balance below zero is dropped.
 * A grant whose invoice or payment id is already stored is not added again.
 */

import { creditState, type CreditState } from './credits.js';
import { billingState, type BillingState } from './subscription.js';

const round = (n: number) => Math.round(n * 100) / 100;

export interface CreditBlob extends Partial<CreditState> {
  baseGranted?: number;
  baseSpent?: number;
  rev?: number;
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

export function mergeCredits(
  storedRaw: unknown,
  incomingRaw: unknown,
  storedBillingRaw: unknown,
  incomingBillingRaw: unknown,
): { credits: CreditBlob; billing: BillingState & { grantAmounts?: Record<string, number>; grantKeys?: string[]; baseInvoices?: string[] } } {
  const incoming = (incomingRaw ?? {}) as CreditBlob;
  const storedState = creditState({ credits: storedRaw ?? {} });
  const incomingState = creditState({ credits: incomingRaw ?? {} });
  const storedBilling = billingState({ billing: storedBillingRaw ?? {} }) as BillingState & { grantAmounts?: Record<string, number>; grantKeys?: string[] };
  const incomingBilling = (incomingBillingRaw ?? {}) as BillingState & { grantAmounts?: Record<string, number>; grantKeys?: string[]; baseInvoices?: string[] };
  const storedAmounts = storedBilling.grantAmounts ?? {};
  const incomingAmounts = incomingBilling.grantAmounts ?? {};
  const baseInvoices = new Set(incomingBilling.baseInvoices ?? []);

  const hasBase = typeof incoming.baseGranted === 'number' || typeof incoming.baseSpent === 'number';
  let granted = incomingState.granted;
  let spent = incomingState.spent;
  const alreadyApplied = hasBase && storedState.granted === incomingState.granted && storedState.spent === incomingState.spent;
  if (hasBase && !alreadyApplied) {
    const baseGranted = num(incoming.baseGranted, incomingState.granted);
    const baseSpent = num(incoming.baseSpent, incomingState.spent);
    let dGranted = round(incomingState.granted - baseGranted);
    const dSpent = round(incomingState.spent - baseSpent);
    for (const [id, amt] of Object.entries(incomingAmounts)) {
      if (!baseInvoices.has(id) && storedAmounts[id] != null) dGranted = round(dGranted - Number(amt || 0));
    }
    granted = round(storedState.granted + dGranted);
    const nextSpent = round(storedState.spent + dSpent);
    const storedRemaining = round(storedState.granted - storedState.spent);
    if (dSpent > 0 && storedRemaining <= 0) spent = storedState.spent;
    else if (granted - nextSpent < -0.001 && storedRemaining <= 0) spent = storedState.spent;
    else spent = nextSpent;
    if (granted < 0) granted = storedState.granted;
  }

  const grantKeys = [...new Set([...(storedBilling.grantKeys ?? storedBilling.grantedInvoices ?? []), ...(incomingBilling.grantKeys ?? incomingBilling.grantedInvoices ?? [])])].slice(-5000);
  const grantAmounts = { ...storedAmounts, ...incomingAmounts };
  const billing = {
    ...storedBilling,
    ...incomingBilling,
    grantedInvoices: grantKeys.slice(-50),
    grantKeys,
    grantAmounts,
    status: incomingBilling.status ?? storedBilling.status,
    band: incomingBilling.band ?? storedBilling.band,
  };
  delete (billing as { baseInvoices?: string[] }).baseInvoices;

  const credits: CreditBlob = {
    granted,
    spent,
    ledger: incoming.ledger ?? storedState.ledger,
    launchOffer: incoming.launchOffer ?? storedState.launchOffer,
    autoTopUp: incoming.autoTopUp ?? storedState.autoTopUp,
    topUps: incoming.topUps ?? storedState.topUps,
    period: incoming.period ?? storedState.period,
    toppedUpThisMonth: incoming.toppedUpThisMonth ?? storedState.toppedUpThisMonth,
    usedThisMonth: incoming.usedThisMonth ?? storedState.usedThisMonth,
    pendingTopUp: incoming.pendingTopUp !== undefined ? incoming.pendingTopUp : (storedRaw as CreditBlob | undefined)?.pendingTopUp,
    rev: Math.max(num(incoming.rev, 0), num((storedRaw as CreditBlob | undefined)?.rev, 0)) + 1,
  };
  return { credits, billing };
}

/** Drop the base markers so the next read treats the saved numbers as the new base. */
export function stripCreditBase(data: Record<string, unknown>): void {
  const credits = data.credits as CreditBlob | undefined;
  if (credits) {
    delete credits.baseGranted;
    delete credits.baseSpent;
  }
  const billing = data.billing as { baseInvoices?: string[] } | undefined;
  if (billing) delete billing.baseInvoices;
}
