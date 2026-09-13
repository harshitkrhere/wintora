/**
 * Send one message to an account holder, at most once per key, and log it.
 *
 * Every email the product sends is triggered by something that can happen
 * twice: a webhook redelivered, a cron re-run, a page refreshed. The
 * `email_log` table's unique idempotency key is the guard: the row is
 * claimed before the send, so a second trigger with the same key finds it
 * and stops. The row then carries what happened: queued (no provider), sent
 * (with the provider's message id), delivered / bounced / complained (from
 * the provider's webhook), or failed (to be retried by the cron).
 *
 * An address that bounced or complained in the last 90 days is not written
 * to again. The message is still logged, as SUPPRESSED, so the record says
 * why nothing arrived.
 *
 * Never throws. An email that fails to send is logged and must not fail the
 * webhook, request or cron that triggered it.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { EmailMessage } from '@/domain/email/messages';
import { getEmailSender } from '@/lib/email';
import { log } from '@/lib/logging';

export type NotifyOutcome = 'sent' | 'queued' | 'duplicate' | 'suppressed' | 'no_address' | 'failed';

const SUPPRESS_DAYS = 90;
const MAX_ATTEMPTS = 3;

export const EMAIL_LOG_COLUMNS =
  'id, user_id, kind, idempotency_key, subject, body, provider, provider_message_id, status, ' +
  'error_class, attempts, events, created_at, sent_at, last_event_at';

export interface EmailLogRow {
  readonly id: string;
  readonly user_id: string;
  readonly kind: string;
  readonly idempotency_key: string;
  readonly subject: string;
  readonly body: string;
  readonly provider: string;
  readonly provider_message_id: string | null;
  readonly status: string;
  readonly error_class: string | null;
  readonly attempts: number;
  readonly events: { type: string; at: string }[];
  readonly created_at: string;
  readonly sent_at: string | null;
  readonly last_event_at: string | null;
}

async function isSuppressed(admin: SupabaseClient, userId: string): Promise<boolean> {
  const since = new Date(Date.now() - SUPPRESS_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { data } = await admin
    .from('email_log')
    .select('id')
    .eq('user_id', userId)
    .in('status', ['BOUNCED', 'COMPLAINED'])
    .gte('last_event_at', since)
    .limit(1);
  return (data ?? []).length > 0;
}

export async function notifyAccount(
  admin: SupabaseClient,
  input: { userId: string; key: string; kind: string; message: EmailMessage },
): Promise<NotifyOutcome> {
  const sender = getEmailSender();
  const suppressed = await isSuppressed(admin, input.userId);

  // Claim the key. A unique violation means this message already exists
  // (sent, queued or suppressed), which is the point.
  const { data: row, error: claimError } = await admin
    .from('email_log')
    .insert({
      user_id: input.userId,
      kind: input.kind,
      idempotency_key: input.key,
      subject: input.message.subject,
      body: input.message.text,
      provider: sender?.name ?? 'none',
      status: suppressed ? 'SUPPRESSED' : 'QUEUED',
      ...(suppressed ? { error_class: 'ADDRESS_SUPPRESSED', last_event_at: new Date().toISOString() } : {}),
    })
    .select(EMAIL_LOG_COLUMNS)
    .single();

  if (claimError !== null || row === null) {
    if (claimError?.code === '23505') return 'duplicate';
    log.warn('email log insert failed', { route: 'email.notifyAccount', errorClass: claimError?.code ?? 'unknown' });
    return 'failed';
  }
  if (suppressed) {
    log.info('email suppressed', { route: 'email.notifyAccount', kind: input.kind });
    return 'suppressed';
  }
  if (sender === null) return 'queued';

  return deliverLogged(admin, row as unknown as EmailLogRow);
}

/**
 * Send a logged message and record the result on its row. Used for the first
 * attempt and for retries; the row is the source of truth for both.
 */
