/**
 * Webhook security, against the Paddle adapter.
 *
 * Forged signatures, replays, modified bodies with a valid event id,
 * out-of-order delivery, and unknown event types. A webhook endpoint that gets
 * any of these wrong hands out paid features for free.
 *
 * Signatures are constructed here with the real scheme (HMAC-SHA256 over
 * `<ts>:<raw body>`), so these exercise the actual verification path rather
 * than a mock of it.
 */

import { createHmac } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  createPaddleProvider,
  mapPaddleEventKind,
  mapPaddleStatus,
  verifyPaddleSignature,
} from '@/lib/payments/paddle/adapter';
import {
  WebhookVerificationError,
  createInMemoryWebhookStore,
  hashPayload,
  processWebhookEvent,
  type HandlerMap,
} from '@/lib/payments/webhook';

// Deliberately NOT shaped like a real Paddle secret. The secret-leak gate
// scans this directory, and a fixture that matches the live credential pattern
// would either trip the gate or force it to be weakened. Only the HMAC matters.
const SECRET = 'unit-test-signing-key-not-a-real-credential';
const OTHER_SECRET = 'a-completely-different-unit-test-signing-key';

const provider = createPaddleProvider({
  apiKey: 'unit-test-api-key',
  webhookSecret: SECRET,
  environment: 'sandbox',
  toleranceSeconds: 300,
});

function body(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    event_id: 'evt_test_1',
    event_type: 'subscription.updated',
    occurred_at: new Date().toISOString(),
    data: {
      id: 'sub_test_1',
      status: 'active',
      customer_id: 'ctm_test_1',
      currency_code: 'USD',
      updated_at: new Date().toISOString(),
      current_billing_period: {
        starts_at: '2026-09-01T00:00:00Z',
        ends_at: '2026-10-01T00:00:00Z',
      },
      items: [{ price: { id: 'pri_test_1', unit_price: { amount: '1999', currency_code: 'USD' } } }],
      custom_data: { wintora_user_id: '11111111-1111-4111-8111-111111111111' },
    },
    ...overrides,
  });
}

function sign(payload: string, secret = SECRET, timestamp?: number): string {
  const ts = timestamp ?? Math.floor(Date.now() / 1000);
  const h1 = createHmac('sha256', secret).update(`${ts}:${payload}`, 'utf8').digest('hex');
  return `ts=${ts};h1=${h1}`;
}

function headersFor(signature: string | null): Headers {
  const headers = new Headers();
  if (signature !== null) headers.set('paddle-signature', signature);
  return headers;
}

describe('signature verification', () => {
  it('accepts a correctly signed payload', () => {
    const payload = body();
    const event = provider.verifyAndParseWebhook(payload, headersFor(sign(payload)), SECRET);
    expect(event.eventId).toBe('evt_test_1');
    expect(event.rawType).toBe('subscription.updated');
  });

  it('rejects a forged signature', () => {
    const payload = body();
    expect(() =>
      verifyPaddleSignature(payload, 'ts=1757289600;h1=deadbeef', SECRET, 300),
    ).toThrow(WebhookVerificationError);
  });

  it('rejects a signature made with a different secret', () => {
    const payload = body();
    expect(() =>
      verifyPaddleSignature(payload, sign(payload, OTHER_SECRET), SECRET, 300),
    ).toThrow(WebhookVerificationError);
  });

  it('rejects a missing signature header', () => {
    try {
      verifyPaddleSignature(body(), null, SECRET, 300);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as WebhookVerificationError).reason).toBe('MISSING_SIGNATURE');
    }
  });

  it('fails closed when no endpoint secret is configured', () => {
    const payload = body();
    try {
      verifyPaddleSignature(payload, sign(payload), undefined, 300);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as WebhookVerificationError).reason).toBe('MISSING_SECRET');
    }
  });

  it('rejects a malformed signature header', () => {
    const payload = body();
    for (const header of ['garbage', 'ts=abc;h1=def', 'h1=only', 'ts=123']) {
      expect(() => verifyPaddleSignature(payload, header, SECRET, 300)).toThrow(
        WebhookVerificationError,
      );
    }
  });

  it('rejects a body modified after signing', () => {
    // The attack: capture a legitimate event, change the plan, resend it.
    const original = body();
    const signature = sign(original);
    const tampered = original.replace('"status":"active"', '"status":"trialing"');

    expect(() => verifyPaddleSignature(tampered, signature, SECRET, 300)).toThrow(
      WebhookVerificationError,
    );
  });

  it('rejects a replay outside the timestamp tolerance', () => {
    const payload = body();
    const old = Math.floor(Date.now() / 1000) - 3600;
    expect(() => verifyPaddleSignature(payload, sign(payload, SECRET, old), SECRET, 300)).toThrow(
      WebhookVerificationError,
    );
  });

  it('accepts a replay inside the tolerance, which idempotency then handles', () => {
    const payload = body();
    const recent = Math.floor(Date.now() / 1000) - 60;
    const result = verifyPaddleSignature(payload, sign(payload, SECRET, recent), SECRET, 300);
    expect(result.timestamp.getTime()).toBe(recent * 1000);
  });
});

