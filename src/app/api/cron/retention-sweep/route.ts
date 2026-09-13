/**
 * POST /api/cron/retention-sweep
 *
 * Deletes documents whose retention window has genuinely passed, and sends the
 * 7-day warning for those approaching it.
 *
 * Deliberately conservative: it only ever touches documents whose retention
 * date is in the past. Everything else is somebody's medical paperwork.
 *
 * Retention is separate from billing. A lapsed subscription deletes nothing.
 * See docs/PRIVACY.md section 3.
 */

import { type NextRequest } from 'next/server';
import { publicEnv, serverEnv } from '@/lib/env';
import { handler, ok } from '@/lib/http/api';
import { assertCronAuthorized } from '@/lib/http/cron';
import { log } from '@/lib/logging';
import { createAdminClient } from '@/lib/supabase/server';
import { createEntitlementStore, loadPlanMatrix } from '@/lib/supabase/stores';
import { getEmailSender } from '@/lib/email';
import { computeEntitlements, freeSnapshot } from '@/domain/entitlements/compute';
import { retentionNoticeEmail } from '@/domain/reminders/notice';
import { POLICY } from '@/config/policy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BATCH_SIZE = 200;

export const POST = handler('/api/cron/retention-sweep', async (request: NextRequest, context) => {
  assertCronAuthorized(request);

  const admin = createAdminClient();
  const bucket = serverEnv().SUPABASE_DOCUMENTS_BUCKET;
  const now = new Date();

  // 1. Warn before deleting. Nobody should lose a document without notice.
  const noticeThreshold = new Date(
    now.getTime() + POLICY.retention.expiryNoticeDays * 24 * 60 * 60 * 1000,
  );

  const { data: expiring } = await admin
    .from('documents')
    .select('id, user_id, case_id, retention_until')
    .is('deleted_at', null)
    .is('retention_notice_sent_at', null)
    .gt('retention_until', now.toISOString())
    .lte('retention_until', noticeThreshold.toISOString())
    .limit(BATCH_SIZE);

  const toNotify = (expiring ?? []) as {
    id: string; user_id: string; case_id: string | null; retention_until: string;
  }[];

  let notified = 0;
  if (toNotify.length > 0) {
    await admin
      .from('documents')
      .update({ retention_notice_sent_at: now.toISOString() })
      .in('id', toNotify.map((d) => d.id));

    // The notification itself says only that something needs attention. It
    // never names a provider, a condition or an amount. The job row is the
    // record; the send happens right here when a provider is configured.
    await admin.from('jobs').insert(
      toNotify.map((doc) => ({
        job_type: 'SEND_RETENTION_NOTICE',
        user_id: doc.user_id,
        payload: { documentId: doc.id },
        idempotency_key: `retention_notice_${doc.id}`,
      })),
    );

    notified = await sendRetentionNotices(admin, toNotify, now);
  }

  // Which accounts keep the figures read from a document after the file is
  // removed (EXTENDED_HISTORY). Computed once per account, not per document.
  const keepsFigures = await extendedHistoryByUser(admin, now);

  // 2. Delete what has genuinely expired.
  const { data: expired } = await admin
    .from('documents')
    .select('id, user_id, storage_path, document_type')
    .is('deleted_at', null)
    .not('retention_until', 'is', null)
    .lte('retention_until', now.toISOString())
    .limit(BATCH_SIZE);

  const toDelete = (expired ?? []) as {
    id: string;
    user_id: string;
    storage_path: string | null;
    document_type: string;
  }[];

  let deleted = 0;

  for (const doc of toDelete) {
    // Storage object first. A dangling row is recoverable; an orphaned object
    // that outlives its retention promise is not.
    if (doc.storage_path !== null) {
      const { error } = await admin.storage.from(bucket).remove([doc.storage_path]);
      if (error !== null) {
        log.warn('retention sweep could not remove object', {
          route: '/api/cron/retention-sweep',
          errorClass: error.name,
        });
        continue;
      }
    }

    // The figures read from the file go with it, unless the plan keeps them.
    // Keeping them is what EXTENDED_HISTORY means: the check can still show
    // its working after the paperwork has been removed.
    if (keepsFigures.get(doc.user_id) !== true) {
      await admin.from('document_extractions').delete().eq('document_id', doc.id);
    }

    await admin
      .from('documents')
      .update({ storage_path: null, deleted_at: now.toISOString() })
      .eq('id', doc.id);

    // A minimal audit entry: what type of document, under what policy. Never
    // any content.
    await admin.from('audit_logs').insert({
      user_id: doc.user_id,
      action: 'DOCUMENT_DELETED_BY_RETENTION',
      resource_type: 'document',
      resource_id: doc.id,
      outcome: 'SUCCESS',
      context: { documentType: doc.document_type, policy: 'plan_retention' },
    });

    deleted += 1;
  }

  // 3. Case exports whose links have expired. The row stays as a record; the
  //    object goes, because a bundle of someone's paperwork should not sit in
  //    storage after the link that justified it has died.
  const { data: staleExports } = await admin
    .from('case_exports')
    .select('id, storage_path')
    .is('deleted_at', null)
    .not('storage_path', 'is', null)
    .lte('expires_at', now.toISOString())
    .limit(BATCH_SIZE);

  let exportsRemoved = 0;
  for (const exp of (staleExports ?? []) as { id: string; storage_path: string }[]) {
    const { error } = await admin.storage.from(bucket).remove([exp.storage_path]);
    if (error !== null) continue;
    await admin
      .from('case_exports')
      .update({ storage_path: null, deleted_at: now.toISOString() })
      .eq('id', exp.id);
    exportsRemoved += 1;
  }

  return ok(context, {
    noticesQueued: toNotify.length,
    noticesSent: notified,
    deleted,
    exportsRemoved,
    // True when there is more work than one batch; the scheduler runs again.
    more: toDelete.length === BATCH_SIZE,
  });
});

