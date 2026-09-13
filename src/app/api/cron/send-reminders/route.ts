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
import { publicEnv } from '@/lib/env';
import { getEmailSender } from '@/lib/email';
import { handler, ok } from '@/lib/http/api';
import { assertCronAuthorized } from '@/lib/http/cron';
import { log } from '@/lib/logging';
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

  // One address lookup per account, not per reminder.
  const emailByUser = new Map<string, string | null>();
  let sent = 0;
  let failed = 0;

  for (const reminder of due) {
    if (!emailByUser.has(reminder.user_id)) {
      const { data: userData } = await admin.auth.admin.getUserById(reminder.user_id);
      emailByUser.set(reminder.user_id, userData?.user?.email ?? null);
    }
    const to = emailByUser.get(reminder.user_id) ?? null;
    if (to === null || reminder.case_id === null) {
      // Nowhere to send it. Mark it so it is not retried forever; the case
      // page still shows it as due.
      await admin.from('reminders').update({ notified_at: now.toISOString() }).eq('id', reminder.id);
      continue;
    }

    try {
      await sender.send({ to, ...reminderEmail({ appUrl, caseId: reminder.case_id }) });
      await admin.from('reminders').update({ notified_at: now.toISOString() }).eq('id', reminder.id);
      sent += 1;
    } catch (error) {
      failed += 1;
      log.warn('reminder not sent', {
        route: '/api/cron/send-reminders',
        errorClass: error instanceof Error ? error.name : 'UnknownError',
      });
    }
  }

  return ok(context, { sent, failed, provider: sender.name, more: due.length === BATCH_SIZE });
});

// Vercel's scheduler calls cron routes with GET and the same bearer header.
export const GET = POST;
