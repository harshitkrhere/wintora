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
import { dateTomorrowEmail, unsentLetterEmail } from '@/domain/email/messages';
import { NUDGE_AFTER_DAYS, nudgeEligible, nudgeKey } from '@/domain/email/nudge';
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

  // The one unprompted message: a case with a document, no letter sent, and
  // nothing happening for three days. Once per case, ever, by its log key.
  const nudged = await sendUnsentLetterNudges(admin, appUrl, now);

  // Anything queued while no provider was configured, or that failed fewer
  // than three times this week, gets another go.
  const retried = await retryPending(admin);

  return ok(context, { sent, failed, datesSent, nudged, retried, provider: sender.name, more: due.length === BATCH_SIZE });
});

/**
 * Cases eligible for the unsent-letter message, and the message to each.
 * Candidates are narrowed in the database first (open, older than the
 * quiet period); the rule itself is decided by nudgeEligible() from what the
 * case holds, so the same code is what the tests exercise.
 */
async function sendUnsentLetterNudges(
  admin: ReturnType<typeof createAdminClient>,
  appUrl: string,
  now: Date,
): Promise<{ sent: number; skipped: number }> {
  const cutoff = new Date(now.getTime() - NUDGE_AFTER_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { data: candidates } = await admin
    .from('cases')
    .select('id, user_id, status, updated_at')
    .eq('status', 'OPEN')
    .is('deleted_at', null)
    .lte('updated_at', cutoff)
    .order('updated_at', { ascending: true })
    .limit(BATCH_SIZE);
  const cases = (candidates ?? []) as { id: string; user_id: string; status: string; updated_at: string }[];
  if (cases.length === 0) return { sent: 0, skipped: 0 };
  const ids = cases.map((c) => c.id);

  const [{ data: docs }, { data: letters }] = await Promise.all([
    admin.from('documents').select('case_id').in('case_id', ids).eq('scan_status', 'CLEAN').is('deleted_at', null),
    admin.from('generated_documents').select('case_id').in('case_id', ids).not('sent_at', 'is', null).is('deleted_at', null),
  ]);
  const docCount = new Map<string, number>();
  for (const d of (docs ?? []) as { case_id: string }[]) docCount.set(d.case_id, (docCount.get(d.case_id) ?? 0) + 1);
  const sentCount = new Map<string, number>();
  for (const l of (letters ?? []) as { case_id: string }[]) sentCount.set(l.case_id, (sentCount.get(l.case_id) ?? 0) + 1);

  let sent = 0;
  let skipped = 0;
  for (const c of cases) {
    const documentCount = docCount.get(c.id) ?? 0;
    if (documentCount === 0 || (sentCount.get(c.id) ?? 0) > 0) {
      skipped += 1;
      continue;
    }
    // The last thing that happened on the case, from its timeline.
    const { data: last } = await admin
      .from('case_events')
      .select('occurred_at')
      .eq('case_id', c.id)
      .order('occurred_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    const eligible = nudgeEligible(
      {
        status: c.status,
        documentCount,
        sentLetterCount: sentCount.get(c.id) ?? 0,
        lastEventAt: (last as { occurred_at: string } | null)?.occurred_at ?? null,
        updatedAt: c.updated_at,
      },
      now,
    );
    if (!eligible) {
      skipped += 1;
      continue;
    }
    const outcome = await notifyAccount(admin, {
      userId: c.user_id,
      kind: 'UNSENT_LETTER',
      key: nudgeKey(c.id),
      message: unsentLetterEmail({ appUrl, caseId: c.id, documentCount }),
    });
    if (outcome === 'sent') sent += 1;
    else skipped += 1;
  }
  return { sent, skipped };
}

// Vercel's scheduler calls cron routes with GET and the same bearer header.
export const GET = POST;
