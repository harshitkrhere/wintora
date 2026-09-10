/**
 * Webhook handlers, written against the NORMALISED event shape.
 *
 * Nothing here knows which provider sent the event. Every state change goes
 * through the state machine, so an unexpected transition is rejected and
 * recorded rather than silently applied.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { POLICY } from '@/config/policy';
import { isPlanSlug, type PlanSlug } from '@/config/plans';
import {
  tryTransition,
  type BillingEvent,
  type SubscriptionStatus,
} from '@/domain/billing/states';
import type {
  NormalizedEvent,
  PaymentProvider,
  ProviderName,
  ProviderSubscription,
} from '@/domain/billing/provider';
import { recomputeEntitlements } from '@/lib/supabase/stores';
import { log } from '@/lib/logging';
import type { ClaimResult, HandlerMap, WebhookEventStore } from './webhook';

const DAY_MS = 24 * 60 * 60 * 1000;
const UNIQUE_VIOLATION = '23505';

// ---------------------------------------------------------------------------
// Supabase-backed event store
// ---------------------------------------------------------------------------

export function createWebhookStore(client: SupabaseClient): WebhookEventStore {
  return {
    async claim(event): Promise<ClaimResult> {
      const { error } = await client.from('webhook_events').insert({
        provider: event.provider,
        event_id: event.eventId,
        event_type: event.eventType,
        payload_hash: event.payloadHash,
        provider_created_at: event.providerCreatedAt?.toISOString() ?? null,
        status: 'RECEIVED',
      });

      // The unique constraint on (provider, event_id) IS the idempotency
      // mechanism. A violation means the provider redelivered.
      if (error !== null) {
        if (error.code === UNIQUE_VIOLATION) return 'DUPLICATE';
        throw new Error(`webhook claim failed: ${error.code ?? 'unknown'}`);
      }
      return 'NEW';
    },

    async markProcessed(eventId, status): Promise<void> {
      await client
        .from('webhook_events')
        .update({ status, processed_at: new Date().toISOString() })
        .eq('event_id', eventId);
    },

    async markFailed(eventId, errorClass): Promise<void> {
      const { data } = await client
        .from('webhook_events')
        .select('attempt_count')
        .eq('event_id', eventId)
        .maybeSingle();

      await client
        .from('webhook_events')
        .update({
          status: 'FAILED',
          error_class: errorClass,
          attempt_count: ((data?.attempt_count as number | undefined) ?? 0) + 1,
        })
        .eq('event_id', eventId);
    },

    async lastAppliedAt(providerSubscriptionId): Promise<Date | null> {
      const { data } = await client
        .from('subscriptions')
        .select('provider_object_updated_at')
        .eq('provider_subscription_id', providerSubscriptionId)
        .maybeSingle();

      const value = data?.provider_object_updated_at as string | null | undefined;
      return value === null || value === undefined ? null : new Date(value);
    },
  };
}

// ---------------------------------------------------------------------------
// Shared sync
// ---------------------------------------------------------------------------

async function resolveUserId(
  client: SupabaseClient,
  event: NormalizedEvent,
  provider: ProviderName,
): Promise<string | null> {
  // Metadata first: set at checkout and immune to a customer changing their
  // email in the provider's portal.
  if (event.userId !== undefined && event.userId.length > 0) return event.userId;

  const customerRef =
    event.customerRef ?? event.subscription?.providerCustomerId ?? null;
  if (customerRef === null || customerRef.length === 0) return null;

  const { data } = await client
    .from('billing_customers')
    .select('user_id')
    .eq('provider', provider)
    .eq('provider_customer_id', customerRef)
    .maybeSingle();

  return (data as { user_id: string } | null)?.user_id ?? null;
}

async function resolvePlanFromPrice(
  client: SupabaseClient,
  priceId: string | null,
): Promise<{ planId: string; slug: PlanSlug } | null> {
  if (priceId === null) return null;

  const { data } = await client
    .from('plan_prices')
    .select('plan_id, plans!inner(slug)')
    .eq('provider_price_id', priceId)
    .maybeSingle();

  if (data === null || data === undefined) return null;
  const row = data as unknown as { plan_id: string; plans: { slug: string } };
  if (!isPlanSlug(row.plans.slug)) return null;

  return { planId: row.plan_id, slug: row.plans.slug };
}

async function freePlanId(client: SupabaseClient): Promise<string | null> {
  const { data } = await client
    .from('plans')
    .select('id')
    .eq('slug', 'free')
    .eq('version', 1)
    .maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}

/**
 * Mirror the provider's subscription into our database, then recompute
 * entitlements.
 *
 * The provider is the billing authority; this is where that authority becomes
 * our authorization state. It never trusts a client, and every transition is
 * validated by the state machine.
 */
