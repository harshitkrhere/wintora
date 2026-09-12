/**
 * POST /api/cases/{id}/steps   record that a suggested step was done, or undone
 *
 * The checklist on a case has no table of its own. Each tick is an event the
 * customer placed on the timeline ("Marked done: Request an itemised
 * statement"), and unticking places another. The list's state is whichever
 * came last for each step. That keeps the timeline what it claims to be, a
 * record of what happened and what the person said happened, and gives the
 * checklist an honest memory without a schema change.
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
  step: z.string().trim().min(1).max(300),
  done: z.boolean(),
});

function caseIdFromPath(request: NextRequest): string {
  const segments = request.nextUrl.pathname.split('/').filter((s) => s.length > 0);
  const raw = segments[segments.indexOf('cases') + 1];
  const parsed = uuidSchema.safeParse(raw);
  if (!parsed.success) throw new AppError('NOT_FOUND', 'That case does not exist.');
  return parsed.data;
}

export const POST = handler('/api/cases/[id]/steps', async (request: NextRequest, context) => {
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
    .from('case_events')
    .insert({
      case_id: caseId,
      user_id: user.id,
      event_type: body.done ? 'STEP_DONE' : 'STEP_REOPENED',
      title: body.done ? 'Marked done' : 'Marked not done',
      detail: body.step,
      origin: 'USER',
    })
    .select('id, occurred_at')
    .single();

  if (error !== null || data === null) {
    throw new AppError('INTERNAL', 'We could not record that.', { detail: error?.code });
  }

  return ok(context, { event: data }, 201);
});
