/**
 * POST /api/cron/reconcile-billing
 *
 * The daily sweep that keeps our subscription state honest when no webhook
 * would. Five passes, each narrow and each recorded:
 *
 *   1. Abandoned checkouts. A CHECKOUT_PENDING row older than the checkout
 *      window is closed. Nothing was paid; nothing is lost.
 *   2. Grace expiry. PAST_DUE / GRACE past its grace_period_end becomes
 *      EXPIRED and drops to Free. This is the only place premium access is
 *      withdrawn for non-payment, and it happens on the date the customer was
 *      told.
 *   3. Pause limits. A PAUSED subscription past its pause_end is resumed at the
 *      provider, as the customer was told it would be.
 *   4. Provider comparison. Each live subscription is read from the provider.
 *      On a mismatch it records and alerts; it does NOT silently pick a winner,
 *      because guessing wrong in one direction steals access from a paying
 *      customer and in the other gives away paid features. Only a pure
 *      period-date refresh is repaired automatically.
 *   5. Provider errors are counted, not treated as "subscription missing": an
 *      outage must not look like a thousand vanished subscriptions.
 *
 * Provider-agnostic: it reads through the PaymentProvider port.
 * See docs/BILLING.md section 8.
 */

import { type NextRequest } from 'next/server';
import { POLICY } from '@/config/policy';
import type { SubscriptionStatus } from '@/domain/billing/states';
import { handler, ok } from '@/lib/http/api';
import { assertCronAuthorized } from '@/lib/http/cron';
import { log } from '@/lib/logging';
import { getPaymentProvider } from '@/lib/payments';
import { syncSubscription } from '@/lib/payments/handlers';
import { createAdminClient } from '@/lib/supabase/server';
import { recomputeEntitlements } from '@/lib/supabase/stores';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BATCH_SIZE = 100;
const LIVE: readonly SubscriptionStatus[] = [
  'TRIALING',
  'ACTIVE',
  'PAST_DUE',
  'GRACE',
  'PAUSED',
  'CANCELED_PENDING_EXPIRY',
];

type Admin = ReturnType<typeof createAdminClient>;

interface Row {
  id: string;
  user_id: string;
  provider_subscription_id: string;
  status: SubscriptionStatus;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  provider_price_id: string | null;
  grace_period_end: string | null;
  pause_end: string | null;
}

export const POST = handler('/api/cron/reconcile-billing', async (request: NextRequest, context) => {
  assertCronAuthorized(request);

  const admin = createAdminClient();
  const provider = getPaymentProvider();
  const now = new Date();

  const abandoned = await closeAbandonedCheckouts(admin, now);
  const expired = await expireLapsedGrace(admin, now);
  const resumed = await resumePausedPastLimit(admin, provider, now);

  const { data: rows } = await admin
    .from('subscriptions')
    .select(
      'id, user_id, provider_subscription_id, status, current_period_start, ' +
        'current_period_end, cancel_at_period_end, provider_price_id, grace_period_end, pause_end',
    )
    .eq('provider', provider.name)
    .not('provider_subscription_id', 'is', null)
    .in('status', LIVE)
    .limit(BATCH_SIZE);

  const subscriptions = (rows ?? []) as unknown as Row[];

  let checked = 0;
  let mismatches = 0;
  let repaired = 0;
  let providerErrors = 0;

  for (const row of subscriptions) {
    checked += 1;

    let remote;
    try {
      remote = await provider.getSubscription(row.provider_subscription_id);
    } catch (error) {
      providerErrors += 1;
      log.warn('reconciliation: provider read failed', {
        route: '/api/cron/reconcile-billing',
        errorClass: error instanceof Error ? error.name : 'UnknownError',
      });
      continue;
    }

    if (remote === null) {
      // The provider has no record of a subscription we think is live. That is
      // exactly what a leaked webhook secret would produce, so it is recorded
      // rather than repaired.
      await recordMismatch(admin, row, 'PROVIDER_SUBSCRIPTION_MISSING', {
        provider: { id: row.provider_subscription_id, found: false },
        internal: { status: row.status },
      });
      mismatches += 1;
      continue;
    }

    const remotePeriodEnd = remote.currentPeriodEnd?.toISOString() ?? null;

    // A cancellation scheduled for period end is our record when the provider
    // does not expose it: the provider says "active", we say "canceled, active
    // until then", and both are right.
    const statusAgrees =
      remote.status === row.status ||
      (row.status === 'CANCELED_PENDING_EXPIRY' &&
        remote.status === 'ACTIVE' &&
        remote.cancelAtPeriodEnd !== false) ||
      // Grace is our clock on top of the provider's "past due".
      (row.status === 'GRACE' && remote.status === 'PAST_DUE');
    const planAgrees = remote.providerPriceId === row.provider_price_id;
    const periodAgrees = remotePeriodEnd === row.current_period_end;
    const cancelAgrees =
      remote.cancelAtPeriodEnd === null || remote.cancelAtPeriodEnd === row.cancel_at_period_end;

    if (statusAgrees && planAgrees && periodAgrees && cancelAgrees) continue;

    // The one safe automatic repair: everything material agrees and only the
    // period dates are stale, which is a data refresh rather than a decision.
    if (statusAgrees && planAgrees && cancelAgrees && !periodAgrees) {
      await admin
        .from('subscriptions')
        .update({
          current_period_start: remote.currentPeriodStart?.toISOString() ?? null,
          current_period_end: remotePeriodEnd,
        })
        .eq('id', row.id);

      await recomputeEntitlements(admin, row.user_id);
      repaired += 1;
      continue;
    }

    await recordMismatch(admin, row, 'BILLING_STATE_MISMATCH', {
      provider: {
        status: remote.status,
        priceId: remote.providerPriceId,
        periodEnd: remotePeriodEnd,
        cancelAtPeriodEnd: remote.cancelAtPeriodEnd,
      },
      internal: {
        status: row.status,
        priceId: row.provider_price_id,
        periodEnd: row.current_period_end,
        cancelAtPeriodEnd: row.cancel_at_period_end,
      },
    });
    mismatches += 1;
  }

  const summary = { checked, mismatches, repaired, providerErrors, abandoned, expired, resumed };
  log.info('billing reconciliation complete', { route: '/api/cron/reconcile-billing', ...summary });

  return ok(context, { provider: provider.name, ...summary });
});

