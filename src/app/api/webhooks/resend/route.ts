/**
 * POST /api/webhooks/resend
 *
 * Delivery events for the emails the product sent: sent, delivered, delayed,
 * bounced, complained. Each updates the message's row in email_log, so the
 * log says what actually happened to a message rather than only that it
 * left. A bounce or a complaint also stops further messages to that account
 * for ninety days (see notifyAccount).
 *
 * Fails closed: no secret, or a bad signature, is a 401 and nothing is
 * written. Opens and clicks are not subscribed to and are ignored if they
 * arrive, because they need a pixel and rewritten links this product does
 * not put in its mail.
 *
 * Not wrapped in the same-origin handler: a webhook has no browser origin.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { serverEnv } from '@/lib/env';
import { log, newRequestId } from '@/lib/logging';
import { createAdminClient } from '@/lib/supabase/server';
import { recordDeliveryEvent } from '@/lib/email/account';
import { parseResendEvent, verifyResendSignature } from '@/lib/email/resend-webhook';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest): Promise<NextResponse> {
  const requestId = newRequestId();
  const secret = serverEnv().RESEND_WEBHOOK_SECRET;
  if (secret === undefined) {
    log.warn('resend webhook received with no secret configured', { requestId, route: '/api/webhooks/resend' });
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 401 });
  }

  const body = await request.text();
  const verdict = verifyResendSignature({
    secret,
    body,
    headers: {
      id: request.headers.get('svix-id'),
      timestamp: request.headers.get('svix-timestamp'),
      signature: request.headers.get('svix-signature'),
    },
  });
  if (!verdict.ok) {
    log.warn('resend webhook rejected', { requestId, route: '/api/webhooks/resend', errorClass: verdict.reason });
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  const event = parseResendEvent(body);
  if (event === null) {
    return NextResponse.json({ error: 'Unreadable event' }, { status: 400 });
  }
  if (event.emailId === null) {
    return NextResponse.json({ received: true, applied: 'ignored' });
  }

  const applied = await recordDeliveryEvent(createAdminClient(), {
    providerMessageId: event.emailId,
    type: event.type,
    at: event.createdAt,
  });

  log.info('resend event', { requestId, route: '/api/webhooks/resend', type: event.type, applied });
  return NextResponse.json({ received: true, applied }, { headers: { 'x-request-id': requestId } });
}
