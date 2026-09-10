/**
 * POST /api/billing/checkout
 *
 * Starts a checkout for a plan, or changes an existing subscription's plan.
 *
 * The client sends a plan SLUG and nothing else. The price id, amount and
 * currency are resolved server-side from `plan_prices` for the user's billing
 * country, so a tampered request cannot buy Pro at the Essential price.
 *
 * Note the seller: with a Merchant of Record the customer's contract is with
 * the provider, not with us. The response carries `sellerOfRecord` so the UI
 * can say so before the customer pays. See docs/BILLING.md.
 */

import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { PLAN_SLUGS, comparePlans, requiresCheckout, type PlanSlug } from '@/config/plans';
import { downgradeStrategy } from '@/domain/billing/provider';
import { publicEnv } from '@/lib/env';
import { AppError } from '@/lib/errors';
import { handler, ok, parseBody, requireUser } from '@/lib/http/api';
import { clientIp, enforceRateLimit } from '@/lib/http/ratelimit';
import { createAdminClient } from '@/lib/supabase/server';
import { ensureCustomer, getPaymentProvider, resolvePriceId } from '@/lib/payments';
import { SELLER_OF_RECORD } from '@/config/disclosures';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  planSlug: z.enum(PLAN_SLUGS),
  /**
   * Distinguishes a genuine second purchase from a retry of the first. The
   * client sends the same value when it retries.
   */
  attemptKey: z.string().min(8).max(64),
});

export const POST = handler('/api/billing/checkout', async (request: NextRequest, context) => {
  const user = await requireUser();
  enforceRateLimit('GENERAL', { userId: user.id, ip: clientIp(request.headers) });

  const { planSlug, attemptKey } = await parseBody(request, bodySchema);

  if (!requiresCheckout(planSlug)) {
    throw new AppError('VALIDATION_FAILED', 'The Free plan does not require checkout.');
  }

  const admin = createAdminClient();
  const provider = getPaymentProvider();

  const { data: profile } = await admin
    .from('profiles')
    .select('country')
    .eq('id', user.id)
    .maybeSingle();

  const country = ((profile?.country as string | undefined) ?? 'US') as 'US' | 'CA';
  const { priceId } = await resolvePriceId(admin, planSlug, country);

  // An existing live subscription is a plan CHANGE, not a new checkout.
  const { data: existing } = await admin
    .from('subscriptions')
    .select('id, provider_subscription_id, status, plans!subscriptions_plan_id_fkey(slug)')
    .eq('user_id', user.id)
    .in('status', ['ACTIVE', 'TRIALING', 'PAST_DUE', 'GRACE', 'CANCELED_PENDING_EXPIRY'])
    .maybeSingle();

  const live = existing as unknown as
    | { id: string; provider_subscription_id: string | null; plans: { slug: PlanSlug } }
    | null;

  if (live !== null && live.provider_subscription_id !== null) {
    const direction = comparePlans(live.plans.slug, planSlug);

    if (direction === 0) {
      throw new AppError('CONFLICT', 'You are already on that plan.');
    }

    const isUpgrade = direction === 1;

    const change = await provider.changePlan({
      providerSubscriptionId: live.provider_subscription_id,
      newProviderPriceId: priceId,
      isUpgrade,
    });

    // If the provider cannot defer the change itself, we hold it and apply it
    // at period end, so paid access is never revoked early either way.
    if (!isUpgrade) {
      const { data: target } = await admin
        .from('plans')
        .select('id')
        .eq('slug', planSlug)
        .eq('version', 1)
        .maybeSingle();

      const { data: current } = await admin
        .from('subscriptions')
        .select('current_period_end')
        .eq('id', live.id)
        .maybeSingle();

      const effectiveAt =
        change.effectiveAt?.toISOString() ??
        (current?.current_period_end as string | null) ??
        null;

      await admin
        .from('subscriptions')
        .update({
          pending_plan_id: (target as { id: string } | null)?.id ?? null,
          pending_plan_effective_at: effectiveAt,
        })
        .eq('id', live.id);
    }

    // Entitlements change on the verified webhook, not here.
    return ok(context, {
      kind: isUpgrade ? 'UPGRADED' : 'DOWNGRADE_SCHEDULED',
      planSlug,
      effectiveAt: change.effectiveAt?.toISOString() ?? null,
      downgradeHandledBy: downgradeStrategy(provider),
      message: isUpgrade
        ? 'Your new plan is being activated. This usually takes a few seconds.'
        : 'Your plan change is scheduled for the end of your current billing period. Nothing changes until then.',
    });
  }

  const customerId = await ensureCustomer(admin, provider, user);
  const appUrl = publicEnv().NEXT_PUBLIC_APP_URL;

  const checkout = await provider.createCheckout({
    userId: user.id,
    email: user.email,
    planSlug,
    country,
    providerPriceId: priceId,
    providerCustomerId: customerId,
    attemptKey,
    checkoutUrl: `${appUrl}/checkout`,
    successUrl: `${appUrl}/billing/success`,
    cancelUrl: `${appUrl}/pricing?checkout=canceled`,
  });

  return ok(context, {
    kind: 'CHECKOUT',
    url: checkout.url,
    sessionId: checkout.sessionId,
    // Consumer-law disclosure: the customer must know who they are contracting
    // with and who will appear on their statement, before they pay.
    sellerOfRecord: SELLER_OF_RECORD,
  });
});
