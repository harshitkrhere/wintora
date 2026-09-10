/**
 * POST   /api/privacy/delete   request account deletion
 * DELETE /api/privacy/delete   cancel a pending deletion
 *
 * Available on every plan including expired accounts. Deletion is a user right,
 * not a paid feature.
 *
 * Requires step-up authentication and a typed confirmation, then a 7-day
 * cooling-off window the user is told about and can cancel within. The window
 * exists because a phished or angry-at-2am deletion is not recoverable.
 *
 * What survives deletion is stated up front rather than buried.
 * See docs/PRIVACY.md section 4.
 */

import { type NextRequest } from 'next/server';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { POLICY } from '@/config/policy';
import { AppError } from '@/lib/errors';
import { authorize, handler, ok, parseBody, requireUser } from '@/lib/http/api';
import { clientIp, enforceRateLimit } from '@/lib/http/ratelimit';
import { createAdminClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  // Typed confirmation, so this cannot be triggered by a stray click or a
  // cross-site request that somehow got past the origin check.
  confirmation: z.literal('DELETE MY ACCOUNT'),
  reason: z.string().trim().max(500).optional(),
});

const SURVIVES_DELETION = [
  'Billing records we are required to keep for tax and accounting, reduced to the minimum and separated from your case content',
  'Security records relating to fraud or abuse, if any exist',
  'A record that an account was deleted on a given date',
  'Backup copies, until the backup retention schedule expires them',
];

export const POST = handler('/api/privacy/delete', async (request: NextRequest, context) => {
  const user = await requireUser();
  enforceRateLimit('EXPORT', { userId: user.id, ip: clientIp(request.headers) });

  const body = await parseBody(request, bodySchema);
  void body.confirmation;

  // ACCOUNT_DELETION is inalienable. This can still deny with
  // REQUIRES_VERIFICATION if the session is not freshly authenticated.
  await authorize(user, { feature: 'ACCOUNT_DELETION', action: 'delete' });

  const admin = createAdminClient();

  const { data: existing } = await admin
    .from('deletion_jobs')
    .select('id, execute_after, status')
    .eq('user_id', user.id)
    .eq('status', 'QUEUED')
    .is('canceled_at', null)
    .maybeSingle();

  if (existing !== null && existing !== undefined) {
    return ok(context, {
      job: existing,
      message: 'Your account is already scheduled for deletion.',
      survives: SURVIVES_DELETION,
    });
  }

  const executeAfter = new Date(
    Date.now() + POLICY.deletion.coolingOffDays * 24 * 60 * 60 * 1000,
  );

  const { data: privacyRequest } = await admin
    .from('privacy_requests')
    .insert({
      user_id: user.id,
      request_type: 'DELETE',
      status: 'IN_PROGRESS',
      verification_status: 'VERIFIED',
      notes: body.reason ?? null,
      due_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    })
    .select('id')
    .single();

  const { data: job, error } = await admin
    .from('deletion_jobs')
    .insert({
      user_id: user.id,
      privacy_request_id: (privacyRequest as { id: string } | null)?.id ?? null,
      status: 'QUEUED',
      idempotency_key: `delete_${user.id}_${randomUUID()}`,
      scope: 'ACCOUNT',
      execute_after: executeAfter.toISOString(),
    })
    .select('id, execute_after, status')
    .single();

  if (error !== null || job === null) {
    throw new AppError('INTERNAL', 'We could not schedule your deletion.', {
      detail: error?.code,
    });
  }

  await admin.from('audit_logs').insert({
    user_id: user.id,
    action: 'ACCOUNT_DELETION_REQUESTED',
    resource_type: 'deletion_job',
    resource_id: (job as { id: string }).id,
    outcome: 'SUCCESS',
    request_id: context.requestId,
  });

  return ok(
    context,
    {
      job,
      executeAfter: executeAfter.toISOString(),
      coolingOffDays: POLICY.deletion.coolingOffDays,
      message:
        `Your account is scheduled for deletion on ${executeAfter.toDateString()}. ` +
        `You can cancel any time before then, and your subscription will be canceled ` +
        `as part of the deletion so you will not be billed again.`,
      survives: SURVIVES_DELETION,
      suggestion:
        'If you have not already, export your data first. It is available on every plan.',
    },
    202,
  );
});

export const DELETE = handler('/api/privacy/delete', async (_request: NextRequest, context) => {
  const user = await requireUser();
  const admin = createAdminClient();

  const { data, error } = await admin
    .from('deletion_jobs')
    .update({ canceled_at: new Date().toISOString(), status: 'DEAD' })
    .eq('user_id', user.id)
    .eq('status', 'QUEUED')
    .is('canceled_at', null)
    .select('id')
    .maybeSingle();

  if (error !== null) {
    throw new AppError('INTERNAL', 'We could not cancel the deletion.', {
      detail: error.code,
    });
  }
  if (data === null) {
    throw new AppError('NOT_FOUND', 'There is no pending deletion to cancel.');
  }

  await admin.from('audit_logs').insert({
    user_id: user.id,
    action: 'ACCOUNT_DELETION_CANCELED',
    resource_type: 'deletion_job',
    resource_id: (data as { id: string }).id,
    outcome: 'SUCCESS',
    request_id: context.requestId,
  });

  return ok(context, {
    message: 'Your account will not be deleted. Nothing was removed.',
  });
});
