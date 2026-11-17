/** Dashboard rates. A zero denominator is null, never infinity. */

export function safeDivide(numerator: number, denominator: number): number | null {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return null;
  return Math.round((numerator / denominator) * 100) / 100;
}

export interface DashboardRates {
  cpc: number | null;
  costPerLead: number | null;
  costPerBookedJob: number | null;
  roas: number | null;
  roiPct: number | null;
  clickToLead: number | null;
  leadToBooked: number | null;
}

export function dashboardRates(input: { spend: number; clicks: number; leads: number; booked: number; revenue: number }): DashboardRates {
  const spend = input.spend || 0;
  const revenue = input.revenue || 0;
  return {
    cpc: safeDivide(spend, input.clicks || 0),
    costPerLead: safeDivide(spend, input.leads || 0),
    costPerBookedJob: safeDivide(spend, input.booked || 0),
    roas: safeDivide(revenue, spend),
    roiPct: spend === 0 ? null : Math.round(((revenue - spend) / spend) * 100),
    clickToLead: safeDivide(input.leads || 0, input.clicks || 0),
    leadToBooked: safeDivide(input.booked || 0, input.leads || 0),
  };
}
