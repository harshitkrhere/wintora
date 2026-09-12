/**
 * Webhook handlers, written against the NORMALISED event shape.
 *
 * Nothing here knows which provider sent the event. Every state change goes
 * through the state machine, so an unexpected transition is rejected and
 * recorded rather than silently applied.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { POLICY } from '@/config/policy';
import { isBillingInterval, isPlanSlug, type BillingInterval, type PlanSlug } from '@/config/plans';
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
import { billingCountry } from '@/lib/payments';
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
      // mechanism. A violation means the provider redelivered. If the earlier
      // attempt failed, the provider is retrying because we returned 500, so
      // the row is reopened rather than the retry being swallowed.
      if (error !== null) {
        if (error.code !== UNIQUE_VIOLATION) {
          throw new Error(`webhook claim failed: ${error.code ?? 'unknown'}`);
        }
        const { data } = await client
          .from('webhook_events')
          .select('status')
          .eq('provider', event.provider)
          .eq('event_id', event.eventId)
          .maybeSingle();
        if ((data as { status: string } | null)?.status !== 'FAILED') return 'DUPLICATE';

        await client
          .from('webhook_events')
          .update({ status: 'RECEIVED', error_class: null })
          .eq('provider', event.provider)
          .eq('event_id', event.eventId);
        return 'RETRY';
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
  // email in the provider's dashboard.
  if (event.userId !== undefined && event.userId.length > 0) return event.userId;

  // Then the subscription itself, which we wrote when checkout began.
  const subscriptionRef = event.subscription?.providerSubscriptionId ?? null;
  if (subscriptionRef !== null && subscriptionRef.length > 0) {
    const { data } = await client
      .from('subscriptions')
      .select('user_id')
      .eq('provider_subscription_id', subscriptionRef)
      .maybeSingle();
    const found = (data as { user_id: string } | null)?.user_id;
    if (found !== undefined) return found;
  }

  // Then the provider's customer id.
  const customerRef =
    event.customerRef ?? event.subscription?.providerCustomerId ?? null;
  if (customerRef !== null && customerRef.length > 0) {
    const { data } = await client
      .from('billing_customers')
      .select('user_id')
      .eq('provider', provider)
      .eq('provider_customer_id', customerRef)
      .maybeSingle();
    const found = (data as { user_id: string } | null)?.user_id;
    if (found !== undefined) return found;
  }

  // Finally the payment, for refunds and disputes that reference nothing else.
  if (event.paymentRef !== undefined && event.paymentRef.length > 0) {
    const { data } = await client
      .from('payments')
      .select('user_id')
      .eq('provider', provider)
      .eq('provider_payment_id', event.paymentRef)
      .maybeSingle();
    const found = (data as { user_id: string } | null)?.user_id;
    if (found !== undefined) return found;
  }

  return null;
}

interface ResolvedPlan {
  readonly planId: string;
  readonly slug: PlanSlug;
  readonly interval: BillingInterval;
  readonly amountCents: number;
  readonly currency: string;
}

/**
 * The price row a provider price id belongs to. This is the ONLY place a
 * provider's plan reference is turned into our plan, and the amount recorded on
 * the subscription comes from here rather than from the provider's payment:
 * the payment on an upgrade is a prorated difference, not the plan price.
 */
