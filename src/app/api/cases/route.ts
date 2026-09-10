/**
 * GET  /api/cases   list the signed-in user's cases
 * POST /api/cases   create a case
 *
 * Creation is gated by MAX_ACTIVE_CASES. Hitting that limit blocks a NEW case
 * and nothing else: existing cases stay open, readable and editable. Downgrade
 * never deletes data. See docs/BILLING.md section 4.
 */

import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { COUNTRIES } from '@/config/plans';
import { authorize, handler, ok, parseBody, requireUser } from '@/lib/http/api';
import { clientIp, enforceRateLimit } from '@/lib/http/ratelimit';
import { AppError } from '@/lib/errors';
import { createAdminClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const createSchema = z.object({
  title: z.string().trim().min(1).max(200),
  providerName: z.string().trim().max(200).optional(),
  billType: z.string().trim().max(80).optional(),
  amountCents: z.number().int().min(0).max(100_000_000_00).optional(),
  currency: z.enum(['USD', 'CAD']).optional(),
  country: z.enum(COUNTRIES).optional(),
  regionCode: z.string().regex(/^[A-Z]{2}$/).optional(),
  serviceDate: z.string().date().optional(),
  statementDate: z.string().date().optional(),
  accountReference: z.string().trim().max(120).optional(),
});

export const GET = handler('/api/cases', async (_request: NextRequest, context) => {
  const user = await requireUser();
  const admin = createAdminClient();

  // Ownership is filtered explicitly here AND enforced by RLS if this ever runs
  // under a user-scoped client. Two independent layers.
  const { data, error } = await admin
    .from('cases')
    .select(
      'id, title, provider_name, bill_type, amount_cents, currency, status, ' +
        'service_date, statement_date, created_at, updated_at, archived_at',
    )
    .eq('user_id', user.id)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(200);

  if (error !== null) {
    throw new AppError('INTERNAL', 'We could not load your cases.', {
      detail: error.code,
    });
  }

  return ok(context, { cases: data ?? [] });
});

export const POST = handler('/api/cases', async (request: NextRequest, context) => {
  const user = await requireUser();
  enforceRateLimit('GENERAL', { userId: user.id, ip: clientIp(request.headers) });

  const body = await parseBody(request, createSchema);

  // Throws ENTITLEMENT_DENIED with reason LIMIT_REACHED and an honest message
  // naming the plan limit and what stays available.
  const decision = await authorize(user, {
    feature: 'MAX_ACTIVE_CASES',
    action: 'create',
    amount: 1,
  });

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('cases')
    .insert({
      user_id: user.id,
      title: body.title,
      provider_name: body.providerName ?? null,
      bill_type: body.billType ?? null,
      amount_cents: body.amountCents ?? null,
      currency: body.currency ?? null,
      country: body.country ?? 'US',
      region_code: body.regionCode ?? null,
      service_date: body.serviceDate ?? null,
      statement_date: body.statementDate ?? null,
      account_reference: body.accountReference ?? null,
    })
    .select('id, title, status, created_at')
    .single();

  if (error !== null || data === null) {
    throw new AppError('INTERNAL', 'We could not create that case.', {
      detail: error?.code,
    });
  }

  // The timeline only ever carries verified or user-provided events.
  await admin.from('case_events').insert({
    case_id: (data as { id: string }).id,
    user_id: user.id,
    event_type: 'CASE_CREATED',
    title: 'Case created',
    origin: 'SYSTEM',
  });

  return ok(
    context,
    { case: data, remainingCases: decision.remaining },
    201,
  );
});
