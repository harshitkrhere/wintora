/**
 * Webhook security, against the Razorpay adapter.
 *
 * Razorpay signs the raw body with the webhook secret (HMAC-SHA256, hex, in
 * X-Razorpay-Signature) and identifies each event in X-Razorpay-Event-Id. The
 * checkout callback is signed separately, over `payment_id|subscription_id`,
 * with the KEY secret. Both are verified in constant time before anything is
 * parsed, and both refuse silently-missing configuration.
 */

import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  createRazorpayProvider,
  fromUnix,
  mapRazorpayEventKind,
  mapRazorpayStatus,
  normalizeRefund,
  normalizeSubscription,
  verifyRazorpayCheckoutSignature,
  verifyRazorpayWebhookSignature,
  RAZORPAY_SUBSCRIBED_EVENTS,
} from '@/lib/payments/razorpay/adapter';
import { WebhookVerificationError, createInMemoryWebhookStore, hashPayload, processWebhookEvent } from '@/lib/payments/webhook';
import type { NormalizedEvent } from '@/domain/billing/provider';

// Deliberately NOT shaped like real Razorpay credentials. The secret-leak gate
// scans this file too.
const WEBHOOK_SECRET = 'test-webhook-secret-not-real';
const OTHER_SECRET = 'a-different-secret';
const KEY_ID = 'rzp_test_ABCDEFGHIJKLMN';
const KEY_SECRET = 'test-key-secret-not-real';

const provider = createRazorpayProvider({
  keyId: KEY_ID,
  keySecret: KEY_SECRET,
  webhookSecret: WEBHOOK_SECRET,
  maxEventAgeSeconds: 259_200,
});

const NOW_UNIX = Math.floor(Date.now() / 1000);

function sign(body: string, secret = WEBHOOK_SECRET): string {
  return createHmac('sha256', secret).update(body, 'utf8').digest('hex');
}

function subscriptionEntity(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'sub_TESTSUBSCRIPT1',
    entity: 'subscription',
    plan_id: 'plan_TESTPLANIDXXX1',
    customer_id: 'cust_TESTCUSTOMERX1',
    status: 'active',
    current_start: NOW_UNIX - 86_400,
    current_end: NOW_UNIX + 29 * 86_400,
    charge_at: NOW_UNIX + 29 * 86_400,
    start_at: NOW_UNIX - 86_400,
    total_count: 120,
    paid_count: 1,
    remaining_count: 119,
    notes: { wintora_user_id: '00000000-0000-4000-8000-000000000001', wintora_plan_slug: 'plus' },
    created_at: NOW_UNIX - 86_400,
    ...overrides,
  };
}

function paymentEntity(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'pay_TESTPAYMENTXX1',
    entity: 'payment',
    amount: 1999,
    currency: 'USD',
    status: 'captured',
    method: 'card',
    invoice_id: 'inv_TESTINVOICEXX1',
    customer_id: 'cust_TESTCUSTOMERX1',
    card: { network: 'Visa', last4: '1111', name: 'X' },
    created_at: NOW_UNIX - 60,
    ...overrides,
  };
}

function envelope(
  event: string,
  payload: Record<string, unknown>,
  createdAt = NOW_UNIX - 30,
): string {
  return JSON.stringify({
    entity: 'event',
    account_id: 'acc_TESTACCOUNTXX1',
    event,
    contains: Object.keys(payload),
    payload,
    created_at: createdAt,
  });
}

function headersFor(body: string, eventId = 'evt_TEST1', secret = WEBHOOK_SECRET): Headers {
  const h = new Headers();
  h.set('x-razorpay-signature', sign(body, secret));
  h.set('x-razorpay-event-id', eventId);
  return h;
}

