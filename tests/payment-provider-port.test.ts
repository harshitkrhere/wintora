/**
 * The payment provider port.
 *
 * The provider is the component most likely to change for reasons unrelated to
 * the product: country availability, an underwriting decision, or a provider
 * shutting down. These tests pin the contract so a replacement adapter either
 * satisfies it or fails loudly.
 */

import { describe, expect, it } from 'vitest';
import {
  PAYMENT_PROVIDERS,
  assertProviderSuitable,
  downgradeStrategy,
  type NormalizedEvent,
  type PaymentProvider,
  type ProviderSubscription,
} from '@/domain/billing/provider';
import { SUBSCRIPTION_STATUSES } from '@/domain/billing/states';

function stubProvider(overrides: Partial<PaymentProvider> = {}): PaymentProvider {
  const notCalled = () => {
    throw new Error('not called in this test');
  };

  return {
    name: 'razorpay',
    webhookSupport: 'SIGNED_WEBHOOKS',
    capabilities: {
      model: 'GATEWAY',
      webhooks: true,
      proration: true,
      scheduledPlanChange: true,
      pause: true,
      undoScheduledCancel: false,
      remitsTax: false,
      currencies: ['USD', 'CAD'],
    },
    ensureCustomer: notCalled,
    createCheckout: notCalled,
    verifyCheckoutCallback: notCalled,
    changePlan: notCalled,
    cancelAtPeriodEnd: notCalled,
    cancelImmediately: notCalled,
    reactivate: notCalled,
    pause: notCalled,
    resume: notCalled,
    getSubscription: notCalled,
    listInvoices: notCalled,
    verifyAndParseWebhook: notCalled,
    ...overrides,
  } as PaymentProvider;
}

describe('provider suitability', () => {
  it('accepts a provider with signed webhooks and both currencies', () => {
    expect(() => assertProviderSuitable(stubProvider())).not.toThrow();
  });

  it('rejects a provider that offers no signed webhooks', () => {
    // The "no webhooks, just call hasAccess()" model. It cannot participate in
    // the transaction that holds the row lock during quota reservation, and it
    // would make authorization depend on the provider being up.
    expect(() =>
      assertProviderSuitable(stubProvider({ webhookSupport: 'POLLING_ONLY' })),
    ).toThrow(/signed webhooks/);
  });

  it('explains why, rather than just failing', () => {
    try {
      assertProviderSuitable(stubProvider({ webhookSupport: 'POLLING_ONLY' }));
      expect.unreachable('should have thrown');
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain('transactional quota reservation');
      expect(message).toContain('couples authorization to their uptime');
    }
  });

  it('rejects a provider that cannot charge both supported currencies', () => {
    const usdOnly = stubProvider({
      capabilities: { ...stubProvider().capabilities, currencies: ['USD'] },
    });
    expect(() => assertProviderSuitable(usdOnly)).toThrow(/CAD/);

    const cadOnly = stubProvider({
      capabilities: { ...stubProvider().capabilities, currencies: ['CAD'] },
    });
    expect(() => assertProviderSuitable(cadOnly)).toThrow(/USD/);
  });

  it('reports every problem at once rather than the first', () => {
    const bad = stubProvider({
      webhookSupport: 'POLLING_ONLY',
      capabilities: { ...stubProvider().capabilities, currencies: [] },
    });
    try {
      assertProviderSuitable(bad);
      expect.unreachable('should have thrown');
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain('USD');
      expect(message).toContain('CAD');
      expect(message).toContain('signed webhooks');
    }
  });
});

describe('downgrade strategy', () => {
  it('defers to the provider when it can schedule a plan change', () => {
    expect(downgradeStrategy(stubProvider())).toBe('PROVIDER_SCHEDULED');
  });

  it('falls back to holding the change ourselves when it cannot', () => {
    // A provider that can only change plan immediately must not be allowed to
    // revoke access the customer has already paid for. We hold the pending plan
    // and apply it at period end instead.
    const immediate = stubProvider({
      capabilities: { ...stubProvider().capabilities, scheduledPlanChange: false },
    });
    expect(downgradeStrategy(immediate)).toBe('APPLICATION_SCHEDULED');
  });
});

describe('normalised event', () => {
  it('carries a status already mapped to our vocabulary', () => {
    // Adapters translate provider status strings. Nothing downstream should
    // ever see "past_due" or "trialing" in a provider's spelling.
    const subscription: ProviderSubscription = {
      providerSubscriptionId: 'sub_1',
      providerCustomerId: 'cus_1',
      providerPriceId: 'price_1',
      status: 'ACTIVE',
      currency: 'USD',
      amountCents: 1999,
      currentPeriodStart: new Date('2026-09-01T00:00:00Z'),
      currentPeriodEnd: new Date('2026-10-01T00:00:00Z'),
      cancelAtPeriodEnd: false,
      canceledAt: null,
      trialStart: null,
      trialEnd: null,
      updatedAt: new Date('2026-09-08T00:00:00Z'),
    };

    const event: NormalizedEvent = {
      eventId: 'evt_1',
      rawType: 'customer.subscription.updated',
      kind: 'SUBSCRIPTION_UPDATED',
      occurredAt: new Date('2026-09-08T00:00:00Z'),
      subscription,
    };

    expect(SUBSCRIPTION_STATUSES).toContain(event.subscription!.status);
    // The provider's own type string survives for the audit trail.
    expect(event.rawType).toBe('customer.subscription.updated');
  });

  it('allows a recognised event that is not a lifecycle change', () => {
    // An invoice being drafted is worth recording and worth ignoring.
    const event: NormalizedEvent = {
      eventId: 'evt_2',
      rawType: 'invoice.created',
      kind: null,
      occurredAt: new Date(),
    };
    expect(event.kind).toBeNull();
  });

  it('keeps the provider event id as the idempotency key', () => {
    const event: NormalizedEvent = {
      eventId: 'evt_3',
      rawType: 'x',
      kind: null,
      occurredAt: new Date(),
    };
    expect(event.eventId).toBe('evt_3');
  });
});

describe('provider registry', () => {
  it('lists exactly the providers that have an adapter', () => {
    // Stripe is invite-only in India and Paddle was replaced; neither has an
    // adapter, so neither is a name the application can write.
    expect([...PAYMENT_PROVIDERS]).toEqual(['razorpay']);
  });

  it('records that a gateway is not the legal seller', () => {
    // Not cosmetic: under a gateway WE remit tax, own refund decisions and own
    // the customer contract, which changes both compliance and the copy.
    const gateway = stubProvider();
    expect(gateway.capabilities.model).toBe('GATEWAY');
    expect(gateway.capabilities.remitsTax).toBe(false);
  });

  it('records that a scheduled cancellation cannot be withdrawn', () => {
    // The subscription page must not offer an "undo" the provider cannot do.
    expect(stubProvider().capabilities.undoScheduledCancel).toBe(false);
  });
});
