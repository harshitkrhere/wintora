/**
 * Executing account deletions whose cooling-off window has passed.
 *
 * A request (POST /api/privacy/delete) only schedules: a deletion_jobs row
 * with execute_after seven days out, which the person can cancel until
 * then. This is the other half, run daily by the retention sweep. For each
 * job that is due and not cancelled, in this order:
 *
 *   1. claim it (QUEUED -> RUNNING), so a second run cannot double up;
 *   2. stop the money: cancel any live subscription at the provider now,
 *      so a deleted account cannot be billed again. If the provider refuses,
 *      the job goes back to QUEUED with the reason and nothing else happens
 *      to the account today;
 *   3. write the tombstone: the fact of the deletion and the billing records
 *      the law requires, reduced to amounts, dates and references and kept
 *      apart from any content (docs/PRIVACY.md section 4);
 *   4. remove every storage object the person uploaded. A dangling row is
 *      recoverable; an orphaned file that outlives its promise is not;
 *   5. tell them it is done, while there is still an address to tell;
 *   6. delete the auth user. Every table that references it cascades: cases,
 *      documents, checks, letters, reminders, the email log, the audit
 *      trail, the subscription, the job itself.
 *
 * Any failure after the claim puts the job back to QUEUED with error_class
 * set, so it is retried the next day and a human can see why it waited.
 * The side effects are injected so the sequence can be tested without a
 * database.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { log } from '@/lib/logging';

export interface DeletionEffects {
  /** Remove these storage paths. Throws when any cannot be removed. */
  removeObjects(paths: readonly string[]): Promise<void>;
  /** Cancel the subscription at the provider, immediately. Throws when it cannot. */
  cancelSubscription(providerSubscriptionId: string): Promise<void>;
  /** Delete the auth user; every row that references it goes with it. Throws when it cannot. */
  deleteAuthUser(userId: string): Promise<void>;
  /** Tell the person it is done. Never throws; a failed email does not stop a deletion. */
  notifyDeleted(userId: string): Promise<void>;
}

export interface DeletionRun {
  readonly executed: number;
  readonly deferred: number;
}

const LIVE_STATUSES = ['TRIALING', 'ACTIVE', 'PAST_DUE', 'GRACE', 'PAUSED', 'CANCELED_PENDING_EXPIRY'];

interface DueJob {
  id: string;
  user_id: string;
  created_at: string;
}

interface BillingRecord {
  provider_invoice_id: string;
  number: string | null;
  amount_due_cents: number;
  amount_paid_cents: number;
  tax_cents: number;
  currency: string;
  status: string;
  period_start: string | null;
  period_end: string | null;
  issued_at: string | null;
  paid_at: string | null;
}

export async function executeDueDeletions(
  admin: SupabaseClient,
  now: Date,
  effects: DeletionEffects,
  limit = 20,
): Promise<DeletionRun> {
  const { data } = await admin
    .from('deletion_jobs')
    .select('id, user_id, created_at')
    .eq('status', 'QUEUED')
    .eq('scope', 'ACCOUNT')
    .is('canceled_at', null)
    .lte('execute_after', now.toISOString())
    .order('execute_after', { ascending: true })
    .limit(limit);

  let executed = 0;
  let deferred = 0;

  for (const job of (data ?? []) as DueJob[]) {
    // 1. Claim. Zero rows means it was cancelled or taken since the read.
    const { data: claimed } = await admin
      .from('deletion_jobs')
      .update({ status: 'RUNNING', error_class: null })
      .eq('id', job.id)
      .eq('status', 'QUEUED')
      .is('canceled_at', null)
      .select('id')
      .maybeSingle();
    if (claimed === null || claimed === undefined) continue;

    const defer = async (reason: string): Promise<void> => {
      deferred += 1;
      log.warn('account deletion deferred', { route: 'privacy.executeDueDeletions', errorClass: reason });
      await admin.from('deletion_jobs').update({ status: 'QUEUED', error_class: reason }).eq('id', job.id);
    };

    try {
      // 2. Stop the money.
      const { data: subscription } = await admin
        .from('subscriptions')
        .select('provider, provider_customer_id, provider_subscription_id, status')
        .eq('user_id', job.user_id)
        .in('status', LIVE_STATUSES)
        .maybeSingle();
      const live = subscription as {
        provider: string; provider_customer_id: string | null; provider_subscription_id: string | null; status: string;
      } | null;
      if (live !== null && live.provider_subscription_id !== null) {
        try {
          await effects.cancelSubscription(live.provider_subscription_id);
        } catch (error) {
          await defer(`cancel:${error instanceof Error ? error.name : 'unknown'}`);
          continue;
        }
      }

      // 3. The tombstone, before anything is removed, so the record exists
      //    even if a later step fails and the job is retried.
      const { data: invoices } = await admin
        .from('invoices')
        .select('provider_invoice_id, number, amount_due_cents, amount_paid_cents, tax_cents, currency, status, period_start, period_end, issued_at, paid_at')
        .eq('user_id', job.user_id)
        .order('issued_at', { ascending: true });
      const { data: anyProvider } = live === null
        ? await admin
            .from('subscriptions')
            .select('provider, provider_customer_id')
            .eq('user_id', job.user_id)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle()
        : { data: null };
      const providerRow = live ?? (anyProvider as { provider: string; provider_customer_id: string | null } | null);
      const { error: tombstoneError } = await admin.from('account_tombstones').upsert(
        {
          user_id: job.user_id,
          requested_at: job.created_at,
          deleted_at: now.toISOString(),
          provider: providerRow?.provider ?? null,
          provider_customer_id: providerRow?.provider_customer_id ?? null,
          billing: ((invoices ?? []) as BillingRecord[]).map((i) => ({ ...i })),
        },
        { onConflict: 'user_id' },
      );
      if (tombstoneError !== null) {
        await defer(`tombstone:${tombstoneError.code}`);
        continue;
      }

      // 4. Storage objects, in batches.
      const { data: documents } = await admin
        .from('documents')
        .select('storage_path')
        .eq('user_id', job.user_id)
        .not('storage_path', 'is', null);
      const paths = ((documents ?? []) as { storage_path: string }[]).map((d) => d.storage_path);
      try {
        for (let i = 0; i < paths.length; i += 100) {
          await effects.removeObjects(paths.slice(i, i + 100));
        }
      } catch (error) {
        await defer(`storage:${error instanceof Error ? error.name : 'unknown'}`);
        continue;
      }

      // 5. The last message, while there is still someone to send it to.
      await effects.notifyDeleted(job.user_id);

      // 6. The user, and with it everything that references it.
      try {
        await effects.deleteAuthUser(job.user_id);
      } catch (error) {
        await defer(`auth:${error instanceof Error ? error.name : 'unknown'}`);
        continue;
      }

      executed += 1;
      log.info('account deleted', { route: 'privacy.executeDueDeletions' });
    } catch (error) {
      await defer(`unexpected:${error instanceof Error ? error.name : 'unknown'}`);
    }
  }

  return { executed, deferred };
}