describe('webhook signature', () => {
  const body = envelope('subscription.activated', { subscription: { entity: subscriptionEntity() } });

  it('accepts a correctly signed raw body', () => {
    expect(() => verifyRazorpayWebhookSignature(body, sign(body), WEBHOOK_SECRET)).not.toThrow();
  });

  it('rejects a body signed with a different secret', () => {
    expect(() => verifyRazorpayWebhookSignature(body, sign(body, OTHER_SECRET), WEBHOOK_SECRET)).toThrow(
      WebhookVerificationError,
    );
  });

  it('rejects a missing signature header', () => {
    try {
      verifyRazorpayWebhookSignature(body, null, WEBHOOK_SECRET);
      expect.unreachable();
    } catch (error) {
      expect((error as WebhookVerificationError).reason).toBe('MISSING_SIGNATURE');
    }
  });

  it('fails closed when no secret is configured', () => {
    try {
      verifyRazorpayWebhookSignature(body, sign(body), undefined);
      expect.unreachable();
    } catch (error) {
      expect((error as WebhookVerificationError).reason).toBe('MISSING_SECRET');
    }
  });

  it('rejects a signature that is not a hex SHA-256 digest', () => {
    for (const bad of ['deadbeef', 'sha256=' + sign(body), sign(body) + '0', '']) {
      expect(() => verifyRazorpayWebhookSignature(body, bad, WEBHOOK_SECRET)).toThrow(
        WebhookVerificationError,
      );
    }
  });

  it('rejects a body that changed after signing', () => {
    const signature = sign(body);
    const tampered = body.replace('"status":"active"', '"status":"cancelled"');
    expect(tampered).not.toBe(body);
    expect(() => verifyRazorpayWebhookSignature(tampered, signature, WEBHOOK_SECRET)).toThrow(
      WebhookVerificationError,
    );
  });

  it('accepts the digest in either case', () => {
    expect(() =>
      verifyRazorpayWebhookSignature(body, sign(body).toUpperCase(), WEBHOOK_SECRET),
    ).not.toThrow();
  });
});

describe('checkout callback signature', () => {
  const callback = {
    providerPaymentId: 'pay_TESTPAYMENTXX1',
    providerSubscriptionId: 'sub_TESTSUBSCRIPT1',
  };
  const good = createHmac('sha256', KEY_SECRET)
    .update(`${callback.providerPaymentId}|${callback.providerSubscriptionId}`)
    .digest('hex');

  it('accepts payment|subscription signed with the key secret', () => {
    expect(() => verifyRazorpayCheckoutSignature({ ...callback, signature: good }, KEY_SECRET)).not.toThrow();
    expect(() => provider.verifyCheckoutCallback({ ...callback, signature: good })).not.toThrow();
  });

  it('rejects a signature made with the webhook secret instead', () => {
    const wrong = createHmac('sha256', WEBHOOK_SECRET)
      .update(`${callback.providerPaymentId}|${callback.providerSubscriptionId}`)
      .digest('hex');
    expect(() => provider.verifyCheckoutCallback({ ...callback, signature: wrong })).toThrow(
      WebhookVerificationError,
    );
  });

  it('rejects a swapped payment id', () => {
    expect(() =>
      provider.verifyCheckoutCallback({ ...callback, providerPaymentId: 'pay_OTHERPAYMENTX1', signature: good }),
    ).toThrow(WebhookVerificationError);
  });

  it('rejects malformed ids before doing any crypto', () => {
    expect(() =>
      provider.verifyCheckoutCallback({ ...callback, providerSubscriptionId: 'sub_x', signature: good }),
    ).toThrow(/malformed/);
  });
});