/** Pass 1: a checkout nobody finished. */
async function closeAbandonedCheckouts(admin: Admin, now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - POLICY.checkout.pendingTtlMinutes * 60 * 1000);
  const { data } = await admin
    .from('subscriptions')
    .update({ status: 'EXPIRED' })
    .eq('status', 'CHECKOUT_PENDING')
    .lt('created_at', cutoff.toISOString())
    .select('id');
  return (data ?? []).length;
}

/** Pass 2: the grace period the customer was told about has ended. */
async function expireLapsedGrace(admin: Admin, now: Date): Promise<number> {
  const { data } = await admin
    .from('subscriptions')
    .select('id, user_id')
    .in('status', ['PAST_DUE', 'GRACE'])
    .not('grace_period_end', 'is', null)
    .lt('grace_period_end', now.toISOString())
    .limit(BATCH_SIZE);

  const rows = (data ?? []) as { id: string; user_id: string }[];
  for (const row of rows) {
    await admin.from('subscriptions').update({ status: 'EXPIRED' }).eq('id', row.id);
    await admin.from('audit_logs').insert({
      user_id: row.user_id,
      action: 'SUBSCRIPTION_STATUS_CHANGED',
      resource_type: 'subscription',
      outcome: 'SUCCESS',
      context: { from: 'GRACE', to: 'EXPIRED', reason: 'GRACE_EXPIRED' },
    });
    await recomputeEntitlements(admin, row.user_id);
  }
  return rows.length;
}

/** Pass 3: a pause has run to the maximum the customer was told about. */
async function resumePausedPastLimit(
  admin: Admin,
  provider: ReturnType<typeof getPaymentProvider>,
  now: Date,
): Promise<number> {
  if (!provider.capabilities.pause) return 0;

  const { data } = await admin
    .from('subscriptions')
    .select('id, user_id, provider_subscription_id')
    .eq('status', 'PAUSED')
    .not('pause_end', 'is', null)
    .lt('pause_end', now.toISOString())
    .limit(BATCH_SIZE);

  const rows = (data ?? []) as { id: string; user_id: string; provider_subscription_id: string | null }[];
  let resumed = 0;
  for (const row of rows) {
    if (row.provider_subscription_id === null) continue;
    try {
      const fresh = await provider.resume(row.provider_subscription_id);
      await syncSubscription(admin, provider.name, fresh, row.user_id, now);
      resumed += 1;
    } catch (error) {
      log.warn('reconciliation: automatic resume failed', {
        route: '/api/cron/reconcile-billing',
        errorClass: error instanceof Error ? error.name : 'UnknownError',
      });
    }
  }
  return resumed;
}

async function recordMismatch(
  admin: Admin,
  row: { id: string; user_id: string },
  mismatchType: string,
  detail: { provider: Record<string, unknown>; internal: Record<string, unknown> },
): Promise<void> {
  await admin.from('billing_reconciliations').insert({
    user_id: row.user_id,
    subscription_id: row.id,
    mismatch_type: mismatchType,
    provider_state: detail.provider,
    internal_state: detail.internal,
  });

  await admin.from('security_events').insert({
    event_type: 'BILLING_STATE_MISMATCH',
    user_id: row.user_id,
    severity: 'ERROR',
    detail: { mismatchType },
  });
}
