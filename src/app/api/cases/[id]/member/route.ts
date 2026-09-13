/**
 * PUT    /api/cases/{id}/member   say who this bill is for
 * DELETE /api/cases/{id}/member   clear it
 *
 * Household cases (HOUSEHOLD_CASES). The case still belongs to one account;
 * this records which person in the household it concerns, by a label the
 * customer chooses ("Maya", "Dad"). HOUSEHOLD_MEMBERS is the number of
 * distinct people across all cases: assigning a case to someone already on
 * the account costs nothing, a new name is checked against the limit. Every
 * plan includes one person, so the account holder is never blocked from
 * saying a bill is their own.
 */

import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { AppError } from '@/lib/errors';
import { authorize, handler, ok, parseBody, pathIdAfter, requireUser } from '@/lib/http/api';
import { clientIp, enforceRateLimit } from '@/lib/http/ratelimit';
import { createAdminClient } from '@/lib/supabase/server';
import { countHouseholdMembers } from '@/lib/cases/household';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  label: z.string().trim().min(1).max(60),
  relationship: z.string().trim().max(60).optional(),
});

export const PUT = handler('/api/cases/[id]/member', async (request: NextRequest, context) => {
  const user = await requireUser();
  enforceRateLimit('GENERAL', { userId: user.id, ip: clientIp(request.headers) });

  const caseId = pathIdAfter(request, 'cases');
  const body = await parseBody(request, bodySchema);

  await authorize(user, {
    feature: 'HOUSEHOLD_CASES',
    resource: { type: 'case', id: caseId },
    action: 'execute',
  });

  const admin = createAdminClient();
  const { labels } = await countHouseholdMembers(admin, user.id);
  const isNew = !labels.some((l) => l.toLowerCase() === body.label.toLowerCase());

  if (isNew) {
    // The limit counts people, not cases, so it is checked only for a new name.
    await authorize(user, {
      feature: 'HOUSEHOLD_MEMBERS',
      action: 'create',
      amount: 1,
      currentUsage: labels.length,
    });
  }

  // Keep one canonical spelling per person.
  const canonical = labels.find((l) => l.toLowerCase() === body.label.toLowerCase()) ?? body.label;

  await admin.from('case_members').delete().eq('case_id', caseId).eq('user_id', user.id);
  const { data, error } = await admin
    .from('case_members')
    .insert({
      case_id: caseId,
      user_id: user.id,
      member_label: canonical,
      relationship: body.relationship ?? null,
    })
    .select('member_label, relationship')
    .single();

  if (error !== null || data === null) {
    throw new AppError('INTERNAL', 'We could not save that.', { detail: error?.code });
  }

  await admin.from('case_events').insert({
    case_id: caseId,
    user_id: user.id,
    event_type: 'CASE_ASSIGNED',
    title: 'Bill assigned to a household member',
    detail: canonical,
    origin: 'USER',
  });

  const row = data as { member_label: string; relationship: string | null };
  return ok(context, { member: { label: row.member_label, relationship: row.relationship } });
});

export const DELETE = handler('/api/cases/[id]/member', async (request: NextRequest, context) => {
  const user = await requireUser();
  enforceRateLimit('GENERAL', { userId: user.id, ip: clientIp(request.headers) });

  const caseId = pathIdAfter(request, 'cases');

  // Clearing needs ownership only. Losing the feature on a downgrade must not
  // trap a label on a case.
  await authorize(user, {
    feature: 'CASE_TRACKING',
    resource: { type: 'case', id: caseId },
    action: 'execute',
  }).catch(() => {
    throw new AppError('NOT_FOUND', 'That case does not exist.');
  });

  const admin = createAdminClient();
  await admin.from('case_members').delete().eq('case_id', caseId).eq('user_id', user.id);
  return ok(context, { member: null });
});