describe('verifyAndParseWebhook', () => {
  it('uses the provider event id as the idempotency key', () => {
    const body = envelope('subscription.activated', { subscription: { entity: subscriptionEntity() } });
    const event = provider.verifyAndParseWebhook(body, headersFor(body, 'evt_abc123'), WEBHOOK_SECRET);
    expect(event.eventId).toBe('evt_abc123');
    expect(event.rawType).toBe('subscription.activated');
    expect(event.kind).toBe('SUBSCRIPTION_ACTIVATED');
  });

  it('derives a stable id from the body when the header is missing', () => {
    const body = envelope('subscription.charged', {
      subscription: { entity: subscriptionEntity() },
      payment: { entity: paymentEntity() },
    });
    const h = new Headers();
    h.set('x-razorpay-signature', sign(body));
    const a = provider.verifyAndParseWebhook(body, h, WEBHOOK_SECRET);
    const b = provider.verifyAndParseWebhook(body, h, WEBHOOK_SECRET);
    expect(a.eventId).toBe(b.eventId);
    expect(a.eventId.startsWith('rzp_')).toBe(true);
  });

  it('refuses an event older than the accepted window', () => {
    const body = envelope(
      'subscription.activated',
      { subscription: { entity: subscriptionEntity() } },
      NOW_UNIX - 30 * 86_400,
    );
    expect(() => provider.verifyAndParseWebhook(body, headersFor(body), WEBHOOK_SECRET)).toThrow(
      /older than/,
    );
  });

  it('carries our user id from the subscription notes', () => {
    const body = envelope('subscription.activated', { subscription: { entity: subscriptionEntity() } });
    const event = provider.verifyAndParseWebhook(body, headersFor(body), WEBHOOK_SECRET);
    expect(event.userId).toBe('00000000-0000-4000-8000-000000000001');
    expect(event.customerRef).toBe('cust_TESTCUSTOMERX1');
  });

  it('treats empty notes ([]) as no notes', () => {
    const body = envelope('subscription.activated', {
      subscription: { entity: subscriptionEntity({ notes: [] }) },
    });
    const event = provider.verifyAndParseWebhook(body, headersFor(body), WEBHOOK_SECRET);
    expect(event.userId).toBeUndefined();
  });

  it('normalises a charge into a payment and an invoice reference', () => {
    const body = envelope('subscription.charged', {
      subscription: { entity: subscriptionEntity() },
      payment: { entity: paymentEntity() },
    });
    const event = provider.verifyAndParseWebhook(body, headersFor(body), WEBHOOK_SECRET);
    expect(event.kind).toBe('PAYMENT_SUCCEEDED');
    expect(event.payment?.providerPaymentId).toBe('pay_TESTPAYMENTXX1');
    expect(event.payment?.providerInvoiceId).toBe('inv_TESTINVOICEXX1');
    expect(event.payment?.amountCents).toBe(1999);
    expect(event.payment?.cardBrand).toBe('Visa');
    expect(event.payment?.cardLast4).toBe('1111');
    expect(event.paymentRef).toBe('pay_TESTPAYMENTXX1');
  });

  it('never keeps more than four card digits', () => {
    const body = envelope('subscription.charged', {
      subscription: { entity: subscriptionEntity() },
      payment: { entity: paymentEntity({ card: { network: 'Visa', last4: '4111111111111111' } }) },
    });
    const event = provider.verifyAndParseWebhook(body, headersFor(body), WEBHOOK_SECRET);
    expect(event.payment?.cardLast4).toBeNull();
  });

  it('attributes a refund to its payment and knows whether it was full', () => {
    const body = envelope('refund.processed', {
      refund: {
        entity: { id: 'rfnd_TESTREFUNDXXX1', payment_id: 'pay_TESTPAYMENTXX1', amount: 1999, currency: 'USD', status: 'processed', notes: [] },
      },
      payment: { entity: paymentEntity() },
    });
    const event = provider.verifyAndParseWebhook(body, headersFor(body), WEBHOOK_SECRET);
    expect(event.kind).toBe('REFUND_ISSUED');
    expect(event.refund?.isFullRefund).toBe(true);
    expect(event.paymentRef).toBe('pay_TESTPAYMENTXX1');
    expect(event.subscription).toBeUndefined();
  });

  it('treats a partial refund, and a refund without its payment, as partial', () => {
    expect(
      normalizeRefund({ id: 'rfnd_1', payment_id: 'pay_1', amount: 500, currency: 'USD' }, { amount: 1999 })
        .isFullRefund,
    ).toBe(false);
    expect(
      normalizeRefund({ id: 'rfnd_1', payment_id: 'pay_1', amount: 1999, currency: 'USD' }, undefined)
        .isFullRefund,
    ).toBe(false);
  });

  it('marks a dispute so the handler can revoke and record it', () => {
    const body = envelope('payment.dispute.created', {
      dispute: { entity: { id: 'disp_TESTDISPUTEXX1', payment_id: 'pay_TESTPAYMENTXX1', amount: 1999, currency: 'USD', status: 'open' } },
      payment: { entity: paymentEntity() },
    });
    const event = provider.verifyAndParseWebhook(body, headersFor(body), WEBHOOK_SECRET);
    expect(event.kind).toBe('DISPUTE_OPENED');
    expect(event.paymentRef).toBe('pay_TESTPAYMENTXX1');
  });

  it('records an unknown event type as recognised-but-ignored rather than failing', () => {
    const body = envelope('payment.authorized', { payment: { entity: paymentEntity() } });
    const event = provider.verifyAndParseWebhook(body, headersFor(body), WEBHOOK_SECRET);
    expect(event.kind).toBeNull();
    expect(event.rawType).toBe('payment.authorized');
  });
});

