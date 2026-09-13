/**
 * Resend webhook verification and the delivery-event vocabulary.
 *
 * Constructed requests with real HMAC signatures: forgery, replay, tampering
 * and rotation all have a case here.
 */

import { describe, expect, it } from 'vitest';
import { parseResendEvent, signResendPayload, verifyResendSignature } from '@/lib/email/resend-webhook';

const SECRET = `whsec_${Buffer.from('a-test-secret-of-reasonable-length').toString('base64')}`;
const NOW = new Date('2026-09-13T12:00:00Z');
const ts = String(Math.floor(NOW.getTime() / 1000));
const body = JSON.stringify({ type: 'email.delivered', created_at: '2026-09-13T11:59:58.000Z', data: { email_id: 'msg_123' } });

function headers(sig: string, id = 'msg_abc', timestamp = ts) {
  return { id, timestamp, signature: sig };
}

describe('verifyResendSignature', () => {
  it('accepts a correctly signed request', () => {
    const sig = `v1,${signResendPayload(SECRET, 'msg_abc', ts, body)}`;
    expect(verifyResendSignature({ secret: SECRET, body, headers: headers(sig), now: NOW })).toEqual({ ok: true });
  });

  it('accepts when any one of several signatures matches (secret rotation)', () => {
    const good = signResendPayload(SECRET, 'msg_abc', ts, body);
    const sig = `v1,${Buffer.from('nope').toString('base64')} v1,${good}`;
    expect(verifyResendSignature({ secret: SECRET, body, headers: headers(sig), now: NOW }).ok).toBe(true);
  });

  it('rejects a tampered body', () => {
    const sig = `v1,${signResendPayload(SECRET, 'msg_abc', ts, body)}`;
    const tampered = body.replace('email.delivered', 'email.bounced');
    expect(verifyResendSignature({ secret: SECRET, body: tampered, headers: headers(sig), now: NOW })).toEqual({
      ok: false,
      reason: 'BAD_SIGNATURE',
    });
  });

  it('rejects the wrong secret, a missing header, and a stale timestamp', () => {
    const sig = `v1,${signResendPayload(SECRET, 'msg_abc', ts, body)}`;
    const other = `whsec_${Buffer.from('another-secret-entirely-here').toString('base64')}`;
    expect(verifyResendSignature({ secret: other, body, headers: headers(sig), now: NOW }).ok).toBe(false);
    expect(verifyResendSignature({ secret: SECRET, body, headers: { id: null, timestamp: ts, signature: sig }, now: NOW })).toEqual({
      ok: false,
      reason: 'MISSING_HEADERS',
    });
    const old = String(Math.floor(NOW.getTime() / 1000) - 10 * 60);
    const oldSig = `v1,${signResendPayload(SECRET, 'msg_abc', old, body)}`;
    expect(verifyResendSignature({ secret: SECRET, body, headers: headers(oldSig, 'msg_abc', old), now: NOW })).toEqual({
      ok: false,
      reason: 'STALE_TIMESTAMP',
    });
  });

  it('refuses a secret that is not a Svix secret', () => {
    expect(verifyResendSignature({ secret: 'not-a-secret', body, headers: headers('v1,x'), now: NOW })).toEqual({
      ok: false,
      reason: 'BAD_SECRET',
    });
  });
});

describe('parseResendEvent', () => {
  it('reads the type, the time and the message id', () => {
    expect(parseResendEvent(body)).toEqual({ type: 'email.delivered', createdAt: '2026-09-13T11:59:58.000Z', emailId: 'msg_123' });
  });

  it('returns null for anything that is not an event', () => {
    expect(parseResendEvent('not json')).toBeNull();
    expect(parseResendEvent('{"data":{}}')).toBeNull();
    expect(parseResendEvent('{"type":"email.opened"}')?.emailId).toBeNull();
  });
});
