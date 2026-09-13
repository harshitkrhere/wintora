/**
 * /cases/{id}/documents — everything given to this case, as cards: kept
 * documents with their kind and whether their figures were read, and the
 * uploads that were refused, failed or never finished, marked and not
 * counted. Removed documents are named. Export lives here. The file
 * itself is not opened; a reader is a later phase.
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { requireUser } from '@/lib/http/api';
import { createAdminClient } from '@/lib/supabase/server';
import { loadCase } from '@/lib/cases/load';
import { buildSubscriptionSummary } from '@/lib/billing/summary';
import { ActionBar } from '@/components/ActionBar';
import { CaseDocumentsList } from '@/components/CaseDocumentsList';
import { CaseHeader } from '@/components/CaseHeader';
import { EmptyState } from '@/components/EmptyState';
import { ExportCase } from '@/components/ExportCase';
import { Icon } from '@/components/Icons';

export const metadata: Metadata = { title: 'Documents', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

export default async function CaseDocumentsPage({ params }: { params: Promise<{ id: string }> }): Promise<React.ReactElement> {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  let user;
  try {
    user = await requireUser();
  } catch {
    redirect(`/signin?next=${encodeURIComponent(`/cases/${id}/documents`)}`);
  }

  const admin = createAdminClient();
  const [detail, plan] = await Promise.all([loadCase(admin, user.id, id), buildSubscriptionSummary(admin, user.id)]);
  if (detail === null) notFound();
  const { summary, documents, removedDocuments } = detail;
  const next = summary.nextStep;
  const checkDocumentId =
    next !== null && next.key === 'check-figures' ? (new URL(next.href, 'https://wintora.online').searchParams.get('document') ?? null) : null;
  const exportsLeft = plan.usage.find((u) => u.featureKey === 'MONTHLY_EXPORTS')?.remaining ?? null;

  return (
    <div className="shell stack--lg page">
      <CaseHeader
        caseId={summary.id}
        caseTitle={summary.title}
        title="Documents"
        lede="Documents are deleted automatically on the date shown, set by your plan. Nothing is deleted because a plan changes; you are told first."
      />

      {documents.length === 0 ? (
        <EmptyState
          compact
          title="Nothing uploaded yet"
          body="A PDF from a patient portal reads best. A clear photo of a paper bill also works."
          action={{ href: `/upload?case=${summary.id}`, label: 'Add a document' }}
        />
      ) : (
        <CaseDocumentsList
          caseId={summary.id}
          caseTitle={summary.title}
          documents={documents}
          checkHref={checkDocumentId !== null && next !== null ? next.href : null}
          checkDocumentId={checkDocumentId}
        />
      )}

      {removedDocuments.length > 0 ? (
        <ul className="x-list small">
          {removedDocuments.map((d) => (
            <li key={d.id}>
              <strong>{d.filename ?? 'Document'}</strong> was removed on{' '}
              {new Date(d.removedAt).toLocaleDateString('en-US', { dateStyle: 'medium' })} at the end of its retention
              period.{' '}
              {d.figuresKept
                ? 'The figures read from it are kept with this case (extended history).'
                : 'The figures read from it were removed with it; the checks that used them are unaffected.'}
            </li>
          ))}
        </ul>
      ) : null}

      <div id="export">
        <ExportCase
          caseId={summary.id}
          enabled={plan.features.ADVANCED_EXPORT === true}
          remaining={exportsLeft}
          hasDocuments={documents.some((d) => d.scanStatus === 'CLEAN')}
        />
      </div>

      {documents.length > 0 ? (
        <ActionBar>
          <Link href={`/upload?case=${summary.id}`} className="btn btn--primary btn--lg">
            <Icon name="upload" />
            Add a document
          </Link>
        </ActionBar>
      ) : null}
    </div>
  );
}
