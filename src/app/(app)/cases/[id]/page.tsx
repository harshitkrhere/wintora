/**
 * /cases/{id} — one bill, as an overview: what it is, how much, the one
 * thing to do next, what the latest check found, the checklist, and the
 * way to everything else about it (letters, documents, dates, activity),
 * each on its own screen.
 *
 * The first screenful on a phone answers what is this, how much, and what
 * do I do; the action bar under the thumb carries that one action, and
 * the More button the quieter ones. On a wide screen the side column
 * holds the rows and the header holds the buttons, as before.
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
import { loadCase, type CaseAnalysis } from '@/lib/cases/load';
import { actionForFinding, checklistFor } from '@/lib/cases/next-step';
import { ActionBar } from '@/components/ActionBar';
import { CaseMenu } from '@/components/CaseMenu';
import { CaseMember } from '@/components/CaseMember';
import { CaseStatusButton } from '@/components/CaseStatusButton';
import { FindingCard } from '@/components/FindingCard';
import { NextSteps } from '@/components/NextSteps';
import { NextStepCard } from '@/components/NextStepCard';
import { money } from '@/components/CaseCard';
import { EmptyState } from '@/components/EmptyState';
import { Icon } from '@/components/Icons';
import { dateTime, shortDate } from '@/components/documentStatus';
import { buildSubscriptionSummary } from '@/lib/billing/summary';

export const metadata: Metadata = { title: 'Case', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

const TYPE_LABEL: Record<string, string> = {
  BILL_CONSISTENCY: 'Bill check',
  BILL_VS_EOB: 'Bill compared with EOB',
};

/** "2 things worth a closer look", "1 thing worth confirming", "Looks consistent". */
function headline(analysis: CaseAnalysis): string {
  const attention = analysis.findings.filter((f) => f.severity === 'ATTENTION').length;
  const review = analysis.findings.filter((f) => f.severity === 'REVIEW').length;
  if (attention > 0) return `${attention} thing${attention === 1 ? '' : 's'} worth a closer look`;
  if (review > 0) return `${review} thing${review === 1 ? '' : 's'} worth confirming`;
  return 'Looks consistent';
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

  const { summary, documents, analyses, events, letters, reminders, deadlines, member } = detail;
  const completed = analyses.filter((a) => a.status === 'COMPLETED');
  const latest = completed[0];
  const earlier = completed.slice(1);
  const steps = latest !== undefined ? checklistFor(latest, events) : null;
  const amount = money(summary.amountCents, summary.currency);
  const isOpen = summary.status === 'OPEN';
  const next = summary.nextStep;
  const can = {
    letters: plan.features.LETTER_GENERATION === true,
    export: plan.features.ADVANCED_EXPORT === true,
  };
  const openDates = reminders.filter((r) => r.completedAt === null).length + deadlines.filter((d) => d.completedAt === null).length;
  const lastEvent = events[0];

  return (
    <div className="shell stack--lg page">
      <div className="page-head">
        <div className="page-head__text">
          <Link href="/cases" className="backlink">
            <Icon name="chevron-left" />
            Cases
          </Link>
          <h1 className="page__title">
            {summary.title}
            <span className={`badge ${isOpen ? 'badge--success' : 'badge--neutral'} badge--dot`}>
              {isOpen ? 'Open' : 'Closed'}
            </span>
          </h1>
          <p className="meta">
            {summary.providerName ? (
              <span className="meta__item">
                <Icon name="document" />
                {summary.providerName}
              </span>
            ) : (
              <span className="muted">Add details by uploading the bill.</span>
            )}
            <CaseMember caseId={summary.id} current={member} enabled={plan.features.HOUSEHOLD_CASES === true} />
          </p>
        </div>
        <div className="page-head__actions hide-narrow">
          <Link href={`/upload?case=${summary.id}`} className="btn btn--primary">
            <Icon name="upload" />
            Add a document
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

      <div className="case-overview">
        <div className="case-overview__main">
          {/* ------------------------------------------------ how much */}
          <section className="amount" aria-label="Bill total">
            <span className="amount__value">{amount ?? '—'}</span>
            <span className="amount__label">
              {amount !== null ? 'Bill total' : 'No amount yet'}
              {summary.statementDate ? ` · Statement ${summary.statementDate}` : ''}
              {summary.accountReference ? ` · Account ${summary.accountReference}` : ''}
            </span>
          </section>

          {/* ------------------------------------------------ what to do */}
          {isOpen ? (
            next !== null ? (
              <NextStepCard eyebrow="Your next step" label={next.label} hint={next.hint} />
            ) : (
              <NextStepCard
                tone="quiet"
                eyebrow="Your next step"
                label="Nothing waiting on you"
                hint="Every document is checked and every draft has gone. Add a document if another arrives."
              />
            )
          ) : (
            <NextStepCard
              tone="quiet"
              eyebrow="Status"
              label="This case is closed"
              hint="Everything on it is kept. Reopen it if a new bill or an EOB disagrees with it."
            />
          )}

          {/* ------------------------------------------------ the latest check */}
          {latest === undefined ? (
            <EmptyState
              compact
              title="No checks yet"
              body={
                documents.length === 0
                  ? 'Upload the bill, confirm the figures it reads, and the check runs from there.'
                  : 'A document is here. Check its figures and the check runs from there.'
              }
              action={next !== null ? { href: next.href, label: next.label } : { href: `/upload?case=${summary.id}`, label: 'Add a document' }}
            />
          ) : (
            <section className="stack" aria-labelledby="latest-heading">
              <div className="latest-check__head">
                <h2 id="latest-heading">{headline(latest)}</h2>
                <span className="latest-check__when">
                  {TYPE_LABEL[latest.analysisType] ?? latest.analysisType} · {shortDate(latest.completedAt ?? latest.createdAt)}
                </span>
              </div>
              {latest.findings.map((f, j) => (
                <FindingCard key={j} finding={f} action={isOpen && can.letters ? actionForFinding(f.code, summary.id) : null} />
              ))}
              <p className="small muted m-0">
                Engine {latest.engineVersion}. These checks compare what is printed. They cannot tell you whether a
                charge was appropriate or what your insurer will decide.
              </p>
            </section>
          )}

          {/* ------------------------------------------------ the checklist */}
          {steps !== null ? (
            steps.length > 0 ? (
              <NextSteps caseId={summary.id} steps={steps} />
            ) : (
              <p className="notice notice--success">
                Nothing to chase on this statement. Keep it on the case in case a later bill or an EOB disagrees with it.
              </p>
            )
          ) : null}
        </div>

        <div className="case-overview__side">
          {/* ------------------------------------------------ everything else */}
          <nav className="row-list" aria-label="This case">
            <Link href={`/cases/${summary.id}/letters`} className="row-link">
              <Icon name="mail" className="row-link__icon" />
              <span className="row-link__text">Letters</span>
              <span className="row-link__count">{letters.length}</span>
              <Icon name="chevron-right" className="row-link__chevron" />
            </Link>
            <Link href={`/cases/${summary.id}/documents`} className="row-link">
              <Icon name="documents" className="row-link__icon" />
              <span className="row-link__text">Documents</span>
              <span className="row-link__count">{summary.documentCount}</span>
              <Icon name="chevron-right" className="row-link__chevron" />
            </Link>
            <Link href={`/cases/${summary.id}/dates`} className="row-link">
              <Icon name="calendar" className="row-link__icon" />
              <span className="row-link__text">Dates</span>
              <span className="row-link__count">{openDates}</span>
              <Icon name="chevron-right" className="row-link__chevron" />
            </Link>
            <Link href={`/cases/${summary.id}/activity`} className="row-link">
              <Icon name="clock" className="row-link__icon" />
              <span className="row-link__text">
                Activity
                {lastEvent !== undefined ? <span className="row-link__sub">Last: {dateTime(lastEvent.occurredAt)}</span> : null}
              </span>
              <Icon name="chevron-right" className="row-link__chevron" />
            </Link>
          </nav>

          {earlier.length > 0 ? (
            <section className="stack" aria-labelledby="earlier-heading">
              <div className="section-head">
                <h2 id="earlier-heading">Earlier checks</h2>
                <span className="section-head__count">{earlier.length}</span>
              </div>
              {earlier.map((a) => (
                <details key={a.id} className="card accordion">
                  <summary>
                    <span className="accordion__title">
                      <span>{TYPE_LABEL[a.analysisType] ?? a.analysisType}</span>
                      <span className="accordion__sub">
                        {dateTime(a.completedAt ?? a.createdAt)} · {a.findings.length} finding{a.findings.length === 1 ? '' : 's'}
                      </span>
                    </span>
                  </summary>
                  <div className="accordion__body stack">
                    {a.findings.map((f, j) => (
                      <FindingCard key={j} finding={f} />
                    ))}
                  </div>
                </details>
              ))}
            </section>
          ) : null}
        </div>
      </div>

      {/* The one action, under the thumb. The wide screen has the header buttons. */}
      <ActionBar
        className="show-narrow"
        more={<CaseMenu caseId={summary.id} status={summary.status} canLetters={can.letters} canExport={can.export} />}
      >
          {isOpen ? (
            next !== null ? (
              <Link href={next.href} className="btn btn--primary btn--lg">
                {next.label}
                <Icon name="arrow-right" />
              </Link>
            ) : (
              <Link href={`/upload?case=${summary.id}`} className="btn btn--secondary btn--lg">
                Add a document
              </Link>
            )
          ) : (
            <CaseStatusButton caseId={summary.id} status={summary.status} className="btn btn--primary btn--lg" />
          )}
      </ActionBar>
    </div>
  );
}
