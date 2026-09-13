/**
 * POST /api/cron/send-renewal-reminders
 *
 * The annual renewal notice. Several US states require that a subscription
 * of a year or more is preceded by a reminder, sent 15 to 45 days before it
 * renews, stating that it will renew, when, for how much, and how to cancel.
 * California is the strictest; this sends 30 days out, which satisfies all
 * of them, and once per period, keyed on the subscription and the renewal
 * date, so a re-run cannot repeat it.
 *
 * Monthly plans are not covered by those statutes and get no reminder: a
 * monthly email saying "you will be charged monthly" is noise.
 */

import { type NextRequest } from 'next/server';
import { renewalReminderEmail } from '@/domain/email/messages';
import { PLANS, formatPrice, isPlanSlug, type CurrencyCode } from '@/config/plans';
import { publicEnv } from '@/lib/env';
import { notifyAccount } from '@/lib/email/account';
import { handler, ok } from '@/lib/http/api';
import { assertCronAuthorized } from '@/lib/http/cron';
import { createAdminClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Send when the renewal is this many days away or fewer... */
const WINDOW_DAYS = 30;
/** ...but not once it is closer than this: too late to be a fair notice. */
const MIN_DAYS = 15;
const BATCH_SIZE = 200;

export const POST = handler('/api/cron/send-renewal-reminders', async (request: NextRequest, context) => {
  assertCronAuthorized(request);

  const admin = createAdminClient();
  const now = new Date();
  const appUrl = publicEnv().NEXT_PUBLIC_APP_URL;
  const from = new Date(now.getTime() + MIN_DAYS * DAY_MS).toISOString();
  const to = new Date(now.getTime() + WINDOW_DAYS * DAY_MS).toISOString();

  const { data } = await admin
    .from('subscriptions')
    .select('id, user_id, provider_subscription_id, current_period_end, amount_cents, currency, plans!subscriptions_plan_id_fkey(slug)')
    .eq('billing_interval', 'year')
    .eq('status', 'ACTIVE')
    .eq('cancel_at_period_end', false)
    .gte('current_period_end', from)
    .lte('current_period_end', to)
    .limit(BATCH_SIZE);

  let sent = 0;
  let already = 0;
  for (const row of (data ?? []) as unknown as {
    id: string; user_id: string; provider_subscription_id: string | null; current_period_end: string;
    amount_cents: number; currency: string; plans: { slug: string } | null;
  }[]) {
    const slug = row.plans?.slug;
    const planName = slug !== undefined && isPlanSlug(slug) ? PLANS[slug].displayName : 'paid';
    const renewsOn = new Date(row.current_period_end);
    const outcome = await notifyAccount(admin, {
      userId: row.user_id,
      kind: 'RENEWAL_REMINDER',
      key: `email_renewal_${row.provider_subscription_id ?? row.id}_${row.current_period_end.slice(0, 10)}`,
      message: renewalReminderEmail({
        appUrl,
        planName,
        renewsOn,
        priceFormatted: formatPrice(row.amount_cents, (row.currency === 'CAD' ? 'CAD' : 'USD') as CurrencyCode),
      }),
    });
    if (outcome === 'sent') sent += 1;
    if (outcome === 'duplicate') already += 1;
  }

  return ok(context, { sent, already, considered: (data ?? []).length });
});

// Vercel's scheduler calls cron routes with GET and the same bearer header.
export const GET = POST;
