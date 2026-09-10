/**
 * POST /api/cron/reconcile-billing
 *
 * Compares the provider's subscription state against ours.
 *
 * On a mismatch it records and alerts. It does NOT silently pick a winner:
 * guessing wrong in one direction steals access from a paying customer, and in
 * the other gives away paid features. Only the narrow case the policy marks
 * safe — a pure period-data refresh where status and plan already agree — is
 * repaired automatically.
 *
 * Provider-agnostic: it reads through the PaymentProvider port.
 * See docs/BILLING.md section 8.
 */

import { type NextRequest } from 'next/server';
import type { SubscriptionStatus } from '@/domain/billing/states';
import { handler, ok } from '@/lib/http/api';
import { assertCronAuthorized } from '@/lib/http/cron';
import { log } from '@/lib/logging';
import { getPaymentProvider } from '@/lib/payments';
import { createAdminClient } from '@/lib/supabase/server';
import { recomputeEntitlements } from '@/lib/supabase/stores';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BATCH_SIZE = 100;

export const POST = handler('/api/cron/reconcile-billing', async (request: NextRequest, context) => {
  assertCronAuthorized(request);

  const admin = createAdminClient();
  const provider = getPaymentProvider();

  const { data: rows } = await admin
    .from('subscriptions')
    .select(
      'id, user_id, provider_subscription_id, status, current_period_start, ' +
        'current_period_end, cancel_at_period_end, provider_price_id',
    )
    .eq('provider', provider.name)
    .not('provider_subscription_id', 'is', null)
    .in('status', [
      'TRIALING',
      'ACTIVE',
      'PAST_DUE',
      'GRACE',
      'PAUSED',
      'CANCELED_PENDING_EXPIRY',
    ])
    .limit(BATCH_SIZE);

  const subscriptions = (rows ?? []) as unknown as {
    id: string;
    user_id: string;
    provider_subscription_id: string;
    status: SubscriptionStatus;
    current_period_start: string | null;
    current_period_end: string | null;
    cancel_at_period_end: boolean;
    provider_price_id: string | null;
  }[];

  let checked = 0;
  let mismatches = 0;
  let repaired = 0;

  for (const row of subscriptions) {
    checked += 1;

    const remote = await provider.getSubscription(row.provider_subscription_id);

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

    const statusAgrees = remote.status === row.status;
    const planAgrees = remote.providerPriceId === row.provider_price_id;
    const periodAgrees = remotePeriodEnd === row.current_period_end;
    const cancelAgrees = remote.cancelAtPeriodEnd === row.cancel_at_period_end;

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

  log.info('billing reconciliation complete', {
    route: '/api/cron/reconcile-billing',
    checked,
    mismatches,
    repaired,
  });

  return ok(context, { provider: provider.name, checked, mismatches, repaired });
});

async function recordMismatch(
  admin: ReturnType<typeof createAdminClient>,
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
