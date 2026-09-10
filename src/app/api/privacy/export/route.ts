/**
 * POST /api/privacy/export
 *
 * Data export. Available on EVERY plan including free, expired and canceled
 * accounts: portability is a user right, not a paid feature, and the entitlement
 * engine is not permitted to gate it.
 *
 * Requires step-up authentication. The resulting link is single-use, expires in
 * an hour, and the download is audited. Exports are never emailed as
 * attachments. See docs/PRIVACY.md section 4.
 */

import { type NextRequest } from 'next/server';
import { randomUUID } from 'node:crypto';
import { POLICY } from '@/config/policy';
import { AppError } from '@/lib/errors';
import { authorize, handler, ok, requireUser } from '@/lib/http/api';
import { clientIp, enforceRateLimit } from '@/lib/http/ratelimit';
import { createAdminClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = handler('/api/privacy/export', async (request: NextRequest, context) => {
  const user = await requireUser();
  enforceRateLimit('EXPORT', { userId: user.id, ip: clientIp(request.headers) });

  // DATA_EXPORT is inalienable, so this never denies for plan reasons. It can
  // still deny with REQUIRES_VERIFICATION, which is the point.
  await authorize(user, { feature: 'DATA_EXPORT', action: 'export' });

  const admin = createAdminClient();

  // One export job at a time, so a repeated click does not queue five.
  const { data: pending } = await admin
    .from('export_jobs')
    .select('id, status, created_at')
    .eq('user_id', user.id)
    .in('status', ['QUEUED', 'RUNNING'])
    .maybeSingle();

  if (pending !== null && pending !== undefined) {
    return ok(context, {
      job: pending,
      message: 'Your export is already being prepared. We will let you know when it is ready.',
    });
  }

  const idempotencyKey = `export_${user.id}_${randomUUID()}`;

  const { data: privacyRequest } = await admin
    .from('privacy_requests')
    .insert({
      user_id: user.id,
      request_type: 'EXPORT',
      status: 'IN_PROGRESS',
      verification_status: 'VERIFIED',
      // Statutory deadlines are tracked, not remembered.
      due_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    })
    .select('id')
    .single();

  const { data: job, error } = await admin
    .from('export_jobs')
    .insert({
      user_id: user.id,
      privacy_request_id: (privacyRequest as { id: string } | null)?.id ?? null,
      status: 'QUEUED',
      idempotency_key: idempotencyKey,
      download_expires_at: new Date(
        Date.now() + POLICY.export.linkTtlMinutes * 60 * 1000,
      ).toISOString(),
    })
    .select('id, status, created_at')
    .single();

  if (error !== null || job === null) {
    throw new AppError('INTERNAL', 'We could not start your export.', {
      detail: error?.code,
    });
  }

  await admin.from('audit_logs').insert({
    user_id: user.id,
    action: 'DATA_EXPORT_REQUESTED',
    resource_type: 'export_job',
    resource_id: (job as { id: string }).id,
    outcome: 'SUCCESS',
    request_id: context.requestId,
  });

  return ok(
    context,
    {
      job,
      contents: [
        'Account and profile',
        'Cases and their timelines',
        'Documents, including the original files you uploaded',
        'Extractions, analyses and findings with their evidence',
        'Generated letters',
        'Reminders and deadlines',
        'Billing history',
      ],
      message:
        'We are preparing your export. It will appear in your dashboard, and the download link will work once and expire after an hour.',
    },
    202,
  );
});
