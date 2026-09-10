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
import { serverEnv } from '@/lib/env';
import { handler, ok } from '@/lib/http/api';
import { assertCronAuthorized } from '@/lib/http/cron';
import { log } from '@/lib/logging';
import { createAdminClient } from '@/lib/supabase/server';
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
    .select('id, user_id, retention_until')
    .is('deleted_at', null)
    .is('retention_notice_sent_at', null)
    .gt('retention_until', now.toISOString())
    .lte('retention_until', noticeThreshold.toISOString())
    .limit(BATCH_SIZE);

  const toNotify = (expiring ?? []) as { id: string; user_id: string }[];

  if (toNotify.length > 0) {
    await admin
      .from('documents')
      .update({ retention_notice_sent_at: now.toISOString() })
      .in('id', toNotify.map((d) => d.id));

    // The notification itself says only that something needs attention. It
    // never names a provider, a condition or an amount.
    await admin.from('jobs').insert(
      toNotify.map((doc) => ({
        job_type: 'SEND_RETENTION_NOTICE',
        user_id: doc.user_id,
        payload: { documentId: doc.id },
        idempotency_key: `retention_notice_${doc.id}`,
      })),
    );
  }

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

    await admin.from('document_extractions').delete().eq('document_id', doc.id);

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

  return ok(context, {
    notified: toNotify.length,
    deleted,
    // True when there is more work than one batch; the scheduler runs again.
    more: toDelete.length === BATCH_SIZE,
  });
});
