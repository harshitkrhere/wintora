/**
 * PATCH /api/cases/{id}   change a case's status
 *
 * OPEN <-> CLOSED, by the owner, recorded on the timeline. Closing never
 * deletes anything and never blocks reading: a closed case is a finished
 * case, not a hidden one. Reopening is always allowed.
 */

import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { AppError } from '@/lib/errors';
import { authorize, handler, ok, parseBody, requireUser, uuidSchema } from '@/lib/http/api';
import { clientIp, enforceRateLimit } from '@/lib/http/ratelimit';
import { createAdminClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  status: z.enum(['OPEN', 'CLOSED']),
});

function caseIdFromPath(request: NextRequest): string {
  const segments = request.nextUrl.pathname.split('/').filter((s) => s.length > 0);
  const raw = segments[segments.indexOf('cases') + 1];
  const parsed = uuidSchema.safeParse(raw);
  if (!parsed.success) throw new AppError('NOT_FOUND', 'That case does not exist.');
  return parsed.data;
}

export const PATCH = handler('/api/cases/[id]', async (request: NextRequest, context) => {
  const user = await requireUser();
  enforceRateLimit('GENERAL', { userId: user.id, ip: clientIp(request.headers) });

  const caseId = caseIdFromPath(request);
  const body = await parseBody(request, bodySchema);

  // Ownership. A foreign id looks like a missing case, not a refusal.
  await authorize(user, {
    feature: 'CASE_TRACKING',
    resource: { type: 'case', id: caseId },
    action: 'execute',
  }).catch(() => {
    throw new AppError('NOT_FOUND', 'That case does not exist.');
  });

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('cases')
    .update({
      status: body.status,
      closed_at: body.status === 'CLOSED' ? new Date().toISOString() : null,
    })
    .eq('id', caseId)
    .eq('user_id', user.id)
    .select('id, status')
    .single();

  if (error !== null || data === null) {
    throw new AppError('INTERNAL', 'We could not update that case.', { detail: error?.code });
  }

  await admin.from('case_events').insert({
    case_id: caseId,
    user_id: user.id,
    event_type: body.status === 'CLOSED' ? 'CASE_CLOSED' : 'CASE_REOPENED',
    title: body.status === 'CLOSED' ? 'Case closed' : 'Case reopened',
    origin: 'USER',
  });

  return ok(context, { case: data });
});
