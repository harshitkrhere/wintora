/**
 * POST /api/cron/send-reminders
 *
 * Sends the reminders that have come due. Runs hourly; a reminder set for
 * 09:00 goes out on the first run after 09:00.
 *
 * Without an email provider this route sends nothing and leaves notified_at
 * empty, and the reminder still appears as due on the case and the home page:
 * the in-app view is the feature, the email is the nudge. With a provider, the
 * message names nothing from the case; it links to it.
 */

import { type NextRequest } from 'next/server';
import { reminderEmail } from '@/domain/reminders/notice';
import { dateTomorrowEmail } from '@/domain/email/messages';
import { notifyAccount, retryPending } from '@/lib/email/account';
import { publicEnv } from '@/lib/env';
import { getEmailSender } from '@/lib/email';
import { handler, ok } from '@/lib/http/api';
import { assertCronAuthorized } from '@/lib/http/cron';
import { createAdminClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BATCH_SIZE = 200;

export const POST = handler('/api/cron/send-reminders', async (request: NextRequest, context) => {
  assertCronAuthorized(request);

  const sender = getEmailSender();
  if (sender === null) {
    return ok(context, { sent: 0, skipped: 'EMAIL_PROVIDER is none' });
  }

  const admin = createAdminClient();
  const now = new Date();
  const appUrl = publicEnv().NEXT_PUBLIC_APP_URL;

  const { data } = await admin
    .from('reminders')
    .select('id, user_id, case_id, remind_at')
    .is('completed_at', null)
    .is('notified_at', null)
    .lte('remind_at', now.toISOString())
    .order('remind_at', { ascending: true })
    .limit(BATCH_SIZE);

  const due = (data ?? []) as { id: string; user_id: string; case_id: string | null; remind_at: string }[];

  let sent = 0;
  let failed = 0;

  for (const reminder of due) {
    if (reminder.case_id === null) {
      // Nowhere to link to. Mark it so it is not retried forever; the case
      // page still shows it as due.
      await admin.from('reminders').update({ notified_at: now.toISOString() }).eq('id', reminder.id);
      continue;
    }
    // Logged in email_log under the reminder's own key; a re-run finds the
    // row and stops. The reminder is marked once the message has a row,
    // whatever became of it, because the log is where "what became of it"
    // lives now.
    const outcome = await notifyAccount(admin, {
      userId: reminder.user_id,
      kind: 'REMINDER_DUE',
      key: `email_reminder_${reminder.id}`,
      message: reminderEmail({ appUrl, caseId: reminder.case_id }),
    });
    if (outcome === 'failed') {
      failed += 1;
      continue;
    }
    await admin.from('reminders').update({ notified_at: now.toISOString() }).eq('id', reminder.id);
    if (outcome === 'sent') sent += 1;
  }

  // Dates the customer entered that fall tomorrow (UTC). One message per
  // date, keyed on the row, so a re-run does not repeat it.
  const tomorrow = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1))
    .toISOString()
    .slice(0, 10);
  const { data: dates } = await admin
    .from('deadlines')
    .select('id, user_id, case_id')
    .is('completed_at', null)
    .is('notified_at', null)
    .eq('due_date', tomorrow)
    .limit(BATCH_SIZE);

  let datesSent = 0;
  for (const d of (dates ?? []) as { id: string; user_id: string; case_id: string }[]) {
    const outcome = await notifyAccount(admin, {
      userId: d.user_id,
      kind: 'DATE_TOMORROW',
      key: `email_date_${d.id}`,
      message: dateTomorrowEmail({ appUrl, caseId: d.case_id }),
    });
    if (outcome === 'sent' || outcome === 'duplicate' || outcome === 'no_address') {
      await admin.from('deadlines').update({ notified_at: now.toISOString() }).eq('id', d.id);
      if (outcome === 'sent') datesSent += 1;
    }
  }

  // Anything queued while no provider was configured, or that failed fewer
  // than three times this week, gets another go.
  const retried = await retryPending(admin);

  return ok(context, { sent, failed, datesSent, retried, provider: sender.name, more: due.length === BATCH_SIZE });
});

// Vercel's scheduler calls cron routes with GET and the same bearer header.
export const GET = POST;
