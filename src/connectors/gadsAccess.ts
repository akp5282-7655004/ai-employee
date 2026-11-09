/**
 * What a Google login can actually advertise in.
 * OAuth success is not a customer id. An empty tool result is not "still loading".
 */

export interface CustomerNode {
  id: string;
  manager?: boolean;
  name?: string;
}

export interface AdCustomer {
  id: string;
  login: string;
  name?: string;
  label: string;
}

export interface GadsAccess {
  kind: 'none' | 'manager_only' | 'ready' | 'choose' | 'error';
  reason: string;
  /** Manager or direct login. This is login-customer-id, not always the ad account. */
  loginCustomerId?: string;
  customers: AdCustomer[];
  selectedId?: string;
}

const fmt = (id: string) => (/^\d{10}$/.test(id) ? `${id.slice(0, 3)}-${id.slice(3, 6)}-${id.slice(6)}` : id);

function labelOf(node: CustomerNode, login: string): string {
  const id = fmt(node.id);
  const who = node.name ? `${node.name} (${id})` : id;
  return node.id === login ? who : `${who}. Login customer ${fmt(login)}`;
}

export function classifyGadsAccounts(args: {
  logins: CustomerNode[];
  clientsByLogin: Record<string, CustomerNode[]>;
  missingAction?: string;
  error?: string;
  selectedId?: string;
}): GadsAccess {
  if (args.error) {
    return { kind: 'error', reason: args.error, customers: [] };
  }
  const logins = args.logins.filter((n) => /^\d{10}$/.test(n.id));
  if (args.missingAction && !logins.length) {
    return { kind: 'error', reason: `${args.missingAction} is not available on this Google Ads connection, so no customer id could be listed.`, customers: [] };
  }
  if (!logins.length) {
    return {
      kind: 'none',
      reason: 'This Google login returned no accessible Google Ads customer ids. google_ads-list-account-id-options and google_ads-list-customer-clients were both empty. There is no ad account to use.',
      customers: [],
    };
  }
  const customers: AdCustomer[] = [];
  const managerLogins: string[] = [];
  for (const login of logins) {
    const clients = (args.clientsByLogin[login.id] ?? []).filter((c) => /^\d{10}$/.test(c.id));
    const children = clients.filter((c) => c.id !== login.id && !c.manager);
    if (children.length) {
      for (const child of children) customers.push({ id: child.id, login: login.id, name: child.name, label: labelOf(child, login.id) });
      continue;
    }
    if (login.manager || clients.some((c) => c.id === login.id && c.manager)) {
      managerLogins.push(login.id);
      continue;
    }
    customers.push({ id: login.id, login: login.id, name: login.name, label: labelOf(login, login.id) });
  }
  const unique = new Map<string, AdCustomer>();
  for (const c of customers) if (!unique.has(c.id)) unique.set(c.id, c);
  const list = [...unique.values()];
  if (!list.length && managerLogins.length) {
    return {
      kind: 'manager_only',
      reason: `This Google login is a manager account (MCC). Miles would send it as login-customer-id ${fmt(managerLogins[0]!)}. No client customer id was returned, so there is no ad account to read or create in.`,
      loginCustomerId: managerLogins[0],
      customers: [],
    };
  }
  if (!list.length) {
    return { kind: 'none', reason: 'This Google login has no accessible ad accounts.', customers: [], loginCustomerId: logins[0]?.id };
  }
  const selected = args.selectedId && list.some((c) => c.id === args.selectedId) ? args.selectedId : undefined;
  if (list.length > 1 && !selected) {
    return {
      kind: 'choose',
      reason: 'This Google login can access more than one ad account. Pick the customer id Miles should use. Nothing is selected yet.',
      loginCustomerId: list[0]?.login,
      customers: list,
    };
  }
  const chosen = list.find((c) => c.id === selected) ?? list[0]!;
  return {
    kind: 'ready',
    reason: 'A Google Ads customer id is selected.',
    loginCustomerId: chosen.login,
    customers: list,
    selectedId: chosen.id,
  };
}

/** Pull customer id, name, and manager flag out of a Pipedream action result. */
export function extractCustomerNodes(v: unknown, into: CustomerNode[] = [], depth = 0): CustomerNode[] {
  if (v == null || depth > 6) return into;
  if (typeof v === 'string' || typeof v === 'number') {
    const id = idOf(String(v));
    if (id) into.push({ id });
    return into;
  }
  if (Array.isArray(v)) {
    for (const x of v) extractCustomerNodes(x, into, depth + 1);
    return into;
  }
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    let id: string | undefined;
    let name: string | undefined;
    let manager: boolean | undefined;
    for (const [k, val] of Object.entries(o)) {
      if (typeof val === 'boolean' && /manager/i.test(k)) manager = val;
      if (typeof val === 'string' || typeof val === 'number') {
        const s = String(val);
        const found = idOf(s);
        if (found && /id|customer|value/i.test(k)) id ??= found;
        if (typeof val === 'string' && /name/i.test(k) && !/resource/i.test(k) && val.trim() && !/^[\d\s-]+$/.test(val)) name ??= val.trim();
      }
    }
    if (id) into.push({ id, name, manager });
    for (const val of Object.values(o)) extractCustomerNodes(val, into, depth + 1);
  }
  return into;
}

function idOf(s: string): string | undefined {
  const resource = s.match(/customers\/(\d{10})/);
  if (resource?.[1]) return resource[1];
  const digits = s.replace(/[^\d]/g, '');
  return /^\d{10}$/.test(digits) ? digits : undefined;
}
