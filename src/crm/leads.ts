/** Lead list. A shared phone with a different name is not merged unless the owner confirms. */

export type LeadStatus = 'new' | 'booked' | 'lost';

export interface Lead {
  id: string;
  name: string;
  phone: string;
  status: LeadStatus;
  lostReason?: string;
  source?: string;
  optOut?: boolean;
  createdAt: string;
}

export function readLeads(data: Record<string, unknown>): Lead[] {
  const rows = Array.isArray(data.leads) ? data.leads as Lead[] : [];
  return rows.filter((row) => row && typeof row.name === 'string');
}

export function addLead(existing: Lead[], incoming: { name: string; phone: string; confirm?: boolean }, now: string): { ok: true; leads: Lead[]; merged: boolean } | { ok: false; needsConfirm?: boolean; error: string } {
  const name = incoming.name.trim();
  const phone = incoming.phone.trim();
  if (!name) return { ok: false, error: 'Enter a name.' };
  const samePhone = existing.find((row) => phone && row.phone === phone);
  if (samePhone && samePhone.name.toLowerCase() !== name.toLowerCase() && !incoming.confirm) {
    return { ok: false, needsConfirm: true, error: `That phone is already saved for ${samePhone.name}. Confirm if this is a different person.` };
  }
  if (samePhone && samePhone.name.toLowerCase() === name.toLowerCase()) return { ok: true, leads: existing, merged: true };
  const lead: Lead = { id: `lead_${Math.random().toString(16).slice(2, 10)}`, name, phone, status: 'new', createdAt: now };
  return { ok: true, leads: [lead, ...existing], merged: false };
}

export function setLeadStatus(leads: Lead[], id: string, status: LeadStatus, lostReason?: string): Lead[] | { error: string } {
  if (status !== 'new' && status !== 'booked' && status !== 'lost') return { error: 'Status must be new, booked, or lost.' };
  if (status === 'lost' && !(lostReason || '').trim()) return { error: 'Add a reason when a lead is lost.' };
  const hit = leads.find((row) => row.id === id);
  if (!hit) return { error: 'That lead was not found.' };
  return leads.map((row) => row.id === id ? { ...row, status, lostReason: status === 'lost' ? (lostReason || '').trim() : undefined } : row);
}

export function setLeadOptOut(leads: Lead[], id: string, optOut: boolean): Lead[] | { error: string } {
  const hit = leads.find((row) => row.id === id);
  if (!hit) return { error: 'That lead was not found.' };
  return leads.map((row) => row.id === id ? { ...row, optOut } : row);
}

export function leadCounts(leads: Lead[]): { leads: number; new: number; booked: number; lost: number } {
  return {
    leads: leads.length,
    new: leads.filter((row) => row.status === 'new').length,
    booked: leads.filter((row) => row.status === 'booked').length,
    lost: leads.filter((row) => row.status === 'lost').length,
  };
}
