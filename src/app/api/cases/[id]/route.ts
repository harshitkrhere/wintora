/**
 * PATCH /api/cases/{id}   change a case's status, or its name
 *
 * OPEN <-> CLOSED, by the owner, recorded on the timeline. Closing never
 * deletes anything and never blocks reading: a closed case is a finished
 * case, not a hidden one. Reopening is always allowed.
 *
 * Renaming is the customer's call alone: a case created from a file name and
 * then named after the provider on the bill can be given any name they like.
 */

import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { AppError } from '@/lib/errors';
import { authorize, handler, ok, parseBody, requireUser, uuidSchema } from '@/lib/http/api';
import { clientIp, enforceRateLimit } from '@/lib/http/ratelimit';
import { createAdminClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z
  .object({
    status: z.enum(['OPEN', 'CLOSED']).optional(),
    title: z.string().trim().min(1).max(200).optional(),
  })
  .refine((body) => body.status !== undefined || body.title !== undefined, {
    message: 'Nothing to change.',
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

  const patch: Record<string, unknown> = {};
  if (body.status !== undefined) {
    patch.status = body.status;
    patch.closed_at = body.status === 'CLOSED' ? new Date().toISOString() : null;
  }
  if (body.title !== undefined) patch.title = body.title;

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('cases')
    .update(patch)
    .eq('id', caseId)
    .eq('user_id', user.id)
    .select('id, status, title')
    .single();

  if (error !== null || data === null) {
    throw new AppError('INTERNAL', 'We could not update that case.', { detail: error?.code });
  }

  const events: { event_type: string; title: string; detail?: string }[] = [];
  if (body.status !== undefined) {
    events.push({
      event_type: body.status === 'CLOSED' ? 'CASE_CLOSED' : 'CASE_REOPENED',
      title: body.status === 'CLOSED' ? 'Case closed' : 'Case reopened',
    });
  }
  if (body.title !== undefined) {
    events.push({ event_type: 'CASE_RENAMED', title: 'Case renamed', detail: body.title });
  }
  await admin.from('case_events').insert(
    events.map((e) => ({ case_id: caseId, user_id: user.id, origin: 'USER', ...e })),
  );

  return ok(context, { case: data });
});
