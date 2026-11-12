/**
 * Read-only tools the chat model may call. Writes are refused here.
 * Each reader is already bound to the signed-in tenant by the server.
 */
export interface ChatReaders {
  campaignStatus: () => Promise<unknown>;
  integrations: () => Promise<unknown>;
  leads: () => Promise<unknown>;
  changeLog: () => Promise<unknown>;
  /** Live Google Ads spend for the signed-in account. Optional so older callers still typecheck. */
  liveSpend?: () => Promise<import('./prompt.js').LiveSpendRead | null>;
}

export interface ChatToolSpec {
  name: string;
  description: string;
  parameters: { type: 'object'; properties: Record<string, never>; additionalProperties: false };
}

const NO_ARGS = { type: 'object' as const, properties: {}, additionalProperties: false as const };

export const CHAT_TOOLS: ChatToolSpec[] = [
  {
    name: 'campaign_status',
    description: 'Read this account\'s campaigns on file and a live Google Ads status read-back. Does not change anything. Ignores any other account id.',
    parameters: NO_ARGS,
  },
  {
    name: 'integrations',
    description: 'Read which integrations are connected for this account: Google Ads customer id, GoHighLevel, speed-to-lead, Meta, and social. Does not connect or disconnect anything.',
    parameters: NO_ARGS,
  },
  {
    name: 'leads',
    description: 'Read recent leads for this account. SAMPLE rows are examples, not a live CRM.',
    parameters: NO_ARGS,
  },
  {
    name: 'change_log',
    description: 'Read recent Miles events and the approval change log for this account.',
    parameters: NO_ARGS,
  },
];

const READERS: Record<string, keyof ChatReaders> = {
  campaign_status: 'campaignStatus',
  integrations: 'integrations',
  leads: 'leads',
  change_log: 'changeLog',
};

export async function runChatTool(name: string, readers: ChatReaders): Promise<string> {
  const key = READERS[name];
  if (!key) {
    return JSON.stringify({
      ok: false,
      error: 'Chat is read-only. That action is not available here. Approvals stay on the existing pages.',
    });
  }
  try {
    const read = readers[key];
    if (!read) {
      return JSON.stringify({ ok: false, error: 'That read is not available.' });
    }
    const value = await read();
    const text = JSON.stringify(value);
    return text.length > 6000 ? `${text.slice(0, 6000)}…` : text;
  } catch {
    return JSON.stringify({ ok: false, error: 'That read failed. The account snapshot above is still the current picture.' });
  }
}
