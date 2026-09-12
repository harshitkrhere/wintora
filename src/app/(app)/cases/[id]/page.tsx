/**
 * /cases/{id} — one bill: its documents, what the checks found, and what
 * happened when.
 *
 * Everything on this page is read from tables that already existed. The
 * findings render through the same FindingCard as the free tool, so a saved
 * result looks exactly like it did the moment it was produced.
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { requireUser } from '@/lib/http/api';
import { createAdminClient } from '@/lib/supabase/server';
import { loadCase } from '@/lib/cases/load';
import { FindingCard } from '@/components/FindingCard';
import { CaseStatusButton } from '@/components/CaseStatusButton';
import { money } from '@/components/CaseCard';
import { EmptyState } from '@/components/EmptyState';

export const metadata: Metadata = { title: 'Case', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

function when(iso: string): string {
  return new Date(iso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
}

function bytes(n: number): string {
  return n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
}

const SCAN_LABEL: Record<string, string> = {
  CLEAN: 'Checked',
  PENDING: 'Waiting to be checked',
  INFECTED: 'Refused',
  FAILED: 'Could not be checked',
  SKIPPED: 'Not checked',
};

const TYPE_LABEL: Record<string, string> = {
  BILL_CONSISTENCY: 'Bill check',
  BILL_VS_EOB: 'Bill compared with EOB',
};

export default async function CasePage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.ReactElement> {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  let user;
  try {
    user = await requireUser();
  } catch {
    redirect(`/signin?next=${encodeURIComponent(`/cases/${id}`)}`);
  }

  const detail = await loadCase(createAdminClient(), user.id, id);
  if (detail === null) notFound();

  const { summary, documents, analyses, events } = detail;
  const completed = analyses.filter((a) => a.status === 'COMPLETED');
  const amount = money(summary.amountCents, summary.currency);

  return (
    <div className="shell stack--lg" style={{ paddingTop: '2rem', paddingBottom: '3rem' }}>
      <div>
        <p className="eyebrow">
          <Link href="/cases">Cases</Link> · {summary.status === 'OPEN' ? 'Open' : 'Closed'}
        </p>
        <h1 style={{ marginBottom: '0.25rem' }}>{summary.title}</h1>
        <p className="muted" style={{ margin: 0 }}>
          {[summary.providerName, amount, summary.statementDate ? `Statement ${summary.statementDate}` : null]
            .filter(Boolean)
            .join(' · ') || 'Add details by uploading the bill.'}
        </p>
      </div>

      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
        <Link href={`/upload?case=${summary.id}`} className="btn btn--primary">
          Upload a document
        </Link>
        <CaseStatusButton caseId={summary.id} status={summary.status} />
      </div>

      {/* ------------------------------------------------------- checks */}
      <section className="stack">
        <h2 style={{ fontSize: '1.1rem', margin: 0 }}>
          Checks ({completed.length})
        </h2>
        {completed.length === 0 ? (
          <EmptyState
            compact
            title="No checks yet"
            body={
              documents.length === 0
                ? 'Upload the bill, confirm the figures it reads, and the check runs from there.'
                : 'A document is here. Open it from the upload page, confirm the figures, and run the check.'
            }
            action={{ href: `/upload?case=${summary.id}`, label: documents.length === 0 ? 'Upload the bill' : 'Check a document' }}
          />
        ) : (
          completed.map((a, i) => (
            <details key={a.id} className="card" open={i === 0}>
              <summary style={{ cursor: 'pointer' }}>
                <strong>{TYPE_LABEL[a.analysisType] ?? a.analysisType}</strong>
                <span className="muted small"> · {when(a.completedAt ?? a.createdAt)} · {a.findings.length} finding{a.findings.length === 1 ? '' : 's'}</span>
              </summary>
              <div className="stack" style={{ marginTop: '1rem' }}>
                {a.findings.map((f, j) => (
                  <FindingCard key={j} finding={f} />
                ))}
                <p className="small muted" style={{ margin: 0 }}>
                  Engine {a.engineVersion}. These checks compare what is printed. They cannot
                  tell you whether a charge was appropriate or what your insurer will decide.
                </p>
              </div>
            </details>
          ))
        )}
      </section>

      {/* ---------------------------------------------------- documents */}
      <section className="stack">
        <h2 style={{ fontSize: '1.1rem', margin: 0 }}>Documents ({documents.length})</h2>
        {documents.length === 0 ? (
          <EmptyState
            compact
            title="Nothing uploaded yet"
            body="A PDF from a patient portal reads best. A clear photo of a paper bill also works."
            action={{ href: `/upload?case=${summary.id}`, label: 'Upload a document' }}
          />
        ) : (
          <div className="card" style={{ padding: 0 }}>
            <table className="table" style={{ width: '100%' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left' }}>File</th>
                  <th style={{ textAlign: 'left' }}>Status</th>
                  <th style={{ textAlign: 'left' }}>Uploaded</th>
                  <th style={{ textAlign: 'left' }}>Kept until</th>
                </tr>
              </thead>
              <tbody>
                {documents.map((d) => (
                  <tr key={d.id}>
                    <td>
                      {d.filename ?? 'Document'}
                      <span className="muted small" style={{ display: 'block' }}>
                        {d.mimeType.replace('application/', '').replace('image/', '').toUpperCase()} · {bytes(d.byteSize)}
                        {d.pageCount !== null ? ` · ${d.pageCount} page${d.pageCount === 1 ? '' : 's'}` : ''}
                      </span>
                    </td>
                    <td>
                      {SCAN_LABEL[d.scanStatus] ?? d.scanStatus}
                      {d.scanStatus === 'CLEAN' ? (
                        <span className="muted small" style={{ display: 'block' }}>
                          {d.extractionStatus === 'COMPLETED' ? 'Figures read' : d.extractionStatus === 'FAILED' ? 'Could not be read' : 'Not read yet'}
                        </span>
                      ) : null}
                    </td>
                    <td className="small">{when(d.createdAt)}</td>
                    <td className="small muted">
                      {d.retentionUntil ? new Date(d.retentionUntil).toLocaleDateString('en-US', { dateStyle: 'medium' }) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="small muted" style={{ margin: 0 }}>
          Documents are deleted automatically on the date shown, set by your plan. Nothing is
          deleted because a plan changes; you are told first.
        </p>
      </section>

      {/* ----------------------------------------------------- timeline */}
      <section className="stack">
        <h2 style={{ fontSize: '1.1rem', margin: 0 }}>Timeline</h2>
        <ol className="stack" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {events.map((e) => (
            <li key={e.id} className="small" style={{ display: 'flex', gap: '1rem' }}>
              <span className="muted" style={{ minWidth: '11rem' }}>{when(e.occurredAt)}</span>
              <span>
                {e.title}
                {e.detail ? <span className="muted"> — {e.detail}</span> : null}
                {e.origin === 'USER' ? <span className="muted"> · you</span> : null}
              </span>
            </li>
          ))}
        </ol>
        <p className="small muted" style={{ margin: 0 }}>
          Only things that actually happened appear here. No reminders or deadlines are
          invented.
        </p>
      </section>
    </div>
  );
}