export async function deliverLogged(admin: SupabaseClient, row: EmailLogRow): Promise<NotifyOutcome> {
  const sender = getEmailSender();
  if (sender === null) return 'queued';
  const now = new Date().toISOString();

  const { data } = await admin.auth.admin.getUserById(row.user_id);
  const to = data?.user?.email ?? null;
  if (to === null) {
    await admin
      .from('email_log')
      .update({ status: 'NO_ADDRESS', error_class: 'NO_ADDRESS', last_event_at: now })
      .eq('id', row.id);
    return 'no_address';
  }

  try {
    const receipt = await sender.send({ to, subject: row.subject, text: row.body });
    await admin
      .from('email_log')
      .update({
        status: 'SENT',
        provider: sender.name,
        provider_message_id: receipt.providerMessageId,
        sent_at: now,
        last_event_at: now,
        attempts: row.attempts + 1,
        error_class: null,
        events: [...(row.events ?? []), { type: 'sent', at: now }],
      })
      .eq('id', row.id);
    log.info('email sent', {
      route: 'email.deliverLogged',
      kind: row.kind,
      provider: sender.name,
      providerMessageId: receipt.providerMessageId ?? 'none',
    });
    return 'sent';
  } catch (error) {
    const errorClass = error instanceof Error ? error.message.slice(0, 80) : 'UnknownError';
    await admin
      .from('email_log')
      .update({
        status: 'FAILED',
        attempts: row.attempts + 1,
        error_class: errorClass,
        last_event_at: now,
        events: [...(row.events ?? []), { type: 'failed', at: now }],
      })
      .eq('id', row.id);
    log.warn('email not sent', { route: 'email.deliverLogged', kind: row.kind, errorClass });
    return 'failed';
  }
}

/**
 * Send what is waiting: messages queued while no provider was configured,
 * and sends that failed fewer than three times in the last week. Called
 * from the reminders cron so nothing needs a worker of its own.
 */
export async function retryPending(admin: SupabaseClient, limit = 50): Promise<{ sent: number; failed: number }> {
  if (getEmailSender() === null) return { sent: 0, failed: 0 };
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data } = await admin
    .from('email_log')
    .select(EMAIL_LOG_COLUMNS)
    .in('status', ['QUEUED', 'FAILED'])
    .lt('attempts', MAX_ATTEMPTS)
    .gte('created_at', since)
    .order('created_at', { ascending: true })
    .limit(limit);

  let sent = 0;
  let failed = 0;
  for (const row of (data ?? []) as unknown as EmailLogRow[]) {
    const outcome = await deliverLogged(admin, row);
    if (outcome === 'sent') sent += 1;
    else if (outcome === 'failed') failed += 1;
  }
  return { sent, failed };
}

/** Apply a delivery event from the provider to the message it refers to. */
export async function recordDeliveryEvent(
  admin: SupabaseClient,
  input: { providerMessageId: string; type: string; at: string },
): Promise<'updated' | 'unknown_message' | 'ignored'> {
  const status = STATUS_FOR_EVENT[input.type];
  if (status === undefined) return 'ignored';

  const { data } = await admin
    .from('email_log')
    .select(EMAIL_LOG_COLUMNS)
    .eq('provider_message_id', input.providerMessageId)
    .maybeSingle();
  if (data === null || data === undefined) return 'unknown_message';
  const row = data as unknown as EmailLogRow;

  // Statuses only move forward, except that a bounce or complaint always
  // wins: "delivered" arriving after "bounced" (out of order) must not hide
  // the bounce.
  const next = RANK[status]! >= RANK[row.status]! || status === 'BOUNCED' || status === 'COMPLAINED' ? status : row.status;

  await admin
    .from('email_log')
    .update({
      status: next,
      last_event_at: input.at,
      events: [...(row.events ?? []), { type: input.type, at: input.at }],
    })
    .eq('id', row.id);
  return 'updated';
}

/** Resend event types the log understands. Opens and clicks are not tracked. */
const STATUS_FOR_EVENT: Readonly<Record<string, string>> = {
  'email.sent': 'SENT',
  'email.delivered': 'DELIVERED',
  'email.delivery_delayed': 'DELAYED',
  'email.bounced': 'BOUNCED',
  'email.complained': 'COMPLAINED',
};

const RANK: Readonly<Record<string, number>> = {
  QUEUED: 0,
  FAILED: 0,
  NO_ADDRESS: 0,
  SUPPRESSED: 0,
  SENT: 1,
  DELAYED: 2,
  DELIVERED: 3,
  BOUNCED: 4,
  COMPLAINED: 5,
};
