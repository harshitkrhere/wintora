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
import { loadCase, type CaseAnalysis, type CaseEvent } from '@/lib/cases/load';
import { suggestedActions } from '@/domain/analysis/engine';
import type { AnalysisResult } from '@/domain/analysis/types';
import { FindingCard } from '@/components/FindingCard';
import { NextSteps, type Step } from '@/components/NextSteps';
import { CaseStatusButton } from '@/components/CaseStatusButton';
import { money } from '@/components/CaseCard';
import { EmptyState } from '@/components/EmptyState';
import { Icon } from '@/components/Icons';

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

const SCAN_TONE: Record<string, string> = {
  CLEAN: 'badge--success',
  PENDING: 'badge--neutral',
  INFECTED: 'badge--error',
  FAILED: 'badge--warning',
  SKIPPED: 'badge--neutral',
};

const TYPE_LABEL: Record<string, string> = {
  BILL_CONSISTENCY: 'Bill check',
  BILL_VS_EOB: 'Bill compared with EOB',
};

/**
 * The checklist for a case: the engine's suggested actions for the latest
 * check, each marked done or not by the customer's own timeline entries
 * (newest first, so the first STEP_* event for a step is the current state).
 * Returns an empty list when there is nothing to chase.
 */
function checklistFor(analysis: CaseAnalysis, events: readonly CaseEvent[]): Step[] {
  const codes = new Set(analysis.findings.map((f) => f.code));
  if (codes.has('NO_ISSUES_FOUND')) return [];

  // suggestedActions reads only the findings and the analysis type; the rest
  // of the result is not stored and is not needed.
  const shape: AnalysisResult = {
    engineVersion: analysis.engineVersion,
    analysisType: analysis.analysisType === 'BILL_VS_EOB' ? 'BILL_VS_EOB' : 'BILL_CONSISTENCY',
    findings: analysis.findings,
    checksRun: [],
    summary: { lineItemCount: 0, totalChargesCents: null, currency: 'USD', attention: 0, review: 0, info: 0 },
  };
  const actions = suggestedActions(shape, { savedToCase: true });
  if (actions.every((a) => a.startsWith('Nothing to chase'))) return [];

  return actions.map((text) => {
    const last = events.find(
      (e) => (e.eventType === 'STEP_DONE' || e.eventType === 'STEP_REOPENED') && e.detail === text,
    );
    return { text, done: last?.eventType === 'STEP_DONE' };
  });
}

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
  const latest = completed[0];
  const steps = latest !== undefined ? checklistFor(latest, events) : null;
  const amount = money(summary.amountCents, summary.currency);
  const isOpen = summary.status === 'OPEN';

  return (
    <div className="shell stack--lg page">
      <div className="page-head">
        <div className="page-head__text">
          <p className="eyebrow">
            <Link href="/cases">Cases</Link> · Case
          </p>
          <h1 className="page__title">
            {summary.title}
            <span className={`badge ${isOpen ? 'badge--success' : 'badge--neutral'} badge--dot`}>
              {isOpen ? 'Open' : 'Closed'}
            </span>
          </h1>
          {summary.providerName || amount || summary.statementDate ? (
            <p className="meta">
              {summary.providerName ? (
                <span className="meta__item">
                  <Icon name="document" />
                  {summary.providerName}
                </span>
              ) : null}
              {amount ? (
                <span className="meta__item">
                  <Icon name="receipt" />
                  {amount}
                </span>
              ) : null}
              {summary.statementDate ? (
                <span className="meta__item">
                  <Icon name="calendar" />
                  Statement {summary.statementDate}
                </span>
              ) : null}
            </p>
          ) : (
            <p className="muted m-0">Add details by uploading the bill.</p>
          )}
        </div>
        <div className="page-head__actions">
          <Link href={`/upload?case=${summary.id}`} className="btn btn--primary">
            <Icon name="upload" />
            Upload a document
          </Link>
          <CaseStatusButton caseId={summary.id} status={summary.status} />
        </div>
      </div>

      {/* --------------------------------------------------- next steps */}
      {steps !== null ? (
        steps.length > 0 ? (
          <NextSteps caseId={summary.id} steps={steps} />
        ) : (
          <p className="notice notice--success">
            Nothing to chase on this statement. Keep it on the case in case a later bill or an
            EOB disagrees with it.
          </p>
        )
      ) : null}

      {/* ------------------------------------------------------- checks */}
      <section className="stack">
        <div className="section-head">
          <h2>Checks</h2>
          <span className="section-head__count">{completed.length}</span>
        </div>
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
            <details key={a.id} className="card accordion" open={i === 0}>
              <summary>
                <span className="accordion__title">
                  <span>{TYPE_LABEL[a.analysisType] ?? a.analysisType}</span>
                  <span className="accordion__sub">
                    {when(a.completedAt ?? a.createdAt)} · {a.findings.length} finding{a.findings.length === 1 ? '' : 's'}
                  </span>
                </span>
              </summary>
              <div className="accordion__body stack">
                {a.findings.map((f, j) => (
                  <FindingCard key={j} finding={f} />
                ))}
                <p className="caption m-0">
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
        <div className="section-head">
          <h2>Documents</h2>
          <span className="section-head__count">{documents.length}</span>
        </div>
        {documents.length === 0 ? (
          <EmptyState
            compact
            title="Nothing uploaded yet"
            body="A PDF from a patient portal reads best. A clear photo of a paper bill also works."
            action={{ href: `/upload?case=${summary.id}`, label: 'Upload a document' }}
          />
        ) : (
          <div className="table-scroll table--responsive">
            <table>
              <thead>
                <tr>
                  <th scope="col">File</th>
                  <th scope="col">Status</th>
                  <th scope="col">Uploaded</th>
                  <th scope="col">Kept until</th>
                </tr>
              </thead>
              <tbody>
                {documents.map((d) => (
                  <tr key={d.id}>
                    <td data-label="File">
                      <span>
                        <strong>{d.filename ?? 'Document'}</strong>
                        <span className="cell-sub">
                          {d.mimeType.replace('application/', '').replace('image/', '').toUpperCase()} · {bytes(d.byteSize)}
                          {d.pageCount !== null ? ` · ${d.pageCount} page${d.pageCount === 1 ? '' : 's'}` : ''}
                        </span>
                      </span>
                    </td>
                    <td data-label="Status">
                      <span>
                        <span className={`badge ${SCAN_TONE[d.scanStatus] ?? 'badge--neutral'}`}>
                          {SCAN_LABEL[d.scanStatus] ?? d.scanStatus}
                        </span>
                        {d.scanStatus === 'CLEAN' ? (
                          <span className="cell-sub">
                            {d.extractionStatus === 'COMPLETED' ? 'Figures read' : d.extractionStatus === 'FAILED' ? 'Could not be read' : 'Not read yet'}
                          </span>
                        ) : null}
                      </span>
                    </td>
                    <td data-label="Uploaded" className="small">{when(d.createdAt)}</td>
                    <td data-label="Kept until" className="small muted">
                      {d.retentionUntil ? new Date(d.retentionUntil).toLocaleDateString('en-US', { dateStyle: 'medium' }) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="caption m-0">
          Documents are deleted automatically on the date shown, set by your plan. Nothing is
          deleted because a plan changes; you are told first.
        </p>
      </section>

      {/* ----------------------------------------------------- timeline */}
      <section className="stack">
        <div className="section-head">
          <h2>Timeline</h2>
        </div>
        <div className="card">
          <ol className="timeline">
            {events.map((e) => (
              <li key={e.id}>
                <span className="timeline__when">{when(e.occurredAt)}</span>
                <span>
                  <span className="timeline__event">{e.title}</span>
                  {e.detail ? <span className="muted"> — {e.detail}</span> : null}
                  {e.origin === 'USER' ? <span className="muted"> · you</span> : null}
                </span>
              </li>
            ))}
          </ol>
        </div>
        <p className="caption m-0">
          Only things that actually happened appear here. No reminders or deadlines are
          invented.
        </p>
      </section>
    </div>
  );
}