describe('status mapping', () => {
  it('maps every Razorpay state into our vocabulary', () => {
    expect(mapRazorpayStatus('created')).toBe('CHECKOUT_PENDING');
    expect(mapRazorpayStatus('authenticated')).toBe('ACTIVE');
    expect(mapRazorpayStatus('active')).toBe('ACTIVE');
    expect(mapRazorpayStatus('pending')).toBe('PAST_DUE');
    expect(mapRazorpayStatus('halted')).toBe('PAST_DUE');
    expect(mapRazorpayStatus('paused')).toBe('PAUSED');
    expect(mapRazorpayStatus('cancelled')).toBe('EXPIRED');
    expect(mapRazorpayStatus('completed')).toBe('EXPIRED');
    expect(mapRazorpayStatus('expired')).toBe('EXPIRED');
  });

  it('fails closed on a status it has never seen', () => {
    // A new Razorpay state must cost a customer a feature temporarily (which
    // reconciliation flags), never grant one.
    expect(mapRazorpayStatus('some_future_status')).toBe('EXPIRED');
    expect(mapRazorpayStatus('')).toBe('EXPIRED');
  });

  it('converts Unix seconds to dates and rejects nonsense', () => {
    expect(fromUnix(1_700_000_000)?.toISOString()).toBe('2023-11-14T22:13:20.000Z');
    expect(fromUnix(null)).toBeNull();
    expect(fromUnix(0)).toBeNull();
    expect(fromUnix(Number.NaN)).toBeNull();
  });

  it('leaves the cancel-at-period-end flag to our own record', () => {
    // Razorpay does not expose a scheduled cancellation on the object, so the
    // adapter says "unknown" and the sync keeps what we recorded.
    const sub = normalizeSubscription(subscriptionEntity() as never, new Date());
    expect(sub.cancelAtPeriodEnd).toBeNull();
    expect(sub.providerPriceId).toBe('plan_TESTPLANIDXXX1');
    expect(sub.currentPeriodEnd?.getTime()).toBe((NOW_UNIX + 29 * 86_400) * 1000);
  });
});

describe('event kind mapping', () => {
  it('maps every subscribed event to a kind or an explicit null', () => {
    for (const name of RAZORPAY_SUBSCRIBED_EVENTS) {
      expect(mapRazorpayEventKind(name), name).not.toBeUndefined();
    }
  });

  it('treats both retry states as payment failures', () => {
    expect(mapRazorpayEventKind('subscription.pending')).toBe('PAYMENT_FAILED');
    expect(mapRazorpayEventKind('subscription.halted')).toBe('PAYMENT_FAILED');
  });

  it('treats completion like cancellation: the subscription is over', () => {
    expect(mapRazorpayEventKind('subscription.completed')).toBe('SUBSCRIPTION_CANCELED');
  });
});

describe('dispatcher', () => {
  function event(id: string, kind: NormalizedEvent['kind'] = 'SUBSCRIPTION_UPDATED'): NormalizedEvent {
    return {
      eventId: id,
      rawType: 'subscription.updated',
      kind,
      occurredAt: new Date(),
      subscription: normalizeSubscription(subscriptionEntity() as never, new Date()),
    };
  }

  it('processes a new event once and treats the redelivery as a duplicate', async () => {
    const store = createInMemoryWebhookStore();
    let calls = 0;
    const handlers = { SUBSCRIPTION_UPDATED: async () => void (calls += 1) };

    const first = await processWebhookEvent('razorpay', store, handlers, event('evt_1'), hashPayload('a'));
    const second = await processWebhookEvent('razorpay', store, handlers, event('evt_1'), hashPayload('a'));

    expect(first.outcome).toBe('PROCESSED');
    expect(second.outcome).toBe('DUPLICATE');
    expect(calls).toBe(1);
  });

  it('lets the provider retry an event whose handler failed', async () => {
    // The 500 we return is a request to retry. A claim that could never be
    // released would turn every transient failure into a customer who paid and
    // received nothing.
    const store = createInMemoryWebhookStore();
    let attempts = 0;
    const handlers = {
      SUBSCRIPTION_UPDATED: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error('database hiccup');
      },
    };

    const first = await processWebhookEvent('razorpay', store, handlers, event('evt_2'), hashPayload('b'));
    const retry = await processWebhookEvent('razorpay', store, handlers, event('evt_2'), hashPayload('b'));
    const again = await processWebhookEvent('razorpay', store, handlers, event('evt_2'), hashPayload('b'));

    expect(first.outcome).toBe('FAILED');
    expect(retry.outcome).toBe('PROCESSED');
    expect(again.outcome).toBe('DUPLICATE');
    expect(attempts).toBe(2);
  });

  it('drops an event older than what has already been applied', async () => {
    const store = createInMemoryWebhookStore();
    store.setLastApplied('sub_TESTSUBSCRIPT1', new Date(Date.now() + 60_000));
    let calls = 0;
    const result = await processWebhookEvent(
      'razorpay',
      store,
      { SUBSCRIPTION_UPDATED: async () => void (calls += 1) },
      event('evt_3'),
      hashPayload('c'),
    );
    expect(result.outcome).toBe('STALE');
    expect(calls).toBe(0);
  });

  it('acknowledges an event with no handler instead of retrying it forever', async () => {
    const store = createInMemoryWebhookStore();
    const result = await processWebhookEvent('razorpay', store, {}, event('evt_4', null), hashPayload('d'));
    expect(result.outcome).toBe('IGNORED');
  });
});
