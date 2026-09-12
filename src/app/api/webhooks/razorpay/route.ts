/**
 * POST /api/webhooks/razorpay
 *
 * The only inbound path that changes subscription state.
 *
 * Runs on the Node runtime and reads the RAW body. Signature verification comes
 * before any parsing, and the idempotency claim comes before any business state
 * change. An invalid signature returns 400, records a security event, and
 * changes nothing.
 *
 * Razorpay signs the raw body with the webhook secret (X-Razorpay-Signature)
 * and identifies each event with X-Razorpay-Event-Id, which is what makes a
 * redelivery a no-op. It retries a non-2xx response with backoff for about a
 * day, so a handler failure returns 500 on purpose.
 *
 * See docs/BILLING.md section 5 and docs/THREAT_MODEL.md T5.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { serverEnv } from '@/lib/env';
import { log, newRequestId } from '@/lib/logging';
import { createAdminClient } from '@/lib/supabase/server';
import { getPaymentProvider } from '@/lib/payments';
import { createHandlers, createWebhookStore } from '@/lib/payments/handlers';
import { WebhookVerificationError, hashPayload, processWebhookEvent } from '@/lib/payments/webhook';

// Signature verification needs the unmodified bytes and Node crypto. Neither
// works on the edge runtime.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ROUTE = '/api/webhooks/razorpay';

export async function POST(request: NextRequest): Promise<NextResponse> {
  const requestId = newRequestId();
  const startedAt = Date.now();

  // 1. Raw bytes. Never JSON.parse first: re-serialising breaks the signature.
  const rawBody = await request.text();

  // An unconfigured provider is a deployment fault, not a bad request. 503
  // tells Razorpay to retry later, which is exactly right: once the keys are
  // in place the redelivery is processed normally.
  let provider;
  try {
    provider = getPaymentProvider();
  } catch (error) {
    log.error('webhook received but payments are not configured', {
      requestId,
      route: ROUTE,
      errorClass: error instanceof Error ? error.name : 'UnknownError',
    });
    return NextResponse.json({ error: 'Payments are not configured' }, { status: 503 });
  }
  const admin = createAdminClient();

  // 2. Verify, then translate into our normalised event shape.
  let event;
  try {
    event = provider.verifyAndParseWebhook(
      rawBody,
      request.headers,
      serverEnv().RAZORPAY_WEBHOOK_SECRET,
    );
  } catch (error) {
    const reason =
      error instanceof WebhookVerificationError ? error.reason : 'INVALID_SIGNATURE';

    await admin.from('security_events').insert({
      event_type: 'WEBHOOK_SIGNATURE_INVALID',
      severity: 'ERROR',
      request_id: requestId,
      detail: {
        reason,
        provider: provider.name,
        hasSignature: request.headers.get('x-razorpay-signature') !== null,
        hasEventId: request.headers.get('x-razorpay-event-id') !== null,
      },
    });

    log.warn('rejected unverified webhook', { requestId, route: ROUTE, errorClass: reason });

    // 400, and nothing else happened.
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  // 3-5. Claim, order, dispatch.
  const result = await processWebhookEvent(
    provider.name,
    createWebhookStore(admin),
    createHandlers(admin, provider),
    event,
    hashPayload(rawBody),
  );

  log.info('webhook processed', {
    requestId,
    route: ROUTE,
    eventType: result.eventType,
    outcome: result.outcome,
    latencyMs: Date.now() - startedAt,
    errorClass: result.errorClass,
  });

  // A handler failure returns 500 so Razorpay retries. The idempotency claim
  // in step 3 is what makes that retry safe.
  if (result.outcome === 'FAILED') {
    return NextResponse.json({ received: true, outcome: result.outcome }, { status: 500 });
  }

  return NextResponse.json({ received: true, outcome: result.outcome }, { status: 200 });
}
