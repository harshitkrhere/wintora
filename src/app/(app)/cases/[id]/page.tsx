/**
 * /cases/{id} — one bill: its documents, what the checks found, the letters
 * written about it, the dates it is waiting on, and what happened when.
 *
 * The findings render through the same FindingCard as the free tool, so a
 * saved result looks exactly like it did the moment it was produced. What
 * the plan allows is passed to the client parts for display only; every
 * action re-checks on the server.
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
import { CaseDates } from '@/components/CaseDates';
import { CaseMember } from '@/components/CaseMember';
import { ExportCase } from '@/components/ExportCase';
import { money } from '@/components/CaseCard';
import { EmptyState } from '@/components/EmptyState';
import { Icon } from '@/components/Icons';
import { buildSubscriptionSummary } from '@/lib/billing/summary';
import { isConfigured } from '@/lib/env';

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

  const admin = createAdminClient();
  const [detail, plan] = await Promise.all([loadCase(admin, user.id, id), buildSubscriptionSummary(admin, user.id)]);
  if (detail === null) notFound();

  const { summary, documents, removedDocuments, analyses, events, letters, reminders, deadlines, member } = detail;
  const completed = analyses.filter((a) => a.status === 'COMPLETED');
  const latest = completed[0];
  const steps = latest !== undefined ? checklistFor(latest, events) : null;
  const amount = money(summary.amountCents, summary.currency);
  const isOpen = summary.status === 'OPEN';
  const readDocuments = documents.filter((d) => d.scanStatus === 'CLEAN' && d.extractionStatus === 'COMPLETED');
  const can = {
    letters: plan.features.LETTER_GENERATION === true,
    reminders: plan.features.REMINDERS === true,
    deadlines: plan.features.DEADLINE_TRACKING === true,
    household: plan.features.HOUSEHOLD_CASES === true,
    export: plan.features.ADVANCED_EXPORT === true,
  };
  const exportsLeft = plan.usage.find((u) => u.featureKey === 'MONTHLY_EXPORTS')?.remaining ?? null;

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
              <CaseMember caseId={summary.id} current={member} enabled={can.household} />
            </p>
          ) : (
            <p className="meta">
              <span className="muted">Add details by uploading the bill.</span>
              <CaseMember caseId={summary.id} current={member} enabled={can.household} />
            </p>
          )}
        </div>
        <div className="page-head__actions">
          <Link href={`/upload?case=${summary.id}`} className="btn btn--primary">
            <Icon name="upload" />
            Upload a document
          </Link>
          {can.letters ? (
            <Link href={`/cases/${summary.id}/letters/new`} className="btn btn--secondary">
              <Icon name="mail" />
              Write a letter
            </Link>
          ) : null}
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
          {readDocuments.length >= 2 ? (
            <Link href={`/cases/${summary.id}/compare`} className="small">
              Compare two documents
            </Link>
          ) : null}
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

      {/* ------------------------------------------------------ letters */}
      <section className="stack">
        <div className="section-head">
          <h2>Letters</h2>
          <span className="section-head__count">{letters.length}</span>
          {can.letters && letters.length > 0 ? (
            <Link href={`/cases/${summary.id}/letters/new`} className="small">
              Write another
            </Link>
          ) : null}
        </div>
        {letters.length === 0 ? (
          <EmptyState
            compact
            title="No letters yet"
            body={
              can.letters
                ? 'Ask for an itemised statement, question a charge, request a payment plan. A draft from a reviewed template, filled with your facts, for you to check and send.'
                : 'Request letters are part of every plan once you are signed in with a case. Your plan does not currently include them.'
            }
            action={can.letters ? { href: `/cases/${summary.id}/letters/new`, label: 'Write a letter' } : { href: '/pricing', label: 'See plans' }}
          />
        ) : (
          <div className="table-scroll table--responsive">
            <table>
              <thead>
                <tr>
                  <th scope="col">Letter</th>
                  <th scope="col">Status</th>
                  <th scope="col">Last changed</th>
                </tr>
              </thead>
              <tbody>
                {letters.map((l) => (
                  <tr key={l.id}>
                    <td data-label="Letter">
                      <Link href={`/cases/${summary.id}/letters/${l.id}`}>
                        <strong>{l.title}</strong>
                      </Link>
                      {l.attachmentCount > 0 ? (
                        <span className="cell-sub">
                          {l.attachmentCount} item{l.attachmentCount === 1 ? '' : 's'} of evidence attached
                        </span>
                      ) : null}
                    </td>
                    <td data-label="Status">
                      <span>
                        <span className={`badge ${l.sentAt !== null ? 'badge--success' : l.status === 'FINALIZED' ? 'badge--info' : 'badge--neutral'}`}>
                          {l.sentAt !== null ? 'Sent' : l.status === 'FINALIZED' ? 'Ready to send' : 'Draft'}
                        </span>
                        {l.sentAt !== null ? (
                          <span className="cell-sub">
                            {new Date(l.sentAt).toLocaleDateString('en-US', { dateStyle: 'medium', timeZone: 'UTC' })}
                            {l.sentVia ? ` · ${l.sentVia === 'portal' ? 'patient portal' : l.sentVia}` : ''}
                          </span>
                        ) : null}
                      </span>
                    </td>
                    <td data-label="Last changed" className="small">{when(l.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="caption m-0">
          Wintora prepares drafts. You read, change and send them yourself; nothing goes anywhere
          without you.
        </p>
      </section>

      {/* -------------------------------------------------------- dates */}
      <section className="stack">
        <div className="section-head">
          <h2>Dates</h2>
          <span className="section-head__count">{reminders.filter((r) => r.completedAt === null).length + deadlines.filter((d) => d.completedAt === null).length}</span>
        </div>
        <CaseDates
          caseId={summary.id}
          reminders={reminders}
          deadlines={deadlines}
          can={{ reminders: can.reminders, deadlines: can.deadlines }}
          emailOn={isConfigured('email')}
        />
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
        {removedDocuments.length > 0 ? (
          <ul className="x-list small">
            {removedDocuments.map((d) => (
              <li key={d.id}>
                <strong>{d.filename ?? 'Document'}</strong> was removed on{' '}
                {new Date(d.removedAt).toLocaleDateString('en-US', { dateStyle: 'medium' })} at the end of its
                retention period.{' '}
                {d.figuresKept
                  ? 'The figures read from it are kept with this case (extended history).'
                  : 'The figures read from it were removed with it; the checks that used them are unaffected.'}
              </li>
            ))}
          </ul>
        ) : null}
        <p className="caption m-0">
          Documents are deleted automatically on the date shown, set by your plan. Nothing is
          deleted because a plan changes; you are told first.
        </p>
        <ExportCase caseId={summary.id} enabled={can.export} remaining={exportsLeft} hasDocuments={documents.some((d) => d.scanStatus === 'CLEAN')} />
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
          Only things that actually happened appear here: what the product did, and what you told
          it you did. Nothing is invented from a document.
        </p>
      </section>
    </div>
  );
}
