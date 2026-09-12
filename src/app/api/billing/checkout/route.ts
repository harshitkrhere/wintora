/**
 * POST /api/billing/checkout
 *
 * Starts a checkout for a plan, or changes an existing subscription's plan.
 *
 * The client sends a plan SLUG and a billing INTERVAL and nothing else. The
 * provider plan id, amount and currency are resolved server-side from
 * `plan_prices` for the user's billing country, so a tampered request cannot
 * buy Pro at the Essential price, or a year at the monthly price.
 *
 * A new checkout creates the provider-side subscription HERE and records it as
 * CHECKOUT_PENDING before the browser ever sees it. The checkout page then
 * opens exactly that subscription for exactly this user. Clicking again inside
 * the checkout window reuses it; clicking after the window has passed abandons
 * it and starts a fresh one. That is what makes a double click, a refresh or a
 * back button harmless.
 *
 * Nothing here grants an entitlement. Grants happen when the verified payment
 * callback or the signed webhook reads the subscription back from the provider.
 */

import { type NextRequest } from 'next/server';
import { z } from 'zod';
import {
  BILLING_INTERVALS,
  PLAN_SLUGS,
  compareOffers,
  requiresCheckout,
  type BillingInterval,
  type PlanSlug,
} from '@/config/plans';
import { POLICY } from '@/config/policy';
import { downgradeStrategy } from '@/domain/billing/provider';
import type { SubscriptionStatus } from '@/domain/billing/states';
import { AppError } from '@/lib/errors';
import { handler, ok, parseBody, requireUser } from '@/lib/http/api';
import { clientIp, enforceRateLimit } from '@/lib/http/ratelimit';
import { log } from '@/lib/logging';
import { createAdminClient } from '@/lib/supabase/server';
import {
  billingCountry,
  ensureCustomer,
  getPaymentProvider,
  resolvePriceId,
} from '@/lib/payments';
import { syncSubscription } from '@/lib/payments/handlers';
import { SELLER_OF_RECORD } from '@/config/disclosures';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  planSlug: z.enum(PLAN_SLUGS),
  /** Monthly unless the customer chose annual on the pricing page. */
  interval: z.enum(BILLING_INTERVALS).default('month'),
  /**
   * Distinguishes a genuine second purchase from a retry of the first. The
   * client sends the same value when it retries; it is recorded with the
   * provider-side subscription for the audit trail.
   */
  attemptKey: z.string().min(8).max(64),
});

const UNIQUE_VIOLATION = '23505';

interface LiveRow {
  id: string;
  status: SubscriptionStatus;
  provider_subscription_id: string | null;
  billing_interval: BillingInterval;
  cancel_at_period_end: boolean;
  created_at: string;
  current_period_end: string | null;
  plans: { slug: PlanSlug };
}

