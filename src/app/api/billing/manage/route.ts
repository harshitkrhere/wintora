/**
 * POST /api/billing/manage
 *
 * Self-service subscription management: cancel at period end, pause, resume,
 * and start a card update. Razorpay has no hosted customer portal, so these
 * are ours, and they are one click each. Cancellation in particular is never
 * routed through a support conversation; that is a consumer-law point as much
 * as a courtesy.
 *
 * Every action:
 *   1. finds the signed-in user's own live subscription (never one by id from
 *      the client);
 *   2. asks the provider to make the change;
 *   3. mirrors the provider's returned state through the same sync the
 *      webhook uses, so the page reflects the change immediately and the
 *      webhook that follows is a harmless duplicate.
 */

import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { POLICY } from '@/config/policy';
import type { SubscriptionStatus } from '@/domain/billing/states';
import { AppError } from '@/lib/errors';
import { handler, ok, parseBody, requireUser } from '@/lib/http/api';
import { clientIp, enforceRateLimit } from '@/lib/http/ratelimit';
import { createAdminClient } from '@/lib/supabase/server';
import { getPaymentProvider, razorpayKeyId } from '@/lib/payments';
import { syncSubscription } from '@/lib/payments/handlers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ACTIONS = ['cancel', 'pause', 'resume', 'card'] as const;

const bodySchema = z.object({
  action: z.enum(ACTIONS),
});

interface LiveRow {
  id: string;
  status: SubscriptionStatus;
  provider_subscription_id: string | null;
  cancel_at_period_end: boolean;
  current_period_end: string | null;
}

export const POST = handler('/api/billing/manage', async (request: NextRequest, context) => {
  const user = await requireUser();
  enforceRateLimit('GENERAL', { userId: user.id, ip: clientIp(request.headers) });

  const { action } = await parseBody(request, bodySchema);
  const admin = createAdminClient();
  const provider = getPaymentProvider();

  const { data } = await admin
    .from('subscriptions')
    .select('id, status, provider_subscription_id, cancel_at_period_end, current_period_end')
    .eq('user_id', user.id)
    .in('status', ['TRIALING', 'ACTIVE', 'PAST_DUE', 'GRACE', 'PAUSED', 'CANCELED_PENDING_EXPIRY'])
    .maybeSingle();

  const live = data as unknown as LiveRow | null;
  if (live === null || live.provider_subscription_id === null) {
    throw new AppError('NOT_FOUND', 'You do not have an active subscription to manage.');
  }
  const subscriptionId = live.provider_subscription_id;
  const now = new Date();

  switch (action) {
    case 'cancel': {
      if (live.status === 'CANCELED_PENDING_EXPIRY' || live.cancel_at_period_end) {
        throw new AppError('CONFLICT', 'Your subscription is already set to end at the close of this period.');
      }
      if (live.status === 'PAUSED') {
        throw new AppError('CONFLICT', 'Resume your subscription first, then cancel it.');
      }
      const updated = await provider.cancelAtPeriodEnd(subscriptionId);
      await syncSubscription(admin, provider.name, updated, user.id, now);
      await admin
        .from('subscriptions')
        .update({ canceled_at: now.toISOString() })
        .eq('id', live.id);
      await audit(admin, user.id, 'SUBSCRIPTION_CANCEL_SCHEDULED', {
        effectiveAt: live.current_period_end,
      });
      return ok(context, {
        action,
        message:
          'Your subscription will end at the close of the current period. Until then nothing changes, and your cases and documents stay in your account afterwards.',
      });
    }

    case 'pause': {
      if (!POLICY.pause.enabled || !provider.capabilities.pause) {
        throw new AppError('BILLING_ERROR', 'Pausing is not available.');
      }
      if (live.status !== 'ACTIVE' || live.cancel_at_period_end) {
        throw new AppError(
          'CONFLICT',
          'Only an active subscription that is not already ending can be paused.',
        );
      }
      const updated = await provider.pause(subscriptionId);
      await syncSubscription(admin, provider.name, updated, user.id, now);
      const pauseEnd = new Date(now.getTime() + POLICY.pause.maxDays * 24 * 60 * 60 * 1000);
      await admin
        .from('subscriptions')
        .update({ pause_start: now.toISOString(), pause_end: pauseEnd.toISOString() })
        .eq('id', live.id);
      await audit(admin, user.id, 'SUBSCRIPTION_PAUSED', { pauseEnd: pauseEnd.toISOString() });
      return ok(context, {
        action,
        message: `Your subscription is paused. You will not be charged while it is paused, your account is on the Free plan meanwhile, and it resumes automatically after ${POLICY.pause.maxDays} days unless you resume it sooner.`,
      });
    }

    case 'resume': {
      if (live.status !== 'PAUSED') {
        throw new AppError('CONFLICT', 'Your subscription is not paused.');
      }
      const updated = await provider.resume(subscriptionId);
      await syncSubscription(admin, provider.name, updated, user.id, now);
      await audit(admin, user.id, 'SUBSCRIPTION_RESUMED', {});
      return ok(context, {
        action,
        message: 'Your subscription is active again. Your paid features are back on.',
      });
    }

    case 'card': {
      // No provider call: the browser opens the provider's own form against
      // this subscription. The public key id is all it needs, and the card
      // details go to the provider, never through us.
      return ok(context, {
        action,
        keyId: razorpayKeyId(),
        subscriptionId,
        message: 'Update your card in the secure form.',
      });
    }
  }
});

async function audit(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  action: string,
  detail: Record<string, unknown>,
): Promise<void> {
  await admin.from('audit_logs').insert({
    user_id: userId,
    action,
    resource_type: 'subscription',
    outcome: 'SUCCESS',
    context: detail,
  });
}
