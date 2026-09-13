/**
 * /cases/{id}/dates — the reminders set and the deadlines entered for
 * this bill: a list a person acts on, apart from the read-only record of
 * what happened (activity). The case is loaded under the session user id;
 * a foreign or unknown id is a 404.
 */

import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { requireUser } from '@/lib/http/api';
import { createAdminClient } from '@/lib/supabase/server';
import { loadCase } from '@/lib/cases/load';
import { buildSubscriptionSummary } from '@/lib/billing/summary';
import { isConfigured } from '@/lib/env';
import { CaseDates } from '@/components/CaseDates';
import { CaseHeader } from '@/components/CaseHeader';

export const metadata: Metadata = { title: 'Dates', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

export default async function CaseDatesPage({ params }: { params: Promise<{ id: string }> }): Promise<React.ReactElement> {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  let user;
  try {
    user = await requireUser();
  } catch {
    redirect(`/signin?next=${encodeURIComponent(`/cases/${id}/dates`)}`);
  }

  const admin = createAdminClient();
  const [detail, plan] = await Promise.all([loadCase(admin, user.id, id), buildSubscriptionSummary(admin, user.id)]);
  if (detail === null) notFound();
  const { summary, reminders, deadlines } = detail;

  return (
    <div className="shell stack--lg page">
      <CaseHeader
        caseId={summary.id}
        caseTitle={summary.title}
        title="Dates"
        lede="Reminders you set and dates you entered. A reminder is yours; a deadline says where it came from."
      />
      <CaseDates
        caseId={summary.id}
        reminders={reminders}
        deadlines={deadlines}
        can={{ reminders: plan.features.REMINDERS === true, deadlines: plan.features.DEADLINE_TRACKING === true }}
        emailOn={isConfigured('email')}
      />
    </div>
  );
}