describe('payload hashing', () => {
  it('produces a stable hash of the raw body', () => {
    const payload = body();
    expect(hashPayload(payload)).toBe(hashPayload(payload));
    expect(hashPayload(payload)).toHaveLength(64);
  });

  it('differs for a modified body, making a substituted replay detectable', () => {
    const a = body();
    const b = a.replace('sub_test_1', 'sub_test_2');
    expect(hashPayload(a)).not.toBe(hashPayload(b));
  });
});

describe('normalisation', () => {
  it('maps the subscription into our vocabulary', () => {
    const payload = body();
    const event = provider.verifyAndParseWebhook(payload, headersFor(sign(payload)), SECRET);

    expect(event.kind).toBe('SUBSCRIPTION_UPDATED');
    expect(event.subscription?.status).toBe('ACTIVE');
    expect(event.subscription?.providerSubscriptionId).toBe('sub_test_1');
    expect(event.subscription?.amountCents).toBe(1999);
    expect(event.subscription?.currency).toBe('USD');
    // Money arrives as a string in minor units and must stay an integer.
    expect(Number.isInteger(event.subscription?.amountCents)).toBe(true);
  });

  it('carries our user id through from custom_data', () => {
    const payload = body();
    const event = provider.verifyAndParseWebhook(payload, headersFor(sign(payload)), SECRET);
    expect(event.userId).toBe('11111111-1111-4111-8111-111111111111');
  });

  it('reads a scheduled cancellation as canceled-pending-expiry', () => {
    // Paddle expresses "cancel at period end" as a scheduled change, not a flag.
    const payload = body({
      data: {
        id: 'sub_test_1',
        status: 'active',
        customer_id: 'ctm_test_1',
        currency_code: 'USD',
        scheduled_change: { action: 'cancel', effective_at: '2026-10-01T00:00:00Z' },
        items: [{ price: { id: 'pri_test_1', unit_price: { amount: '1999' } } }],
      },
    });
    const event = provider.verifyAndParseWebhook(payload, headersFor(sign(payload)), SECRET);

    expect(event.subscription?.status).toBe('CANCELED_PENDING_EXPIRY');
    expect(event.subscription?.cancelAtPeriodEnd).toBe(true);
  });
});

describe('status mapping', () => {
  const noGrace = { scheduledCancel: false, gracePeriodEnd: null };

  it('maps the documented statuses', () => {
    expect(mapPaddleStatus('active', noGrace)).toBe('ACTIVE');
    expect(mapPaddleStatus('trialing', noGrace)).toBe('TRIALING');
    expect(mapPaddleStatus('paused', noGrace)).toBe('PAUSED');
    expect(mapPaddleStatus('canceled', noGrace)).toBe('EXPIRED');
    expect(mapPaddleStatus('past_due', noGrace)).toBe('PAST_DUE');
  });

  it('honours our own grace window over the provider giving up', () => {
    const inGrace = {
      scheduledCancel: false,
      gracePeriodEnd: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
    };
    expect(mapPaddleStatus('past_due', inGrace)).toBe('GRACE');
  });

  it('fails closed on an unrecognised status', () => {
    // An unknown status must not become ACTIVE. Losing a feature is recoverable
    // and reconciliation flags it; giving away paid access silently is not.
    expect(mapPaddleStatus('some_future_status', noGrace)).toBe('EXPIRED');
    expect(mapPaddleStatus('', noGrace)).toBe('EXPIRED');
  });
});

describe('event kind mapping', () => {
  it('maps the lifecycle events we act on', () => {
    expect(mapPaddleEventKind('subscription.activated')).toBe('SUBSCRIPTION_ACTIVATED');
    expect(mapPaddleEventKind('subscription.canceled')).toBe('SUBSCRIPTION_CANCELED');
    expect(mapPaddleEventKind('transaction.completed')).toBe('PAYMENT_SUCCEEDED');
    expect(mapPaddleEventKind('transaction.payment_failed')).toBe('PAYMENT_FAILED');
    expect(mapPaddleEventKind('adjustment.created')).toBe('REFUND_ISSUED');
  });

  it('returns null for anything it does not recognise', () => {
    expect(mapPaddleEventKind('report.created')).toBeNull();
    expect(mapPaddleEventKind('some.future.event')).toBeNull();
  });
});

