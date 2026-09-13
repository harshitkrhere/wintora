/**
 * POST /api/privacy/export
 *
 * Data export. Available on EVERY plan including free, expired and canceled
 * accounts: portability is a user right, not a paid feature, and the entitlement
 * engine is not permitted to gate it.
 *
 * Requires step-up authentication. The request is recorded with its statutory
 * due date and queued as an export job; for now a person prepares the copy
 * and sends it to the account email within 30 days, and the operator is told
 * the moment the request is made so that deadline is met. The customer is
 * told exactly that, not a story about a download link.
 * See docs/PRIVACY.md section 4.
 */

import { type NextRequest } from 'next/server';
import { randomUUID } from 'node:crypto';
import { POLICY } from '@/config/policy';
import { AppError } from '@/lib/errors';
import { authorize, handler, ok, requireUser } from '@/lib/http/api';
import { clientIp, enforceRateLimit } from '@/lib/http/ratelimit';
import { createAdminClient } from '@/lib/supabase/server';
import { notifyOperator } from '@/lib/email/operator';

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
      message: `Your copy is already being prepared. It will be sent to ${user.email ?? 'your account email'} within 30 days of your request.`,
    });
  }

  const dueDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  const idempotencyKey = `export_${user.id}_${randomUUID()}`;

  const { data: privacyRequest } = await admin
    .from('privacy_requests')
    .insert({
      user_id: user.id,
      request_type: 'EXPORT',
      status: 'IN_PROGRESS',
      verification_status: 'VERIFIED',
      // Statutory deadlines are tracked, not remembered.
      due_date: dueDate.toISOString(),
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

  // The person who prepares it hears now, not when the deadline has passed.
  await notifyOperator({
    subject: 'Data export requested',
    text: [
      'A customer asked for a copy of their data.',
      '',
      `User id:         ${user.id}`,
      `Account email:   ${user.email ?? '(none on file)'}`,
      `Privacy request: ${(privacyRequest as { id: string } | null)?.id ?? '(not recorded)'}`,
      `Export job:      ${(job as { id: string }).id}`,
      `Due by:          ${dueDate.toISOString().slice(0, 10)}`,
      '',
      'Prepare the copy as docs/PRIVACY.md section 4 describes (account, cases, documents with originals,',
      'checks and findings, letters, reminders, billing history) and send it to the account email.',
      'Then mark the privacy request COMPLETED and the export job SUCCEEDED.',
    ].join('\n'),
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
      message: `We have recorded your request. A copy of everything Wintora holds about you will be sent to ${user.email ?? 'your account email'} within 30 days.`,
    },
    202,
  );
});
