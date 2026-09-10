/**
 * GET /api/entitlements
 *
 * The entitlement snapshot the client uses to render gates.
 *
 * DISPLAY ONLY. Nothing here authorizes anything. Every privileged operation
 * re-checks server-side inside the same transaction that consumes the quota, so
 * a tampered snapshot in the browser buys nothing at all.
 * See docs/ENTITLEMENTS.md section 6.
 */

import { type NextRequest } from 'next/server';
import { handler, ok, requireUser } from '@/lib/http/api';
import { createAdminClient } from '@/lib/supabase/server';
import { buildSubscriptionSummary } from '@/lib/billing/summary';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = handler('/api/entitlements', async (_request: NextRequest, context) => {
  const user = await requireUser();
  const summary = await buildSubscriptionSummary(createAdminClient(), user.id);
  return ok(context, summary);
});
