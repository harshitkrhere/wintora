/**
 * Send one message to an account holder, at most once per key.
 *
 * Every email the product sends is triggered by something that can happen
 * twice: a webhook redelivered, a cron re-run, a page refreshed. The `jobs`
 * table's unique idempotency key is the guard: the row is claimed before the
 * send, so a second trigger with the same key finds it and stops. When no
 * provider is configured the row is still written (QUEUED), so the record of
 * what should have gone out exists and can be sent later.
 *
 * Never throws. An email that fails to send is logged and must not fail the
 * webhook, request or cron that triggered it.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { EmailMessage } from '@/domain/email/messages';
import { getEmailSender } from '@/lib/email';
import { log } from '@/lib/logging';

export type NotifyOutcome = 'sent' | 'queued' | 'duplicate' | 'no_address' | 'failed';

export async function notifyAccount(
  admin: SupabaseClient,
  input: { userId: string; key: string; kind: string; message: EmailMessage },
): Promise<NotifyOutcome> {
  const now = new Date().toISOString();

  // Claim the key. A unique violation means this message already went (or is
  // queued), which is the point.
  const { error: claimError } = await admin.from('jobs').insert({
    job_type: `EMAIL_${input.kind}`,
    user_id: input.userId,
    payload: { subject: input.message.subject },
    idempotency_key: input.key,
    status: 'QUEUED',
  });
  if (claimError !== null) {
    if (claimError.code === '23505') return 'duplicate';
    log.warn('email claim failed', { route: 'email.notifyAccount', errorClass: claimError.code ?? 'unknown' });
    return 'failed';
  }

  const sender = getEmailSender();
  if (sender === null) return 'queued';

  const { data } = await admin.auth.admin.getUserById(input.userId);
  const to = data?.user?.email ?? null;
  if (to === null) {
    await admin.from('jobs').update({ status: 'DEAD', error_class: 'NO_ADDRESS' }).eq('idempotency_key', input.key);
    return 'no_address';
  }

  try {
    await sender.send({ to, subject: input.message.subject, text: input.message.text });
    await admin
      .from('jobs')
      .update({ status: 'SUCCEEDED', completed_at: now, started_at: now, attempts: 1 })
      .eq('idempotency_key', input.key);
    return 'sent';
  } catch (error) {
    log.warn('email not sent', {
      route: 'email.notifyAccount',
      errorClass: error instanceof Error ? error.name : 'UnknownError',
    });
    // Left QUEUED with an attempt recorded, so a later sweep can retry it.
    await admin.from('jobs').update({ attempts: 1, error_class: 'SEND_FAILED' }).eq('idempotency_key', input.key);
    return 'failed';
  }
}
