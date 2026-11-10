/** One reading of "is GoHighLevel connected" for every screen. */

export const GHL_SLUGS = ['gohighlevel', 'highlevel_oauth', 'highlevel', 'leadconnector', 'gohighlevel_lead_connector'] as const;

export function normalizeAppSlug(app: string): string {
  return app.trim().toLowerCase().replace(/\s+/g, '_');
}

export function ghlSlugOf(apps: Iterable<string>): string | undefined {
  const have = new Set([...apps].map(normalizeAppSlug));
  return GHL_SLUGS.find((slug) => have.has(slug));
}

/** Ids this Miles login may already have used as a Pipedream external user. */
export function externalIdCandidates(user: { id: string; email?: string }, saved: string[] = []): string[] {
  const email = (user.email ?? '').trim().toLowerCase();
  return [...new Set([user.id, email, ...saved.map((s) => s.trim())].filter(Boolean))];
}

export interface ProjectAccount {
  app: string;
  externalId?: string;
  healthy?: boolean;
  dead?: boolean;
}

/**
 * A GoHighLevel account that is not on this login's id can be used only when
 * it is the single healthy one in the project and its external id is not
 * another Miles user. Two logins never share one connection.
 */
export function claimableGhlAccount(args: {
  selfId: string;
  otherUserIds: string[];
  accounts: ProjectAccount[];
}): { externalId: string; slug: string } | undefined {
  const rows = args.accounts
    .map((a) => ({ slug: ghlSlugOf([a.app]), externalId: (a.externalId ?? '').trim(), healthy: a.healthy, dead: a.dead }))
    .filter((a) => a.slug && a.externalId && a.healthy !== false && a.dead !== true);
  const ids = [...new Set(rows.map((r) => r.externalId))];
  if (ids.length !== 1) return undefined;
  const externalId = ids[0]!;
  if (externalId !== args.selfId && args.otherUserIds.includes(externalId)) return undefined;
  // More than one real login, and this account is not already this login's:
  // do not guess which customer owns it.
  if (externalId !== args.selfId && args.otherUserIds.length > 0) return undefined;
  return { externalId, slug: rows.find((r) => r.externalId === externalId)!.slug! };
}
