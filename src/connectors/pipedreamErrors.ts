/**
 * Pipedream action errors. Listing connected accounts is a management call.
 * Running a component (`actions.run`) is a tool call. Production tool calls
 * are a workspace entitlement, separate from a healthy OAuth connection.
 *
 * Sources checked 2026-11-07:
 * - https://pipedream.com/docs/pricing (action executions and tool calls use credits; listing accounts does not)
 * - https://pipedream.com/pricing?plan=Connect (Free is development-only; Startup and Business include “Run in production”)
 * - https://pipedream.com/docs/connect/managed-auth/environments (development and production accounts are separate; production access is enabled on the pricing page)
 */

export type PipedreamFailureKind =
  | 'connect_production_unavailable'
  | 'provider'
  | 'unknown';

export interface PipedreamFailure {
  kind: PipedreamFailureKind;
  /** Full provider sentence, secrets removed, not cut mid-word. */
  providerMessage: string;
  /** What to show a contractor. */
  message: string;
}

const SECRET = /bearer\s+[a-z0-9._\-]+|sk_live_[a-z0-9]+|client_secret["']?\s*[:=]\s*["'][^"']+/gi;

export function sanitizeProviderText(raw: string): string {
  return raw.replace(SECRET, '[redacted]').replace(/\s+/g, ' ').trim().slice(0, 800);
}

export function explainPipedreamError(err: unknown): PipedreamFailure {
  const raw = err instanceof Error ? err.message : String(err ?? '');
  const body = (err as { body?: unknown; error?: unknown })?.body ?? (err as { error?: unknown })?.error;
  const extra = body ? ` ${typeof body === 'string' ? body : JSON.stringify(body)}` : '';
  const providerMessage = sanitizeProviderText(`${raw}${extra}`.trim()) || 'Pipedream returned an error with no message.';
  if (/tool calling via pipedream connect in production is not available/i.test(providerMessage)) {
    return {
      kind: 'connect_production_unavailable',
      providerMessage,
      message:
        'Google sign-in is healthy, but Pipedream refused to run tools in the production environment. Listing the connection does not use a tool call; resolving the Google Ads customer id does (google_ads-list-account-id-options via actions.run), and so does creating a campaign. This is a Pipedream production entitlement, not a bad Google login and not a reason to use another user’s account. On the current pricing page, Free is development-only and Startup or Business includes production (https://pipedream.com/pricing?plan=Connect). Enable production access for this workspace and keep Miles on production. Do not point Miles at the development environment — those accounts are different and must not be reused.',
    };
  }
  return { kind: providerMessage ? 'provider' : 'unknown', providerMessage, message: providerMessage };
}
