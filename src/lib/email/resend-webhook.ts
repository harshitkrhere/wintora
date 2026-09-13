/**
 * Verifying a Resend webhook.
 *
 * Resend signs webhooks the Svix way: three headers (svix-id, svix-timestamp,
 * svix-signature), a secret of the form "whsec_<base64>", and a signature
 * that is HMAC-SHA256 over "<id>.<timestamp>.<raw body>", base64. The
 * signature header may carry several space-separated "v1,<sig>" values
 * during a secret rotation; any one matching is enough. A timestamp more than
 * five minutes from now is rejected so a captured request cannot be replayed
 * later.
 *
 * Kept apart from the route so the arithmetic can be tested against a
 * constructed request with a real signature.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

const TOLERANCE_SECONDS = 5 * 60;

export interface WebhookHeaders {
  readonly id: string | null;
  readonly timestamp: string | null;
  readonly signature: string | null;
}

export type VerifyResult =
  | { ok: true }
  | { ok: false; reason: 'MISSING_HEADERS' | 'BAD_SECRET' | 'STALE_TIMESTAMP' | 'BAD_SIGNATURE' };

export function signResendPayload(secret: string, id: string, timestamp: string, body: string): string {
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  return createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest('base64');
}

export function verifyResendSignature(
  input: { secret: string; headers: WebhookHeaders; body: string; now?: Date },
): VerifyResult {
  const { id, timestamp, signature } = input.headers;
  if (id === null || timestamp === null || signature === null) return { ok: false, reason: 'MISSING_HEADERS' };
  if (!input.secret.startsWith('whsec_') || input.secret.length < 12) return { ok: false, reason: 'BAD_SECRET' };

  const ts = Number(timestamp);
  const nowSeconds = Math.floor((input.now ?? new Date()).getTime() / 1000);
  if (!Number.isFinite(ts) || Math.abs(nowSeconds - ts) > TOLERANCE_SECONDS) {
    return { ok: false, reason: 'STALE_TIMESTAMP' };
  }

  const expected = Buffer.from(signResendPayload(input.secret, id, timestamp, input.body));
  for (const part of signature.split(' ')) {
    const [version, value] = part.split(',');
    if (version !== 'v1' || value === undefined) continue;
    const presented = Buffer.from(value);
    if (presented.length === expected.length && timingSafeEqual(presented, expected)) return { ok: true };
  }
  return { ok: false, reason: 'BAD_SIGNATURE' };
}

/** The parts of a Resend event the log uses. Anything else is ignored. */
export interface ResendEvent {
  readonly type: string;
  readonly createdAt: string;
  readonly emailId: string | null;
}

export function parseResendEvent(body: string): ResendEvent | null {
  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as { type?: unknown; created_at?: unknown; data?: { email_id?: unknown } };
  if (typeof r.type !== 'string') return null;
  return {
    type: r.type,
    createdAt: typeof r.created_at === 'string' ? r.created_at : new Date().toISOString(),
    emailId: typeof r.data?.email_id === 'string' ? r.data.email_id : null,
  };
}
