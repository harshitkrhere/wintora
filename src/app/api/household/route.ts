/**
 * GET /api/household
 *
 * The people on this account, for the "who is this bill for" picker, plus
 * the plan's limit so the picker can say when a new name would need a larger
 * plan. Display only: the PUT on the case re-checks.
 */

import { type NextRequest } from 'next/server';
import { handler, ok, requireUser } from '@/lib/http/api';
import { buildSubscriptionSummary } from '@/lib/billing/summary';
import { createAdminClient } from '@/lib/supabase/server';
import { listHousehold } from '@/lib/cases/household';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = handler('/api/household', async (_request: NextRequest, context) => {
  const user = await requireUser();
  const admin = createAdminClient();
  const [members, summary] = await Promise.all([
    listHousehold(admin, user.id),
    buildSubscriptionSummary(admin, user.id),
  ]);
  const limitLine = summary.benefits.find((b) => b.key === 'HOUSEHOLD_MEMBERS');
  return ok(context, {
    members,
    enabled: summary.features.HOUSEHOLD_CASES === true,
    limit: limitLine?.limit ?? null,
    plan: summary.plan,
  });
});
