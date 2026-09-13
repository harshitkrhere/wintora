/**
 * /dashboard — where a signed-in person lands.
 *
 * The heading is always "Home", so the landmark never moves. Beneath it,
 * in order: the one thing to do next (from the case's real rows, so a
 * person never has to remember where they left off), the cases, three
 * quick ways in, the documents that arrived most recently, and the dates
 * that are coming up. Plan and allowance live on the subscription page,
 * one link away. This is not a dashboard; it is the next step and the
 * way to it.
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { listCases } from '@/lib/cases/load';
import { pickHomeStep } from '@/lib/cases/next-step';
import { loadUpcoming } from '@/lib/cases/upcoming';
import { listDocuments } from '@/lib/documents/list';
import { createAdminClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/http/api';
import { daysUntil } from '@/domain/reminders/notice';
import { documentTypeLabel } from '@/domain/documents/types';
import { CaseCard } from '@/components/CaseCard';
import { EmptyState } from '@/components/EmptyState';
import { Icon } from '@/components/Icons';
import { NextStepCard } from '@/components/NextStepCard';
import { fileSummary, shortDate } from '@/components/documentStatus';

export const metadata: Metadata = { title: 'Home', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** "Today", "Tomorrow", "In 3 days", "2 days ago", or the date. */
function relativeDay(at: string, kind: 'reminder' | 'deadline', now: Date): { text: string; overdue: boolean } {
  const day = kind === 'deadline' ? at : new Date(at).toISOString().slice(0, 10);
  const days = daysUntil(day, now);
  if (days === 0) return { text: 'Today', overdue: kind === 'reminder' && Date.parse(at) <= now.getTime() };
  if (days === 1) return { text: 'Tomorrow', overdue: false };
  if (days < 0) return { text: `${plural(-days, 'day')} ago`, overdue: true };
  return { text: `In ${plural(days, 'day')}`, overdue: false };
}

