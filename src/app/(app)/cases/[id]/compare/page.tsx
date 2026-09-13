/**
 * /cases/{id}/compare — reconcile two uploaded documents line by line.
 *
 * Both documents have already been read; their drafts pre-fill the two
 * forms and the customer confirms every figure before the check runs. This
 * is ADVANCED_DOCUMENT_ANALYSIS: the same engine as the free comparison,
 * given lines instead of two totals.
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { requireUser } from '@/lib/http/api';
import { createAdminClient } from '@/lib/supabase/server';
import { loadCase } from '@/lib/cases/load';
import { buildSubscriptionSummary } from '@/lib/billing/summary';
import { CompareDocuments, type ReadDocument } from '@/components/CompareDocuments';
import { EmptyState } from '@/components/EmptyState';
import type { ExtractionDraft } from '@/domain/documents/draft';

export const metadata: Metadata = { title: 'Compare documents', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

export default async function ComparePage({ params }: { params: Promise<{ id: string }> }): Promise<React.ReactElement> {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  let user;
  try {
    user = await requireUser();
  } catch {
    redirect(`/signin?next=${encodeURIComponent(`/cases/${id}/compare`)}`);
  }

  const admin = createAdminClient();
  const [detail, summary] = await Promise.all([loadCase(admin, user.id, id), buildSubscriptionSummary(admin, user.id)]);
  if (detail === null) notFound();

  const clean = detail.documents.filter((d) => d.scanStatus === 'CLEAN');
  const ids = clean.map((d) => d.id);

  // The latest draft for each document, in one query.
  const { data: extractions } = ids.length > 0
    ? await admin
        .from('document_extractions')
        .select('document_id, payload, created_at')
        .eq('user_id', user.id)
        .in('document_id', ids)
        .order('created_at', { ascending: false })
    : { data: [] };

  const draftByDoc = new Map<string, ExtractionDraft>();
  for (const row of (extractions ?? []) as { document_id: string; payload: ExtractionDraft }[]) {
    if (!draftByDoc.has(row.document_id)) draftByDoc.set(row.document_id, row.payload);
  }

  const { data: typeRows } = ids.length > 0
    ? await admin.from('documents').select('id, document_type').in('id', ids).eq('user_id', user.id)
    : { data: [] };
  const typeByDoc = new Map(((typeRows ?? []) as { id: string; document_type: string }[]).map((r) => [r.id, r.document_type]));

  const documents: ReadDocument[] = clean.map((d) => ({
    id: d.id,
    filename: d.filename,
    documentType: typeByDoc.get(d.id) ?? 'OTHER',
    draft: draftByDoc.get(d.id) ?? null,
  }));

  const enabled = summary.features.ADVANCED_DOCUMENT_ANALYSIS === true;

  return (
    <div className="shell stack--lg page">
      <div className="page-head">
        <div className="page-head__text">
          <p className="eyebrow">
            <Link href="/cases">Cases</Link> · <Link href={`/cases/${id}`}>{detail.summary.title}</Link> · Compare
          </p>
          <h1>Compare two documents</h1>
          <p className="lede">
            The statement on one side, the explanation of benefits on the other, line by line.
            Both are pre-filled from what was read; check every figure before you run it.
          </p>
        </div>
      </div>

      {documents.length < 2 ? (
        <EmptyState
          title={documents.length === 0 ? 'Nothing to compare yet' : 'One more document is needed'}
          body="Comparing needs the statement and the explanation of benefits both uploaded to this case. Upload the missing one and come back."
          action={{ href: `/upload?case=${id}`, label: 'Upload a document' }}
          secondary={{ href: `/cases/${id}`, label: 'Back to the case' }}
        />
      ) : (
        <CompareDocuments caseId={id} documents={documents} enabled={enabled} />
      )}
    </div>
  );
}
