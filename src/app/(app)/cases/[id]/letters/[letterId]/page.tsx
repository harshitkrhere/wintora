/**
 * /cases/{id}/letters/{letterId} — one letter: read, edit, confirm, download.
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { requireUser } from '@/lib/http/api';
import { createAdminClient } from '@/lib/supabase/server';
import { loadOwnedLetter } from '@/lib/letters/service';
import { buildSubscriptionSummary } from '@/lib/billing/summary';
import { LetterReview } from '@/components/LetterReview';
import { DISCLAIMERS } from '@/config/disclaimers';

export const metadata: Metadata = { title: 'Letter', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

export default async function LetterPage({
  params,
}: {
  params: Promise<{ id: string; letterId: string }>;
}): Promise<React.ReactElement> {
  const { id, letterId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id) || !/^[0-9a-f-]{36}$/i.test(letterId)) notFound();

  let user;
  try {
    user = await requireUser();
  } catch {
    redirect(`/signin?next=${encodeURIComponent(`/cases/${id}/letters/${letterId}`)}`);
  }

  const admin = createAdminClient();
  let row;
  try {
    row = await loadOwnedLetter(admin, user.id, letterId);
  } catch {
    notFound();
  }
  if (row.case_id !== id) notFound();

  const [{ data: caseRow }, plan] = await Promise.all([
    admin.from('cases').select('title').eq('id', id).eq('user_id', user.id).maybeSingle(),
    buildSubscriptionSummary(admin, user.id),
  ]);
  const caseTitle = (caseRow as { title: string } | null)?.title ?? 'Case';

  return (
    <div className="shell stack--lg page">
      <div className="page-head">
        <div className="page-head__text">
          <p className="eyebrow">
            <Link href="/cases">Cases</Link> · <Link href={`/cases/${id}`}>{caseTitle}</Link> · Letter
          </p>
          <h1>{row.title}</h1>
          <p className="lede">
            Read every line and change anything. When it says what you mean, confirm it, and this
            page walks you through sending it yourself and what to expect after.
          </p>
        </div>
        <div className="page-head__actions">
          <Link href={`/cases/${id}/letters/new`} className="btn btn--secondary">
            Write another
          </Link>
        </div>
      </div>

      <LetterReview
        letter={{
          id: row.id,
          caseId: row.case_id,
          title: row.title,
          content: row.content,
          status: row.status,
          confirmedAt: row.user_confirmed_at,
          sentAt: row.sent_at,
          sentVia: row.sent_via,
          sentTo: row.sent_to,
          attachments: row.attachments,
        }}
        confirmation={DISCLAIMERS.LETTER_FINALIZE}
        canRemind={plan.features.REMINDERS === true}
      />

      <p className="notice">{DISCLAIMERS.LETTER_DRAFT}</p>
    </div>
  );
}