export default async function DashboardPage(): Promise<React.ReactElement> {
  let user;
  try {
    user = await requireUser();
  } catch {
    redirect('/signin?next=%2Fdashboard');
  }

  const admin = createAdminClient();
  const now = new Date();
  const [cases, recent] = await Promise.all([listCases(admin, user.id), listDocuments(admin, user.id, { limit: 3 })]);
  const open = cases.filter((c) => c.status === 'OPEN');
  const coming = await loadUpcoming(admin, user.id, open, now);
  const closedCases = cases.filter((c) => c.status !== 'OPEN');
  const closed = closedCases.length;
  const next = pickHomeStep(cases, now);

  const status =
    cases.length === 0
      ? 'No cases yet. Review a bill to start one.'
      : open.length === 0
        ? `Nothing open. ${plural(closed, 'closed case')}, kept and ready to reopen.`
        : `${plural(open.length, 'open case')}${closed > 0 ? `, ${closed} closed` : ''}.`;

  const requestHref = open.length === 1 ? `/cases/${open[0]!.id}/letters/new` : '/cases';

  return (
    <div className="shell stack--lg page">
      <div className="page-head">
        <div className="page-head__text">
          <h1>Home</h1>
          <p className="lede">{status}</p>
        </div>
        {/* On a phone the tab bar's Review is this action; the button is for the sidebar layout. */}
        <Link href="/upload?type=BILL" className="btn btn--primary btn--lg hide-narrow">
          <Icon name="upload" />
          Review a bill
        </Link>
      </div>

      {next !== null ? (
        <NextStepCard
          eyebrow={next.resumed ? 'Continue where you left off' : 'Your next step'}
          caseTitle={next.caseSummary.title}
          label={next.step.label}
          hint={next.step.hint}
          action={{ href: next.step.href, label: next.step.label }}
        />
      ) : open.length > 0 ? (
        <NextStepCard
          tone="quiet"
          eyebrow="Your next step"
          label="Nothing waiting on you"
          hint="Every open case is checked and every draft has gone. Review a new document when one arrives."
        />
      ) : null}

      {open.length > 0 ? (
        <section className="stack">
          <div className="section-head">
            <h2>Your cases</h2>
            {cases.length > open.length || open.length > 5 ? (
              <Link href="/cases" className="small">
                All cases
              </Link>
            ) : null}
          </div>
          <div className="case-list">
            {open.slice(0, 5).map((c) => (
              <CaseCard key={c.id} summary={c} />
            ))}
          </div>
        </section>
      ) : cases.length === 0 ? (
        // The only checklist there is. It lives in the empty state, so it
        // exists exactly as long as there is nothing else to show: the moment
        // the first case appears, the case page's own next steps take over.
        <EmptyState
          title="Review your first bill"
          body="Wintora reads the figures, you confirm every number, and the check shows what adds up and what does not, with the numbers behind it. From there:"
          steps={[
            'Upload the bill, the itemized one if you have it',
            'Add the insurer’s EOB for the same care, if you have one',
            'Read the findings and the numbers behind each',
            'Send the request to the billing office',
          ]}
          action={{ href: '/upload?type=BILL', label: 'Review a bill' }}
          secondary={{ href: '/medical-bill-checker', label: 'Or type the figures in' }}
        />
      ) : (
        // Nothing open, so the closed cases are the cases. Showing them here
        // beats a sentence saying they exist; the lede has already said so.
        <section className="stack">
          <div className="section-head">
            <h2>Closed cases</h2>
            {closed > 5 ? (
              <Link href="/cases" className="small">
                All cases
              </Link>
            ) : null}
          </div>
          <div className="case-list">
            {closedCases.slice(0, 5).map((c) => (
              <CaseCard key={c.id} summary={c} />
            ))}
          </div>
        </section>
      )}

      {cases.length > 0 ? (
        <section className="stack" aria-labelledby="tools-heading">
          <div className="section-head">
            <h2 id="tools-heading">Quick tools</h2>
          </div>
          <div className="row-list">
            <Link href="/upload?type=BILL" className="row-link">
              <Icon name="receipt" className="row-link__icon" />
              <span className="row-link__text">
                Review a bill
                <span className="row-link__sub">Upload it, confirm the figures, run the check</span>
              </span>
              <Icon name="chevron-right" className="row-link__chevron" />
            </Link>
            <Link href="/upload?type=EOB" className="row-link">
              <Icon name="shield" className="row-link__icon" />
              <span className="row-link__text">
                Review an EOB
                <span className="row-link__sub">Set the insurer’s figures against the bill</span>
              </span>
              <Icon name="chevron-right" className="row-link__chevron" />
            </Link>
            {open.length > 0 ? (
              <Link href={requestHref} className="row-link">
                <Icon name="mail" className="row-link__icon" />
                <span className="row-link__text">
                  Prepare a request
                  <span className="row-link__sub">A letter from a reviewed template, with your facts</span>
                </span>
                <Icon name="chevron-right" className="row-link__chevron" />
              </Link>
            ) : null}
          </div>
        </section>
      ) : null}

      {recent.length > 0 ? (
        <section className="stack" aria-labelledby="recent-heading">
          <div className="section-head">
            <h2 id="recent-heading">Recent documents</h2>
            <Link href="/documents" className="small">
              All documents
            </Link>
          </div>
          <div className="doc-list">
            {recent.map((d) => (
              <Link key={d.id} href={`/cases/${d.caseId}`} className="doc-card">
                <Icon name="document" className="doc-card__icon" />
                <span className="doc-card__body">
                  <span className="doc-card__name">{d.filename ?? 'Document'}</span>
                  <span className="doc-card__meta">
                    {documentTypeLabel(d.documentType)} · {fileSummary(d.mimeType, d.pageCount)} · {shortDate(d.createdAt)}
                  </span>
                </span>
                <Icon name="chevron-right" className="row-link__chevron" />
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {coming.length > 0 ? (
        <section className="card stack" aria-labelledby="coming-heading">
          <div className="section-head">
            <h2 id="coming-heading">Coming up</h2>
            <span className="small muted">Reminders you set and dates you entered</span>
          </div>
          <ul className="upcoming">
            {coming.slice(0, 8).map((item) => {
              const rel = relativeDay(item.at, item.kind, now);
              return (
                <li key={item.id}>
                  <span className={`upcoming__when${rel.overdue ? ' upcoming__when--overdue' : ''}`}>{rel.text}</span>
                  <span>
                    <Link href={`/cases/${item.caseId}/dates`}>{item.label}</Link>
                    <span className="muted"> · {item.caseTitle}</span>
                    {item.verified ? <span className="badge badge--success"> Verified</span> : null}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <p className="small m-0">
        <Link href="/settings/subscription">Your plan and what is left this period</Link>
      </p>
    </div>
  );
}
