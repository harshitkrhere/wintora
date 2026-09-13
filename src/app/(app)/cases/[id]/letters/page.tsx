/**
 * /cases/{id}/letters — the requests written about this bill, as cards,
 * newest first, and the way to write another. The case is loaded under
 * the session's user id; a foreign or unknown id is a 404, the same as a
 * missing one.
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { requireUser } from '@/lib/http/api';
import { createAdminClient } from '@/lib/supabase/server';
import { loadCase } from '@/lib/cases/load';
import { buildSubscriptionSummary } from '@/lib/billing/summary';
import { ActionBar } from '@/components/ActionBar';
import { CaseHeader } from '@/components/CaseHeader';
import { EmptyState } from '@/components/EmptyState';
import { Icon } from '@/components/Icons';
import { dateTime, letterStatus } from '@/components/documentStatus';

export const metadata: Metadata = { title: 'Letters', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

export default async function CaseLettersPage({ params }: { params: Promise<{ id: string }> }): Promise<React.ReactElement> {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  let user;
  try {
    user = await requireUser();
  } catch {
    redirect(`/signin?next=${encodeURIComponent(`/cases/${id}/letters`)}`);
  }

  const admin = createAdminClient();
  const [detail, plan] = await Promise.all([loadCase(admin, user.id, id), buildSubscriptionSummary(admin, user.id)]);
  if (detail === null) notFound();
  const { summary, letters } = detail;
  const canWrite = plan.features.LETTER_GENERATION === true;

  return (
    <div className="shell stack--lg page">
      <CaseHeader
        caseId={summary.id}
        caseTitle={summary.title}
        title="Letters"
        lede="Wintora prepares drafts. You read, change and send them yourself; nothing goes anywhere without you."
      />

      {letters.length === 0 ? (
        <EmptyState
          compact
          title="No letters yet"
          body={
            canWrite
              ? 'Ask for an itemized statement, question a charge, request a payment plan. A draft from a reviewed template, filled with your facts, for you to check and send.'
              : 'Request letters are part of every plan once you are signed in with a case. Your plan does not currently include them.'
          }
          action={canWrite ? { href: `/cases/${summary.id}/letters/new`, label: 'Write a letter' } : { href: '/pricing', label: 'See plans' }}
        />
      ) : (
        <div className="doc-list">
          {letters.map((l) => {
            const status = letterStatus(l.status, l.sentAt);
            return (
              <Link key={l.id} href={`/cases/${summary.id}/letters/${l.id}`} className="doc-card">
                <Icon name="mail" className="doc-card__icon" />
                <span className="doc-card__body">
                  <span className="doc-card__name">{l.title}</span>
                  <span className="doc-card__meta">
                    {l.sentAt !== null
                      ? `Sent ${new Date(l.sentAt).toLocaleDateString('en-US', { dateStyle: 'medium', timeZone: 'UTC' })}${l.sentVia ? ` · ${l.sentVia === 'portal' ? 'patient portal' : l.sentVia}` : ''}`
                      : `Last changed ${dateTime(l.updatedAt)}`}
                    {l.attachmentCount > 0 ? ` · ${l.attachmentCount} item${l.attachmentCount === 1 ? '' : 's'} of evidence` : ''}
                  </span>
                </span>
                <span className="doc-card__end">
                  <span className={`badge ${status.tone}`}>{status.label}</span>
                  <Icon name="chevron-right" className="row-link__chevron" />
                </span>
              </Link>
            );
          })}
        </div>
      )}

      {canWrite && letters.length > 0 ? (
        <ActionBar>
          <Link href={`/cases/${summary.id}/letters/new`} className="btn btn--primary btn--lg">
            <Icon name="mail" />
            Write another letter
          </Link>
        </ActionBar>
      ) : null}
    </div>
  );
}
