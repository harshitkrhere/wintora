/**
 * POST /api/billing/verify
 *
 * The browser's report that checkout completed.
 *
 * checkout.js hands the page a payment id, the subscription id and a signature
 * over the pair, made with our key secret. A forged report is the obvious way
 * to claim a payment that never happened, so this route:
 *
 *   1. verifies the signature in constant time, recording a security event on
 *      failure and changing nothing;
 *   2. checks the subscription belongs to the signed-in user, answering 404
 *      otherwise so that nothing about anyone else's subscription is confirmed;
 *   3. reads the subscription back from the provider and mirrors THAT, through
 *      the same sync the webhook uses. The browser's word is never the source
 *      of an entitlement; the provider's state is.
 *
 * The webhook for the same payment also arrives and is then a harmless
 * duplicate. Doing the read here means the customer is not left watching a
 * "finalising" page for as long as webhook delivery takes.
 */

import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { AppError, notFound } from '@/lib/errors';
import { handler, ok, parseBody, requireUser } from '@/lib/http/api';
import { clientIp, enforceRateLimit } from '@/lib/http/ratelimit';
import { log } from '@/lib/logging';
import { getPaymentProvider } from '@/lib/payments';
import { syncSubscription } from '@/lib/payments/handlers';
import { WebhookVerificationError } from '@/lib/payments/webhook';
import { createAdminClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  razorpay_payment_id: z.string().regex(/^pay_[A-Za-z0-9]{14}$/),
  razorpay_subscription_id: z.string().regex(/^sub_[A-Za-z0-9]{14}$/),
  razorpay_signature: z.string().regex(/^[0-9a-fA-F]{64}$/),
});

export const POST = handler('/api/billing/verify', async (request: NextRequest, context) => {
  const user = await requireUser();
  enforceRateLimit('GENERAL', { userId: user.id, ip: clientIp(request.headers) });

  const body = await parseBody(request, bodySchema);
  const provider = getPaymentProvider();
  const admin = createAdminClient();

  try {
    provider.verifyCheckoutCallback({
      providerPaymentId: body.razorpay_payment_id,
      providerSubscriptionId: body.razorpay_subscription_id,
      signature: body.razorpay_signature,
    });
  } catch (error) {
    const reason =
      error instanceof WebhookVerificationError ? error.reason : 'INVALID_SIGNATURE';
    await admin.from('security_events').insert({
      event_type: 'WEBHOOK_SIGNATURE_INVALID',
      user_id: user.id,
      severity: 'ERROR',
      request_id: context.requestId,
      detail: { reason, provider: provider.name, surface: 'checkout_callback' },
    });
    log.warn('rejected unverified checkout callback', {
      requestId: context.requestId,
      route: '/api/billing/verify',
      errorClass: reason,
    });
    throw new AppError(
      'VALIDATION_FAILED',
      'We could not verify this payment. If you were charged, contact us and we will sort it out.',
    );
  }

  // Ownership. A valid signature over someone else's subscription still gets
  // a 404, identical to a subscription that does not exist.
  const { data } = await admin
    .from('subscriptions')
    .select('id, user_id')
    .eq('provider_subscription_id', body.razorpay_subscription_id)
    .maybeSingle();

  const row = data as { id: string; user_id: string } | null;
  if (row === null || row.user_id !== user.id) {
    throw notFound(`checkout callback for a subscription not owned by ${user.id}`);
  }

  // The provider's state, not the browser's, is what gets mirrored.
  const fresh = await provider.getSubscription(body.razorpay_subscription_id);
  if (fresh === null) {
    throw new AppError('PROVIDER_ERROR', 'We could not confirm the payment yet. Please wait a moment.', {
      detail: `Razorpay has no subscription ${body.razorpay_subscription_id} after a signed callback.`,
    });
  }

  await syncSubscription(admin, provider.name, fresh, user.id, new Date());

  await admin.from('audit_logs').insert({
    user_id: user.id,
    action: 'CHECKOUT_COMPLETED',
    resource_type: 'subscription',
    outcome: 'SUCCESS',
    context: { providerStatus: fresh.status },
  });

  return ok(context, { status: fresh.status, verified: true });
});
