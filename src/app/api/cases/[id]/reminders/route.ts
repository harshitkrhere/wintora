/**
 * GET  /api/cases/{id}/reminders   the reminders on a case
 * POST /api/cases/{id}/reminders   set one
 *
 * A reminder is the customer's own note to their future self: "follow up on
 * the 20th". It is sent to them, by email if a provider is configured, and
 * shown on the case and the home page either way. Gated on REMINDERS.
 */

import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { AppError } from '@/lib/errors';
import { authorize, handler, ok, parseBody, pathIdAfter, requireUser } from '@/lib/http/api';
import { clientIp, enforceRateLimit } from '@/lib/http/ratelimit';
import { createAdminClient } from '@/lib/supabase/server';
import { REMINDER_COLUMNS, publicReminder } from '@/lib/cases/dates';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_PER_CASE = 50;

const bodySchema = z.object({
  title: z.string().trim().min(1).max(200),
  detail: z.string().trim().max(2000).optional(),
  /** An ISO instant. Must be in the future, by at least a minute. */
  remindAt: z.string().datetime({ offset: true }),
});

export const GET = handler('/api/cases/[id]/reminders', async (request: NextRequest, context) => {
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
    .from('reminders')
    .select(REMINDER_COLUMNS)
    .eq('user_id', user.id)
    .eq('case_id', caseId)
    .order('remind_at', { ascending: true });

  return ok(context, { reminders: ((data ?? []) as Record<string, unknown>[]).map(publicReminder) });
});

export const POST = handler('/api/cases/[id]/reminders', async (request: NextRequest, context) => {
  const user = await requireUser();
  enforceRateLimit('GENERAL', { userId: user.id, ip: clientIp(request.headers) });

  const caseId = pathIdAfter(request, 'cases');
  const body = await parseBody(request, bodySchema);

  const remindAt = new Date(body.remindAt);
  if (remindAt.getTime() < Date.now() + 60_000) {
    throw new AppError('VALIDATION_FAILED', 'Choose a time in the future.');
  }
  if (remindAt.getTime() > Date.now() + 366 * 24 * 60 * 60 * 1000) {
    throw new AppError('VALIDATION_FAILED', 'Choose a time within the next year.');
  }

  await authorize(user, {
    feature: 'REMINDERS',
    resource: { type: 'case', id: caseId },
    action: 'create',
  });

  const admin = createAdminClient();
  const { count } = await admin
    .from('reminders')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .eq('case_id', caseId)
    .is('completed_at', null);
  if ((count ?? 0) >= MAX_PER_CASE) {
    throw new AppError('CONFLICT', `A case can have ${MAX_PER_CASE} open reminders. Mark some done first.`);
  }

  const { data, error } = await admin
    .from('reminders')
    .insert({
      user_id: user.id,
      case_id: caseId,
      title: body.title,
      detail: body.detail ?? null,
      remind_at: remindAt.toISOString(),
    })
    .select(REMINDER_COLUMNS)
    .single();

  if (error !== null || data === null) {
    throw new AppError('INTERNAL', 'We could not save that reminder.', { detail: error?.code });
  }

  await admin.from('case_events').insert({
    case_id: caseId,
    user_id: user.id,
    event_type: 'REMINDER_SET',
    title: 'Reminder set',
    detail: `${body.title} - ${remindAt.toLocaleDateString('en-US', { dateStyle: 'medium', timeZone: 'UTC' })}`,
    origin: 'USER',
  });

  return ok(context, { reminder: publicReminder(data as Record<string, unknown>) }, 201);
});
