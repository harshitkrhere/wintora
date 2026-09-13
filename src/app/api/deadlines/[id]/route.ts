/**
 * PATCH  /api/deadlines/{id}   mark done or not done; edit a date you entered
 * DELETE /api/deadlines/{id}   remove a date you entered
 *
 * A verified date can be marked done but not edited or removed here: it was
 * placed from a reviewed source, and the customer's view of it should stay
 * what the source says. Their own dates are theirs to change.
 */

import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { AppError } from '@/lib/errors';
import { handler, ok, parseBody, pathIdAfter, requireUser } from '@/lib/http/api';
import { clientIp, enforceRateLimit } from '@/lib/http/ratelimit';
import { createAdminClient } from '@/lib/supabase/server';
import { DEADLINE_COLUMNS, publicDeadline } from '@/lib/cases/dates';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z
  .object({
    done: z.boolean().optional(),
    label: z.string().trim().min(1).max(200).optional(),
    dueDate: z.string().date().optional(),
    notes: z.string().trim().max(2000).optional(),
  })
  .refine((b) => Object.values(b).some((v) => v !== undefined), { message: 'Nothing to change.' });

async function loadOwned(admin: ReturnType<typeof createAdminClient>, userId: string, id: string) {
  const { data } = await admin
    .from('deadlines')
    .select(DEADLINE_COLUMNS)
    .eq('id', id)
    .eq('user_id', userId)
    .maybeSingle();
  if (data === null || data === undefined) {
    throw new AppError('NOT_FOUND', 'We could not find that date.');
  }
  return data as Record<string, unknown> & { case_id: string; label: string; is_verified: boolean; user_entered: boolean };
}

export const PATCH = handler('/api/deadlines/[id]', async (request: NextRequest, context) => {
  const user = await requireUser();
  enforceRateLimit('GENERAL', { userId: user.id, ip: clientIp(request.headers) });

  const id = pathIdAfter(request, 'deadlines');
  const body = await parseBody(request, bodySchema);
  const admin = createAdminClient();
  const row = await loadOwned(admin, user.id, id);

  const editing = body.label !== undefined || body.dueDate !== undefined || body.notes !== undefined;
  if (editing && (row.is_verified || !row.user_entered)) {
    throw new AppError('CONFLICT', 'This date comes from a verified source and cannot be edited. You can mark it done.');
  }

  const patch: Record<string, unknown> = {};
  if (body.done !== undefined) patch.completed_at = body.done ? new Date().toISOString() : null;
  if (body.label !== undefined) patch.label = body.label;
  if (body.dueDate !== undefined) patch.due_date = body.dueDate;
  if (body.notes !== undefined) patch.notes = body.notes.length > 0 ? body.notes : null;

  const { data, error } = await admin
    .from('deadlines')
    .update(patch)
    .eq('id', id)
    .eq('user_id', user.id)
    .select(DEADLINE_COLUMNS)
    .single();
  if (error !== null || data === null) {
    throw new AppError('INTERNAL', 'We could not update that date.', { detail: error?.code });
  }

  if (body.done === true) {
    await admin.from('case_events').insert({
      case_id: row.case_id,
      user_id: user.id,
      event_type: 'DEADLINE_DONE',
      title: 'Date marked done',
      detail: row.label,
      origin: 'USER',
    });
  }

  return ok(context, { deadline: publicDeadline(data as Record<string, unknown>) });
});

export const DELETE = handler('/api/deadlines/[id]', async (request: NextRequest, context) => {
  const user = await requireUser();
  enforceRateLimit('GENERAL', { userId: user.id, ip: clientIp(request.headers) });

  const id = pathIdAfter(request, 'deadlines');
  const admin = createAdminClient();
  const row = await loadOwned(admin, user.id, id);
  if (row.is_verified || !row.user_entered) {
    throw new AppError('CONFLICT', 'This date comes from a verified source and cannot be removed.');
  }

  const { error } = await admin.from('deadlines').delete().eq('id', id).eq('user_id', user.id);
  if (error !== null) {
    throw new AppError('INTERNAL', 'We could not remove that date.', { detail: error.code });
  }
  return ok(context, { removed: true });
});