export async function syncSubscription(
  client: SupabaseClient,
  provider: ProviderName,
  subscription: ProviderSubscription,
  userId: string,
  eventAt: Date,
): Promise<void> {
  const plan = await resolvePlanFromPrice(client, subscription.providerPriceId);
  const planId = plan?.planId ?? (await freePlanId(client));

  if (planId === null) {
    throw new Error('No plan resolved and no free plan exists.');
  }

  const { data: existing } = await client
    .from('subscriptions')
    .select('id, status, provider_object_updated_at, grace_period_end')
    .eq('provider_subscription_id', subscription.providerSubscriptionId)
    .maybeSingle();

  const previous = existing as
    | {
        id: string;
        status: SubscriptionStatus;
        provider_object_updated_at: string | null;
        grace_period_end: string | null;
      }
    | null;

  // Ordering guard, second line after the dispatcher check.
  if (
    previous?.provider_object_updated_at != null &&
    new Date(previous.provider_object_updated_at).getTime() > eventAt.getTime()
  ) {
    log.info('dropping stale subscription event', { route: 'webhook' });
    return;
  }

  // Open a grace window on the first payment failure and keep it stable
  // afterwards. Premium access is not cut at the first failed charge.
  let gracePeriodEnd: Date | null =
    previous?.grace_period_end != null ? new Date(previous.grace_period_end) : null;

  const failing = subscription.status === 'PAST_DUE' || subscription.status === 'GRACE';
  if (failing && gracePeriodEnd === null) {
    gracePeriodEnd = new Date(Date.now() + POLICY.grace.days * DAY_MS);
  }
  if (!failing) gracePeriodEnd = null;

  const row = {
    user_id: userId,
    provider,
    provider_customer_id: subscription.providerCustomerId,
    provider_subscription_id: subscription.providerSubscriptionId,
    plan_id: planId,
    status: subscription.status,
    currency: subscription.currency,
    amount_cents: subscription.amountCents,
    provider_price_id: subscription.providerPriceId,
    current_period_start: subscription.currentPeriodStart?.toISOString() ?? null,
    current_period_end: subscription.currentPeriodEnd?.toISOString() ?? null,
    cancel_at_period_end: subscription.cancelAtPeriodEnd,
    canceled_at: subscription.canceledAt?.toISOString() ?? null,
    trial_start: subscription.trialStart?.toISOString() ?? null,
    trial_end: subscription.trialEnd?.toISOString() ?? null,
    grace_period_end: gracePeriodEnd?.toISOString() ?? null,
    provider_object_updated_at: eventAt.toISOString(),
  };

  if (previous === null) {
    await client.from('subscriptions').insert(row);
  } else {
    await client.from('subscriptions').update(row).eq('id', previous.id);
  }

  await auditTransition(client, userId, previous?.status ?? 'FREE', subscription.status);
  await recomputeEntitlements(client, userId);
}

/**
 * Validate the transition and record it. An illegal transition is a security
 * event: it means either a bug or a forged event that got past verification.
 */
