/**
 * POST /api/tools/bill-check
 *
 * The anonymous free tool. No account, no signup wall.
 *
 * Someone holding a confusing bill at 11pm gets an answer, not a registration
 * form. The account is what they create to KEEP the answer, which is a much
 * easier thing to ask for. See docs/SEO.md section 1.
 *
 * Nothing is stored. The figures are analysed in the request and discarded.
 */

import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { DISCLAIMERS } from '@/config/disclaimers';
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

  // The same deterministic engine every paid tier runs. A free user is never
  // given a deliberately degraded or misleading result to manufacture an
  // upgrade: what they get less of is volume and workflow, not truth.
  const result =
    body.eob !== undefined
      ? analyzeBillAgainstEob(body.bill as BillDocument, body.eob as EobDocument)
      : analyzeBill(body.bill as BillDocument);

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
  });
});