async function resolvePlanFromPrice(
  client: SupabaseClient,
  priceId: string | null,
): Promise<ResolvedPlan | null> {
  if (priceId === null) return null;

  const { data } = await client
    .from('plan_prices')
    .select('plan_id, interval, amount_cents, currency, plans!inner(slug)')
    .eq('provider_price_id', priceId)
    .maybeSingle();

  if (data === null || data === undefined) return null;
  const row = data as unknown as {
    plan_id: string;
    interval: string;
    amount_cents: number;
    currency: string;
    plans: { slug: string };
  };
  if (!isPlanSlug(row.plans.slug) || !isBillingInterval(row.interval)) return null;

  return {
    planId: row.plan_id,
    slug: row.plans.slug,
    interval: row.interval,
    amountCents: row.amount_cents,
    currency: row.currency,
  };
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

/** Remember a provider customer id the first time a webhook reveals it. */
async function rememberCustomer(
  client: SupabaseClient,
  provider: ProviderName,
  userId: string,
  providerCustomerId: string,
): Promise<void> {
  if (providerCustomerId.length === 0) return;
  await client
    .from('billing_customers')
    .upsert(
      { user_id: userId, provider, provider_customer_id: providerCustomerId },
      { onConflict: 'user_id,provider', ignoreDuplicates: true },
    );
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

  // A live subscription whose price we do not recognise is a paying customer
  // we cannot serve correctly. Writing them onto the Free plan would look like
  // success (a clean FREE -> ACTIVE transition) while giving them Free-tier
  // quotas for a Pro-tier charge. Fail the event instead: the provider retries,
  // the failure is visible in webhook_events, and nothing false is recorded.
  if (plan === null && subscription.providerPriceId !== null) {
    throw new Error(
      `Provider price ${subscription.providerPriceId} is not in plan_prices. ` +
        'Run npm run razorpay:seed, or add the price row, before this event can be processed.',
    );
  }

  const planId = plan?.planId ?? (await freePlanId(client));

  if (planId === null) {
    throw new Error('No plan resolved and no free plan exists.');
  }

  const { data: existing } = await client
    .from('subscriptions')
    .select('id, status, provider_object_updated_at, grace_period_end, cancel_at_period_end, country')
    .eq('provider_subscription_id', subscription.providerSubscriptionId)
    .maybeSingle();

  const previous = existing as
    | {
        id: string;
        status: SubscriptionStatus;
        provider_object_updated_at: string | null;
        grace_period_end: string | null;
        cancel_at_period_end: boolean;
        country: string;
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

  // A cancellation scheduled for period end is OUR record when the provider
  // does not expose it on the object. The provider keeps saying "active" until
  // the period ends; we keep saying "canceled, active until then".
  const cancelAtPeriodEnd =
    subscription.cancelAtPeriodEnd ?? previous?.cancel_at_period_end ?? false;
  const status: SubscriptionStatus =
    subscription.status === 'ACTIVE' && cancelAtPeriodEnd
      ? 'CANCELED_PENDING_EXPIRY'
      : subscription.status;

  // Open a grace window on the first payment failure and keep it stable
  // afterwards. Premium access is not cut at the first failed charge.
  let gracePeriodEnd: Date | null =
    previous?.grace_period_end != null ? new Date(previous.grace_period_end) : null;

  const failing = status === 'PAST_DUE' || status === 'GRACE';
  if (failing && gracePeriodEnd === null) {
    gracePeriodEnd = new Date(Date.now() + POLICY.grace.days * DAY_MS);
  }
  if (!failing) gracePeriodEnd = null;

  const row = {
    user_id: userId,
    provider,
    provider_customer_id: subscription.providerCustomerId || null,
    provider_subscription_id: subscription.providerSubscriptionId,
    plan_id: planId,
    status,
    // Price and interval are properties of the price row the provider is
    // charging against, so they come from there rather than from the payment.
    currency: plan?.currency ?? subscription.currency,
    billing_interval: plan?.interval ?? 'month',
    amount_cents: plan?.amountCents ?? subscription.amountCents,
    provider_price_id: subscription.providerPriceId,
    current_period_start: subscription.currentPeriodStart?.toISOString() ?? null,
    current_period_end: subscription.currentPeriodEnd?.toISOString() ?? null,
    cancel_at_period_end: cancelAtPeriodEnd,
    canceled_at: subscription.canceledAt?.toISOString() ?? null,
    trial_start: subscription.trialStart?.toISOString() ?? null,
    trial_end: subscription.trialEnd?.toISOString() ?? null,
    grace_period_end: gracePeriodEnd?.toISOString() ?? null,
    // A pause has ended when the provider reports anything but paused.
    ...(status !== 'PAUSED' ? { pause_start: null, pause_end: null } : {}),
    provider_object_updated_at: eventAt.toISOString(),
  };

  if (previous === null) {
    // No checkout row to update: the subscription was created outside the
    // normal flow. Take the country from the profile so a Canadian is not
    // recorded as American by a column default.
    const country = await billingCountry(client, userId);
    const { error } = await client.from('subscriptions').insert({ ...row, country });
    if (error !== null) {
      throw new Error(`subscriptions insert failed: ${error.code ?? 'unknown'}`);
    }
  } else {
    const { error } = await client.from('subscriptions').update(row).eq('id', previous.id);
    if (error !== null) {
      throw new Error(`subscriptions update failed: ${error.code ?? 'unknown'}`);
    }
  }

  await rememberCustomer(client, provider, userId, subscription.providerCustomerId);
  await auditTransition(client, userId, previous?.status ?? 'FREE', status);
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

  /** Payment first, so a refund or dispute arriving later can find its user. */
  const syncWithPayment = async (event: NormalizedEvent): Promise<void> => {
    await upsertPayment(client, event, provider.name);
    await upsertInvoice(client, event, provider.name);
    if (event.subscription !== undefined) {
      await sync(event);
      return;
    }
    // The event references a subscription without embedding it: re-read from
    // the provider rather than inferring.
    await syncFromProvider(client, provider, event);
  };

  return {
    SUBSCRIPTION_ACTIVATED: syncWithPayment,
    SUBSCRIPTION_UPDATED: sync,
    SUBSCRIPTION_CANCELED: sync,
    SUBSCRIPTION_PAUSED: sync,
    SUBSCRIPTION_RESUMED: sync,
    PAYMENT_SUCCEEDED: syncWithPayment,
    PAYMENT_FAILED: syncWithPayment,

    INVOICE_ISSUED: async (event) => {
      await upsertPayment(client, event, provider.name);
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

/**
 * Record a charge. Brand and last four only, exactly as the provider returned
 * them; the `payments_no_pan` check in the database refuses anything else.
 */
async function upsertPayment(
  client: SupabaseClient,
  event: NormalizedEvent,
  provider: ProviderName,
): Promise<void> {
  const payment = event.payment;
  if (payment === undefined || payment.providerPaymentId.length === 0) return;
  const userId = await resolveUserId(client, event, provider);
  if (userId === null) return;

  const { error } = await client.from('payments').upsert(
    {
      user_id: userId,
      provider,
      provider_payment_id: payment.providerPaymentId,
      amount_cents: payment.amountCents,
      currency: payment.currency,
      status: payment.status,
      failure_code: payment.failureCode,
      card_brand: payment.cardBrand,
      card_last4: payment.cardLast4,
      processed_at: payment.createdAt.toISOString(),
    },
    { onConflict: 'provider,provider_payment_id' },
  );
  if (error !== null) {
    throw new Error(`payments upsert failed: ${error.code ?? 'unknown'}`);
  }
}

/**
 * Record an invoice. Two sources feed the same row: a payment that names its
 * invoice (amounts, no number or link yet) and the provider's invoice event
 * (number, hosted link). Whichever arrives second completes the row.
 */
async function upsertInvoice(
  client: SupabaseClient,
  event: NormalizedEvent,
  provider: ProviderName,
): Promise<void> {
  const invoice = event.invoice;
  const payment = event.payment;

  const invoiceId = invoice?.providerInvoiceId ?? payment?.providerInvoiceId ?? null;
  if (invoiceId === null || invoiceId.length === 0) return;

  const userId = await resolveUserId(client, event, provider);
  if (userId === null) return;

  const paid =
    invoice !== undefined
      ? invoice.amountPaidCents
      : payment !== undefined && payment.status === 'captured'
        ? payment.amountCents
        : 0;

  const { error } = await client.from('invoices').upsert(
    {
      user_id: userId,
      provider,
      provider_invoice_id: invoiceId,
      ...(invoice?.number != null ? { number: invoice.number } : {}),
      amount_due_cents: invoice?.amountDueCents ?? payment?.amountCents ?? 0,
      amount_paid_cents: paid,
      // Under a gateway this is the operator's own tax line, if any was
      // configured. Nobody remits it on the operator's behalf.
      tax_cents: invoice?.taxCents ?? 0,
      currency: invoice?.currency ?? payment?.currency ?? 'USD',
      status: invoice?.status ?? (paid > 0 ? 'paid' : 'issued'),
      ...(invoice?.hostedUrl != null ? { hosted_invoice_url: invoice.hostedUrl } : {}),
      ...(invoice?.pdfUrl != null ? { invoice_pdf_url: invoice.pdfUrl } : {}),
      period_start: invoice?.periodStart?.toISOString() ?? null,
      period_end: invoice?.periodEnd?.toISOString() ?? null,
      issued_at: (invoice?.issuedAt ?? event.occurredAt).toISOString(),
      paid_at: paid > 0 ? (invoice?.paidAt ?? event.occurredAt).toISOString() : null,
    },
    { onConflict: 'provider,provider_invoice_id' },
  );
  if (error !== null) {
    throw new Error(`invoices upsert failed: ${error.code ?? 'unknown'}`);
  }
}

/**
 * Refunds follow the RECORDED policy, never an implicit default.
 *
 * Under a gateway the refund DECISION is ours, made in the provider dashboard
 * or through support; the provider reports it back as an event. This records
 * the refund and applies the entitlement consequence the policy prescribes.
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