async function auditTransition(
  client: SupabaseClient,
  userId: string,
  from: SubscriptionStatus,
  to: SubscriptionStatus,
): Promise<void> {
  if (from === to) return;

  const event = inferEvent(to);
  if (event !== null) {
    const result = tryTransition(from, event);
    if (!result.ok) {
      await client.from('security_events').insert({
        event_type: 'ILLEGAL_BILLING_TRANSITION',
        user_id: userId,
        severity: 'ERROR',
        detail: { from, to, event },
      });
    }
  }

  await client.from('audit_logs').insert({
    user_id: userId,
    action: 'SUBSCRIPTION_STATUS_CHANGED',
    resource_type: 'subscription',
    outcome: 'SUCCESS',
    context: { from, to },
  });
}

function inferEvent(to: SubscriptionStatus): BillingEvent | null {
  switch (to) {
    case 'ACTIVE':
      return 'PAYMENT_SUCCEEDED';
    case 'PAST_DUE':
      return 'PAYMENT_FAILED';
    case 'GRACE':
      return 'GRACE_STARTED';
    case 'CANCELED_PENDING_EXPIRY':
      return 'CANCEL_AT_PERIOD_END';
    case 'EXPIRED':
      return 'SUBSCRIPTION_DELETED';
    case 'PAUSED':
      return 'PAUSE_REQUESTED';
    case 'TRIALING':
      return 'TRIAL_STARTED';
    case 'REFUNDED':
      return 'REFUND_ISSUED';
    case 'REVOKED':
      return 'REVOKED_FOR_ABUSE';
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Handler map
// ---------------------------------------------------------------------------

export function createHandlers(
  client: SupabaseClient,
  provider: PaymentProvider,
): HandlerMap {
  const sync = async (event: NormalizedEvent): Promise<void> => {
    if (event.subscription === undefined) return;
    const userId = await resolveUserId(client, event, provider.name);

    if (userId === null) {
      // A subscription we cannot attribute is a reconciliation problem, not
      // something to guess about.
      await client.from('billing_reconciliations').insert({
        mismatch_type: 'UNATTRIBUTED_SUBSCRIPTION',
        provider_state: {
          id: event.subscription.providerSubscriptionId,
          customer: event.subscription.providerCustomerId,
        },
        internal_state: {},
      });
      return;
    }

    await syncSubscription(
      client,
      provider.name,
      event.subscription,
      userId,
      event.occurredAt,
    );
  };

  return {
    SUBSCRIPTION_ACTIVATED: sync,
    SUBSCRIPTION_UPDATED: sync,
    SUBSCRIPTION_CANCELED: sync,
    SUBSCRIPTION_PAUSED: sync,
    SUBSCRIPTION_RESUMED: sync,

    // A successful payment may or may not carry the subscription object. When
    // it does not, re-read from the provider rather than inferring.
    PAYMENT_SUCCEEDED: async (event) => {
      await upsertInvoice(client, event, provider.name);
      if (event.subscription !== undefined) {
        await sync(event);
        return;
      }
      await syncFromProvider(client, provider, event);
    },

    PAYMENT_FAILED: async (event) => {
      await upsertInvoice(client, event, provider.name);
      if (event.subscription !== undefined) {
        await sync(event);
        return;
      }
      await syncFromProvider(client, provider, event);
    },

    INVOICE_ISSUED: async (event) => {
      await upsertInvoice(client, event, provider.name);
    },

    REFUND_ISSUED: async (event) => {
      await handleRefund(client, event, provider.name);
    },

    DISPUTE_OPENED: async (event) => {
      await handleDispute(client, event, provider.name);
    },
  };
}

/**
 * Re-read the subscription from the provider when an event references one but
 * does not embed it. Reconciliation, not inference.
 */
async function syncFromProvider(
  client: SupabaseClient,
  provider: PaymentProvider,
  event: NormalizedEvent,
): Promise<void> {
  const ref = event.subscription?.providerSubscriptionId;
  if (ref === undefined || ref.length === 0) return;

  const fresh = await provider.getSubscription(ref);
  if (fresh === null) return;

  const userId = await resolveUserId(client, event, provider.name);
  if (userId === null) return;

  await syncSubscription(client, provider.name, fresh, userId, event.occurredAt);
}

async function upsertInvoice(
  client: SupabaseClient,
  event: NormalizedEvent,
  provider: ProviderName,
): Promise<void> {
  if (event.invoice === undefined) return;
  const userId = await resolveUserId(client, event, provider);
  if (userId === null) return;

  const invoice = event.invoice;

  await client.from('invoices').upsert(
    {
      user_id: userId,
      provider,
      provider_invoice_id: invoice.providerInvoiceId,
      number: invoice.number,
      amount_due_cents: invoice.amountDueCents,
      amount_paid_cents: invoice.amountPaidCents,
      // Under a Merchant of Record this tax was calculated, collected and
      // remitted by the provider as legal seller. We record it so the customer
      // can see it, and we never owe it.
      tax_cents: invoice.taxCents,
      currency: invoice.currency,
      status: invoice.status,
      hosted_invoice_url: invoice.hostedUrl,
      invoice_pdf_url: invoice.pdfUrl,
      period_start: invoice.periodStart?.toISOString() ?? null,
      period_end: invoice.periodEnd?.toISOString() ?? null,
      issued_at: event.occurredAt.toISOString(),
      paid_at: invoice.amountPaidCents > 0 ? event.occurredAt.toISOString() : null,
    },
    { onConflict: 'provider,provider_invoice_id' },
  );
}

/**
 * Refunds follow the RECORDED policy, never an implicit default.
 *
 * Under a Merchant of Record the refund DECISION is the provider's, not ours:
 * they honour refunds under their own buyer terms. What remains ours is the
 * entitlement consequence, which is what this records and applies.
 */
async function handleRefund(
  client: SupabaseClient,
  event: NormalizedEvent,
  provider: ProviderName,
): Promise<void> {
  if (event.refund === undefined) return;
  const userId = await resolveUserId(client, event, provider);
  if (userId === null) return;

  const refund = event.refund;
  const effect = refund.isFullRefund
    ? POLICY.refunds.fullRefundEffect
    : POLICY.refunds.partialRefundEffect;

  await client.from('refunds').upsert(
    {
      user_id: userId,
      provider,
      provider_refund_id: refund.providerRefundId,
      provider_reference: refund.providerPaymentRef,
      amount_cents: refund.amountCents,
      currency: refund.currency,
      reason: refund.reason,
      is_full_refund: refund.isFullRefund,
      entitlement_effect: effect,
      processed_at: event.occurredAt.toISOString(),
    },
    { onConflict: 'provider,provider_refund_id' },
  );

  if (effect === 'REVOKE_IMMEDIATELY') {
    await client
      .from('subscriptions')
      .update({ status: 'REFUNDED' })
      .eq('user_id', userId)
      .in('status', ['ACTIVE', 'TRIALING', 'PAST_DUE', 'GRACE', 'CANCELED_PENDING_EXPIRY']);

    await recomputeEntitlements(client, userId);
  }
}

async function handleDispute(
  client: SupabaseClient,
  event: NormalizedEvent,
  provider: ProviderName,
): Promise<void> {
  const userId = await resolveUserId(client, event, provider);
  if (userId === null) return;

  await client.from('security_events').insert({
    event_type: 'BILLING_STATE_MISMATCH',
    user_id: userId,
    severity: 'ERROR',
    detail: { kind: 'CHARGEBACK', eventId: event.eventId },
  });

  await client.from('subscriptions').update({ status: 'REVOKED' }).eq('user_id', userId);
  await recomputeEntitlements(client, userId);
}
