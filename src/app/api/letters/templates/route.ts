/**
 * GET /api/letters/templates
 *
 * The published template library, with the fields each template needs, and
 * whether this account's plan can render the premium ones. Every template is
 * listed for everyone: a customer can see what the library holds before
 * deciding whether it is worth paying for, and the server still refuses to
 * render a premium template for a plan that does not include it.
 */

import { type NextRequest } from 'next/server';
import { handler, ok, requireUser } from '@/lib/http/api';
import { buildSubscriptionSummary } from '@/lib/billing/summary';
import { createAdminClient } from '@/lib/supabase/server';
import { listPublishedTemplates } from '@/lib/letters/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = handler('/api/letters/templates', async (_request: NextRequest, context) => {
  const user = await requireUser();
  const admin = createAdminClient();
  const [templates, summary] = await Promise.all([
    listPublishedTemplates(admin),
    buildSubscriptionSummary(admin, user.id),
  ]);

  return ok(context, {
    templates: templates.map((t) => ({
      key: t.key,
      name: t.name,
      description: t.description,
      category: t.category,
      fields: t.fields,
      isPremium: t.isPremium,
    })),
    // DISPLAY ONLY. The POST re-checks every one of these.
    can: {
      letters: summary.features.LETTER_GENERATION === true,
      premiumTemplates: summary.features.PREMIUM_TEMPLATES === true,
      evidence: summary.features.ADVANCED_LETTERS === true,
    },
    plan: summary.plan,
  });
});