describe('idempotency and dispatch', () => {
  let handled: string[] = [];
  let store: ReturnType<typeof createInMemoryWebhookStore>;
  let handlers: HandlerMap;

  beforeEach(() => {
    handled = [];
    store = createInMemoryWebhookStore();
    handlers = {
      SUBSCRIPTION_UPDATED: async (event) => {
        handled.push(event.eventId);
      },
      REFUND_ISSUED: async () => {
        throw new Error('provider unavailable');
      },
    };
  });

  const parse = (payload: string) =>
    provider.verifyAndParseWebhook(payload, headersFor(sign(payload)), SECRET);

  it('processes a new event exactly once', async () => {
    const payload = body();
    const result = await processWebhookEvent(
      'paddle',
      store,
      handlers,
      parse(payload),
      hashPayload(payload),
    );

    expect(result.outcome).toBe('PROCESSED');
    expect(handled).toEqual(['evt_test_1']);
  });

  it('does not reapply a redelivered event', async () => {
    // Paddle retries. The unique (provider, event_id) claim is what makes that
    // safe: the business state change must not happen twice.
    const payload = body();
    const event = parse(payload);
    const hash = hashPayload(payload);

    await processWebhookEvent('paddle', store, handlers, event, hash);
    const second = await processWebhookEvent('paddle', store, handlers, event, hash);
    const third = await processWebhookEvent('paddle', store, handlers, event, hash);

    expect(second.outcome).toBe('DUPLICATE');
    expect(third.outcome).toBe('DUPLICATE');
    expect(handled).toEqual(['evt_test_1']);
  });

  it('drops an event that arrived out of order', async () => {
    // A late delivery must not roll a subscription backwards.
    store.setLastApplied('sub_test_1', new Date());

    const payload = body({
      event_id: 'evt_old',
      occurred_at: new Date(Date.now() - 600_000).toISOString(),
    });

    const result = await processWebhookEvent(
      'paddle',
      store,
      handlers,
      parse(payload),
      hashPayload(payload),
    );

    expect(result.outcome).toBe('STALE');
    expect(handled).toEqual([]);
  });

  it('applies a newer event for the same subscription', async () => {
    store.setLastApplied('sub_test_1', new Date(Date.now() - 600_000));
    const payload = body({ event_id: 'evt_new' });

    const result = await processWebhookEvent(
      'paddle',
      store,
      handlers,
      parse(payload),
      hashPayload(payload),
    );
    expect(result.outcome).toBe('PROCESSED');
  });

  it('ignores an event type with no handler, without erroring', async () => {
    // A new provider event type must not become a retry storm.
    const payload = body({ event_id: 'evt_unknown', event_type: 'report.created' });

    const result = await processWebhookEvent(
      'paddle',
      store,
      handlers,
      parse(payload),
      hashPayload(payload),
    );
    expect(result.outcome).toBe('IGNORED');
    expect(handled).toEqual([]);
  });

  it('records a handler failure so the provider can retry safely', async () => {
    const payload = body({ event_id: 'evt_fail', event_type: 'adjustment.created' });

    const result = await processWebhookEvent(
      'paddle',
      store,
      handlers,
      parse(payload),
      hashPayload(payload),
    );

    expect(result.outcome).toBe('FAILED');
    expect(result.errorClass).toBe('Error');
    expect(store.events.get('evt_fail')?.status).toContain('FAILED');
  });
});

describe('provider capabilities', () => {
  it('declares itself a merchant of record that remits tax', () => {
    // This is why we are on Paddle: an India-based individual seller cannot
    // practically remit sales tax across fifty states and thirteen provinces.
    expect(provider.capabilities.model).toBe('MERCHANT_OF_RECORD');
    expect(provider.capabilities.remitsTax).toBe(true);
  });

  it('supports both currencies the product sells in', () => {
    expect(provider.capabilities.currencies).toContain('USD');
    expect(provider.capabilities.currencies).toContain('CAD');
  });

  it('uses signed webhooks rather than polling', () => {
    expect(provider.webhookSupport).toBe('SIGNED_WEBHOOKS');
  });
});
