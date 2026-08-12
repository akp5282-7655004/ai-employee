/**
 * Delivery — get an agent's output off the screen and into the owner's hands.
 * Email via Resend (RESEND_API_KEY) and SMS via Twilio (TWILIO_ACCOUNT_SID +
 * TWILIO_AUTH_TOKEN + TWILIO_FROM). Both are plain HTTPS calls (no SDK), and both
 * degrade honestly: with no key configured, `deliveryStatus()` reports the channel
 * as off and send() returns a clear note instead of pretending it sent. The whole
 * delivery engine ships now; it activates the moment the keys are added in Render.
 */

export interface DeliveryStatus {
  email: boolean;
  sms: boolean;
}

/** Which channels are live right now, based on configured provider keys. */
export function deliveryStatus(): DeliveryStatus {
  return {
    email: !!process.env.RESEND_API_KEY,
    sms: !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM),
  };
}

export interface SendResult {
  ok: boolean;
  channel: 'email' | 'sms';
  note: string;
}

/** Send an email via Resend. Returns a clear note (never throws). */
export async function sendEmail(to: string, subject: string, text: string): Promise<SendResult> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { ok: false, channel: 'email', note: 'Email delivery is off — add RESEND_API_KEY in Render to activate.' };
  if (!to) return { ok: false, channel: 'email', note: 'No destination email on file.' };
  const from = process.env.RESEND_FROM || 'Miles <onboarding@resend.dev>';
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from, to, subject, text }),
    });
    if (!res.ok) return { ok: false, channel: 'email', note: `Email provider returned ${res.status}.` };
    return { ok: true, channel: 'email', note: `Emailed to ${to}.` };
  } catch (err) {
    return { ok: false, channel: 'email', note: `Email failed: ${(err as Error).message}` };
  }
}

/** Send an SMS via Twilio. Returns a clear note (never throws). */
export async function sendSms(to: string, body: string): Promise<SendResult> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM;
  if (!sid || !token || !from) return { ok: false, channel: 'sms', note: 'SMS delivery is off — add TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN & TWILIO_FROM in Render to activate.' };
  const digits = (to || '').replace(/[^\d+]/g, '');
  if (!digits) return { ok: false, channel: 'sms', note: 'No valid phone number on file (add one in Business Profile).' };
  try {
    const auth = Buffer.from(`${sid}:${token}`).toString('base64');
    const form = new URLSearchParams({ To: digits, From: from, Body: body.slice(0, 1500) });
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: { authorization: `Basic ${auth}`, 'content-type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
    if (!res.ok) return { ok: false, channel: 'sms', note: `SMS provider returned ${res.status}.` };
    return { ok: true, channel: 'sms', note: `Texted ${digits}.` };
  } catch (err) {
    return { ok: false, channel: 'sms', note: `SMS failed: ${(err as Error).message}` };
  }
}

/** A short SMS-friendly version of an agent's report (first lines, capped). */
export function smsExcerpt(title: string, body: string): string {
  const firstLines = body.split('\n').filter((l) => l.trim()).slice(0, 4).join('\n');
  return `${title}\n\n${firstLines}\n\n— Miles (full report in your dashboard)`.slice(0, 1500);
}