/**
 * Send the retention notices that were just queued. Best effort: a failed
 * send leaves the job QUEUED for the next run, and the in-app "kept until"
 * date on the case page has said the same thing all along.
 */
async function sendRetentionNotices(
  admin: ReturnType<typeof createAdminClient>,
  docs: readonly { id: string; user_id: string; case_id: string | null; retention_until: string }[],
  now: Date,
): Promise<number> {
  const sender = getEmailSender();
  if (sender === null) return 0;
  const appUrl = publicEnv().NEXT_PUBLIC_APP_URL;

  let sent = 0;
  for (const doc of docs) {
    const { data } = await admin.auth.admin.getUserById(doc.user_id);
    const to = data?.user?.email ?? null;
    if (to === null) continue;
    const message = retentionNoticeEmail({ appUrl, caseId: doc.case_id, removesOn: new Date(doc.retention_until) });
    try {
      await sender.send({ to, ...message });
      await admin
        .from('jobs')
        .update({ status: 'SUCCEEDED', completed_at: now.toISOString(), attempts: 1 })
        .eq('idempotency_key', `retention_notice_${doc.id}`);
      sent += 1;
    } catch (error) {
      log.warn('retention notice not sent', {
        route: '/api/cron/retention-sweep',
        errorClass: error instanceof Error ? error.name : 'UnknownError',
      });
    }
  }
  return sent;
}

/** user_id -> whether EXTENDED_HISTORY is enabled on their current plan. */
async function extendedHistoryByUser(
  admin: ReturnType<typeof createAdminClient>,
  now: Date,
): Promise<Map<string, boolean>> {
  const out = new Map<string, boolean>();
  const { data } = await admin
    .from('documents')
    .select('user_id')
    .is('deleted_at', null)
    .not('retention_until', 'is', null)
    .lte('retention_until', now.toISOString())
    .limit(BATCH_SIZE);
  const users = new Set(((data ?? []) as { user_id: string }[]).map((d) => d.user_id));
  if (users.size === 0) return out;

  const store = createEntitlementStore(admin);
  const matrix = await loadPlanMatrix(admin);
  for (const userId of users) {
    const subscription = (await store.getSubscription(userId)) ?? freeSnapshot(now);
    const entitlements = computeEntitlements(subscription, { matrix, now });
    out.set(userId, entitlements.EXTENDED_HISTORY.enabled);
  }
  return out;
}

// Vercel's scheduler calls cron routes with GET and the same bearer header.
export const GET = POST;
