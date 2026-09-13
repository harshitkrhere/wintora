/**
 * PATCH  /api/reminders/{id}   mark done or not done, or move the time
 * DELETE /api/reminders/{id}   remove it
 *
 * Ownership is the whole check: a reminder is the customer's note and there
 * is no plan condition on finishing or removing one. Losing REMINDERS on a
 * downgrade blocks new ones, never the ones already set.
 */

import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { AppError } from '@/lib/errors';
import { handler, ok, parseBody, pathIdAfter, requireUser } from '@/lib/http/api';
import { clientIp, enforceRateLimit } from '@/lib/http/ratelimit';
import { createAdminClient } from '@/lib/supabase/server';
import { REMINDER_COLUMNS, publicReminder } from '@/lib/cases/dates';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z
  .object({
    done: z.boolean().optional(),
    remindAt: z.string().datetime({ offset: true }).optional(),
    title: z.string().trim().min(1).max(200).optional(),
  })
  .refine((b) => b.done !== undefined || b.remindAt !== undefined || b.title !== undefined, {
    message: 'Nothing to change.',
  });

async function loadOwned(admin: ReturnType<typeof createAdminClient>, userId: string, id: string) {
  const { data } = await admin
    .from('reminders')
    .select(REMINDER_COLUMNS)
    .eq('id', id)
    .eq('user_id', userId)
    .maybeSingle();
  if (data === null || data === undefined) {
    throw new AppError('NOT_FOUND', 'We could not find that reminder.');
  }
  return data as Record<string, unknown> & { case_id: string; title: string };
}

export const PATCH = handler('/api/reminders/[id]', async (request: NextRequest, context) => {
  const user = await requireUser();
  enforceRateLimit('GENERAL', { userId: user.id, ip: clientIp(request.headers) });

  const id = pathIdAfter(request, 'reminders');
  const body = await parseBody(request, bodySchema);
  const admin = createAdminClient();
  const row = await loadOwned(admin, user.id, id);

  const patch: Record<string, unknown> = {};
  if (body.done !== undefined) patch.completed_at = body.done ? new Date().toISOString() : null;
  if (body.title !== undefined) patch.title = body.title;
  if (body.remindAt !== undefined) {
    const at = new Date(body.remindAt);
    if (at.getTime() < Date.now() + 60_000) {
      throw new AppError('VALIDATION_FAILED', 'Choose a time in the future.');
    }
    patch.remind_at = at.toISOString();
    // Moved into the future means it has not been sent for the new time.
    patch.notified_at = null;
  }

  const { data, error } = await admin
    .from('reminders')
    .update(patch)
    .eq('id', id)
    .eq('user_id', user.id)
    .select(REMINDER_COLUMNS)
    .single();
  if (error !== null || data === null) {
    throw new AppError('INTERNAL', 'We could not update that reminder.', { detail: error?.code });
  }

  if (body.done === true) {
    await admin.from('case_events').insert({
      case_id: row.case_id,
      user_id: user.id,
      event_type: 'REMINDER_DONE',
      title: 'Reminder marked done',
      detail: row.title,
      origin: 'USER',
    });
  }

  return ok(context, { reminder: publicReminder(data as Record<string, unknown>) });
});

export const DELETE = handler('/api/reminders/[id]', async (request: NextRequest, context) => {
  const user = await requireUser();
  enforceRateLimit('GENERAL', { userId: user.id, ip: clientIp(request.headers) });

  const id = pathIdAfter(request, 'reminders');
  const admin = createAdminClient();
  await loadOwned(admin, user.id, id);

  const { error } = await admin.from('reminders').delete().eq('id', id).eq('user_id', user.id);
  if (error !== null) {
    throw new AppError('INTERNAL', 'We could not remove that reminder.', { detail: error.code });
  }
  return ok(context, { removed: true });
});
