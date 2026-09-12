/**
 * POST /api/tools/bill-check
 *
 * The anonymous free tool. No account for the first few checks.
 *
 * Someone holding a confusing bill at 11pm gets an answer, not a registration
 * form. After POLICY.anonymousTool.freeChecks answers, the wall appears: an
 * account, which is free and needs no card, and which is what they create to
 * KEEP the answers. That is a much easier thing to ask for once the tool has
 * already been useful. See docs/SEO.md section 1.
 *
 * Signed-in users are never capped here; their allowance is their plan's.
 *
 * Nothing is stored. The figures are analysed in the request and discarded.
 */

import { cookies } from 'next/headers';
import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { DISCLAIMERS } from '@/config/disclaimers';
import { POLICY } from '@/config/policy';
import { AppError } from '@/lib/errors';
import { FREE_CHECKS_COOKIE, freeChecksCookie, readFreeChecks } from '@/lib/http/tool-quota';
import { createUserClient, getCurrentUser } from '@/lib/supabase/server';
import {
  analyzeBill,
  analyzeBillAgainstEob,
  headline,
  suggestedActions,
} from '@/domain/analysis/engine';
import type { BillDocument, EobDocument } from '@/domain/analysis/types';
import { handler, ok, parseBody } from '@/lib/http/api';
import { clientIp, enforceRateLimit } from '@/lib/http/ratelimit';
import { billDocumentSchema, eobDocumentSchema } from '@/lib/http/schemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  bill: billDocumentSchema,
  eob: eobDocumentSchema.optional(),
});

export const POST = handler('/api/tools/bill-check', async (request: NextRequest, context) => {
  // No account, so the IP limit is the only bound. It is deliberately generous:
  // the point of this route is that a stressed person gets an answer.
  enforceRateLimit('PUBLIC_TOOL', { ip: clientIp(request.headers) });

  const body = await parseBody(request, bodySchema);

  // Signed in? Then this is just a convenience path and no anonymous cap
  // applies. Otherwise count this browser's free checks.
  const cookieStore = await cookies();
  const user = await getCurrentUser(
    createUserClient({
      get: (name) => cookieStore.get(name),
      set: (name, value, options) => {
        cookieStore.set(name, value, options);
      },
    }),
  );

  const limit = POLICY.anonymousTool.freeChecks;
  let used = 0;
  if (user === null) {
    used = readFreeChecks(cookieStore.get(FREE_CHECKS_COOKIE)?.value);
    if (used >= limit) {
      throw new AppError(
        'ENTITLEMENT_DENIED',
        `You have used the ${limit} free checks. Create a free account to keep going; it needs no card.`,
        { reason: 'ANONYMOUS_LIMIT', detail: 'anonymous tool limit', meta: { limit, used } },
      );
    }
  }

  // The same deterministic engine every paid tier runs. A free user is never
  // given a deliberately degraded or misleading result to manufacture an
  // upgrade: what they get less of is volume and workflow, not truth.
  const result =
    body.eob !== undefined
      ? analyzeBillAgainstEob(body.bill as BillDocument, body.eob as EobDocument)
      : analyzeBill(body.bill as BillDocument);

  // Count it only after a successful analysis. A rejected input is not a
  // spent check.
  let anonymous: { used: number; limit: number; remaining: number } | null = null;
  if (user === null) {
    used += 1;
    const cookie = freeChecksCookie(used);
    cookieStore.set(cookie.name, cookie.value, cookie.options);
    anonymous = { used, limit, remaining: Math.max(limit - used, 0) };
  }

  return ok(context, {
    analysis: result,
    headline: headline(result),
    nextSteps: suggestedActions(result),
    disclaimer:
      body.eob !== undefined ? DISCLAIMERS.EOB_COMPARISON : DISCLAIMERS.PUBLIC_TOOL,
    // Stated plainly rather than buried: this ran and vanished.
    storage: {
      stored: false,
      note: 'Nothing you entered was saved. Create a free account if you want to keep this.',
    },
    anonymous,
  });
});

/**
 * GET /api/tools/bill-check
 *
 * How many free checks this browser has left, and whether a session makes the
 * question moot. The page that hosts the tool is static and the count lives in
 * an httpOnly cookie, so the tool asks here once it has loaded, instead of
 * discovering the answer by being refused. Reading the allowance never spends
 * it, and nothing is stored.
 */
export const GET = handler('/api/tools/bill-check', async (request: NextRequest, context) => {
  enforceRateLimit('GENERAL', { ip: clientIp(request.headers) });

  const cookieStore = await cookies();
  const user = await getCurrentUser(
    createUserClient({
      get: (name) => cookieStore.get(name),
      set: (name, value, options) => {
        cookieStore.set(name, value, options);
      },
    }),
  );

  const limit = POLICY.anonymousTool.freeChecks;
  if (user !== null) {
    return ok(context, { signedIn: true, limit, used: 0, remaining: null });
  }
  const used = readFreeChecks(cookieStore.get(FREE_CHECKS_COOKIE)?.value);
  return ok(context, { signedIn: false, limit, used, remaining: Math.max(limit - used, 0) });
});