export const POST = handler('/api/billing/checkout', async (request: NextRequest, context) => {
  const user = await requireUser();
  enforceRateLimit('GENERAL', { userId: user.id, ip: clientIp(request.headers) });

  const { planSlug, interval, attemptKey } = await parseBody(request, bodySchema);

  if (!requiresCheckout(planSlug)) {
    throw new AppError('VALIDATION_FAILED', 'The Free plan does not require checkout.');
  }

  const admin = createAdminClient();
  const provider = getPaymentProvider();

  const country = await billingCountry(admin, user.id);
  const price = await resolvePriceId(admin, planSlug, country, interval);

  // The user's single live subscription, if any. The partial unique index
  // `subscriptions_one_live_per_user` guarantees there is at most one.
  const { data: existing } = await admin
    .from('subscriptions')
    .select(
      'id, status, provider_subscription_id, billing_interval, cancel_at_period_end, ' +
        'created_at, current_period_end, plans!subscriptions_plan_id_fkey(slug)',
    )
    .eq('user_id', user.id)
    .in('status', [
      'CHECKOUT_PENDING',
      'INCOMPLETE',
      'TRIALING',
      'ACTIVE',
      'PAST_DUE',
      'GRACE',
      'PAUSED',
      'CANCELED_PENDING_EXPIRY',
    ])
    .maybeSingle();

  const live = existing as unknown as LiveRow | null;

  // ---- An entitled subscription: this is a plan CHANGE, not a purchase. ----
  if (
    live !== null &&
    live.provider_subscription_id !== null &&
    ['TRIALING', 'ACTIVE', 'PAST_DUE', 'GRACE', 'CANCELED_PENDING_EXPIRY'].includes(live.status)
  ) {
    if (live.status === 'PAST_DUE' || live.status === 'GRACE') {
      throw new AppError(
        'BILLING_ERROR',
        'Your last renewal payment did not go through. Update your payment method first, then change plan.',
      );
    }
    if (live.status === 'CANCELED_PENDING_EXPIRY' || live.cancel_at_period_end) {
      throw new AppError(
        'BILLING_ERROR',
        'Your subscription is set to end at the close of this period. You can choose a new plan once it has ended.',
      );
    }

    // Same plan at a longer interval is an upgrade; back to monthly waits for
    // the period end like any other downgrade.
    const direction = compareOffers(
      { slug: live.plans.slug, interval: live.billing_interval },
      { slug: planSlug, interval },
    );

    if (direction === 0) {
      throw new AppError('CONFLICT', 'You are already on that plan.');
    }

    const isUpgrade = direction === 1;

    const change = await provider.changePlan({
      providerSubscriptionId: live.provider_subscription_id,
      newProviderPriceId: price.priceId,
      newInterval: interval,
      isUpgrade,
    });

    if (isUpgrade) {
      // The provider applied the change and prorated it. Mirror the returned
      // state now rather than waiting for the webhook, which also arrives and
      // is then a harmless duplicate.
      if (change.subscription !== null) {
        await syncSubscription(admin, provider.name, change.subscription, user.id, new Date());
      }
    } else {
      // Recorded on our side so the subscription page can state the exact
      // date, whichever side is holding the schedule.
      await admin
        .from('subscriptions')
        .update({
          pending_plan_id: price.planId,
          pending_plan_effective_at:
            change.effectiveAt?.toISOString() ?? live.current_period_end ?? null,
        })
        .eq('id', live.id);
    }

    return ok(context, {
      kind: isUpgrade ? 'UPGRADED' : 'DOWNGRADE_SCHEDULED',
      planSlug,
      interval,
      effectiveAt: change.effectiveAt?.toISOString() ?? null,
      downgradeHandledBy: downgradeStrategy(provider),
      message: isUpgrade
        ? 'Your new plan is active. The difference for the rest of this period has been charged.'
        : 'Your plan change is scheduled for the end of your current billing period. Nothing changes until then.',
    });
  }

  if (live !== null && live.status === 'PAUSED') {
    throw new AppError(
      'BILLING_ERROR',
      'Your subscription is paused. Resume it from your subscription page, then change plan.',
    );
  }

  // ---- A checkout already in progress. ----
  const ttlMs = POLICY.checkout.pendingTtlMinutes * 60 * 1000;

  if (live !== null && live.status === 'CHECKOUT_PENDING' && live.provider_subscription_id !== null) {
    const fresh = Date.now() - new Date(live.created_at).getTime() < ttlMs;
    const sameOffer = live.plans.slug === planSlug && live.billing_interval === interval;

    if (fresh && sameOffer) {
      return ok(context, { kind: 'CHECKOUT', url: '/checkout', sellerOfRecord: SELLER_OF_RECORD });
    }

    // A different plan, or a stale session: abandon it and start again. The
    // provider-side object expires on its own if the cancel is refused.
    try {
      await provider.cancelImmediately(live.provider_subscription_id);
    } catch (error) {
      log.info('pending checkout could not be cancelled at provider; it will expire', {
        route: '/api/billing/checkout',
        errorClass: error instanceof Error ? error.name : 'UnknownError',
      });
    }
    await admin.from('subscriptions').update({ status: 'EXPIRED' }).eq('id', live.id);
  }

  // ---- A new checkout. ----
  const customerId = await ensureCustomer(admin, provider, user);
  const expiresAt = new Date(Date.now() + ttlMs);

  const checkout = await provider.createCheckout({
    userId: user.id,
    email: user.email,
    planSlug,
    interval,
    country,
    providerPriceId: price.priceId,
    providerCustomerId: customerId,
    attemptKey,
    amountCents: price.amountCents,
    currency: price.currency,
    expiresAt,
  });

  const { error } = await admin.from('subscriptions').insert({
    user_id: user.id,
    provider: provider.name,
    provider_customer_id: customerId,
    provider_subscription_id: checkout.providerSubscriptionId,
    plan_id: price.planId,
    status: 'CHECKOUT_PENDING',
    country,
    currency: price.currency,
    billing_interval: interval,
    amount_cents: price.amountCents,
    provider_price_id: price.priceId,
    provider_object_updated_at: new Date().toISOString(),
  });

  if (error !== null) {
    if (error.code === UNIQUE_VIOLATION) {
      // Two clicks raced. The other one won and its checkout is the one to
      // open; the subscription created here expires unpaid.
      return ok(context, { kind: 'CHECKOUT', url: '/checkout', sellerOfRecord: SELLER_OF_RECORD });
    }
    throw new AppError('BILLING_ERROR', 'We could not start checkout. Please try again.', {
      detail: `subscriptions insert failed: ${error.code ?? 'unknown'}`,
    });
  }

  await admin.from('audit_logs').insert({
    user_id: user.id,
    action: 'CHECKOUT_STARTED',
    resource_type: 'subscription',
    outcome: 'SUCCESS',
    context: { planSlug, interval, country, attemptKey },
  });

  return ok(context, {
    kind: 'CHECKOUT',
    url: '/checkout',
    // Consumer-law disclosure: the customer must know who they are contracting
    // with and who will appear on their statement, before they pay.
    sellerOfRecord: SELLER_OF_RECORD,
  });
});
