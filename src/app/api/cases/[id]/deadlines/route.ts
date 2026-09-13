/**
 * GET  /api/cases/{id}/deadlines   the dates on a case
 * POST /api/cases/{id}/deadlines   record a date
 *
 * A date recorded here is the customer's own: is_verified is false and
 * user_entered is true, always, and the page shows it as "entered by you".
 * A VERIFIED date cites a reviewed source and can only be placed by staff
 * through the knowledge base; the database refuses one without a source.
 * The two are never mixed, because the difference between "the letter says
 * 30 days" and "you wrote down the 30th" is the whole point of the feature.
 * Gated on DEADLINE_TRACKING.
 */

import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { AppError } from '@/lib/errors';
import { authorize, handler, ok, parseBody, pathIdAfter, requireUser } from '@/lib/http/api';
import { clientIp, enforceRateLimit } from '@/lib/http/ratelimit';
import { createAdminClient } from '@/lib/supabase/server';
import { DEADLINE_COLUMNS, publicDeadline } from '@/lib/cases/dates';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_PER_CASE = 50;

const bodySchema = z.object({
  label: z.string().trim().min(1).max(200),
  dueDate: z.string().date(),
  notes: z.string().trim().max(2000).optional(),
});

export const GET = handler('/api/cases/[id]/deadlines', async (request: NextRequest, context) => {
  const user = await requireUser();
  const caseId = pathIdAfter(request, 'cases');

  await authorize(user, {
    feature: 'CASE_TRACKING',
    resource: { type: 'case', id: caseId },
    action: 'read',
  }).catch(() => {
    throw new AppError('NOT_FOUND', 'That case does not exist.');
  });

  const admin = createAdminClient();
  const { data } = await admin
    .from('deadlines')
    .select(DEADLINE_COLUMNS)
    .eq('user_id', user.id)
    .eq('case_id', caseId)
    .order('due_date', { ascending: true });

  return ok(context, { deadlines: ((data ?? []) as Record<string, unknown>[]).map(publicDeadline) });
});

export const POST = handler('/api/cases/[id]/deadlines', async (request: NextRequest, context) => {
  const user = await requireUser();
  enforceRateLimit('GENERAL', { userId: user.id, ip: clientIp(request.headers) });

  const caseId = pathIdAfter(request, 'cases');
  const body = await parseBody(request, bodySchema);

  await authorize(user, {
    feature: 'DEADLINE_TRACKING',
    resource: { type: 'case', id: caseId },
    action: 'create',
  });

  const admin = createAdminClient();
  const { count } = await admin
    .from('deadlines')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .eq('case_id', caseId);
  if ((count ?? 0) >= MAX_PER_CASE) {
    throw new AppError('CONFLICT', `A case can hold ${MAX_PER_CASE} dates.`);
  }

  const { data, error } = await admin
    .from('deadlines')
    .insert({
      user_id: user.id,
      case_id: caseId,
      label: body.label,
      due_date: body.dueDate,
      notes: body.notes ?? null,
      // Always the customer's own. Nothing on this route can say otherwise.
      is_verified: false,
      user_entered: true,
    })
    .select(DEADLINE_COLUMNS)
    .single();

  if (error !== null || data === null) {
    throw new AppError('INTERNAL', 'We could not save that date.', { detail: error?.code });
  }

  await admin.from('case_events').insert({
    case_id: caseId,
    user_id: user.id,
    event_type: 'DEADLINE_ADDED',
    title: 'Date added',
    detail: `${body.label} - ${body.dueDate}`,
    origin: 'USER',
  });

  return ok(context, { deadline: publicDeadline(data as Record<string, unknown>) }, 201);
});
