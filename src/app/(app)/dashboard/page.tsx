/**
 * /dashboard — where a signed-in person lands.
 *
 * The heading is always "Home", so the landmark never moves. Beneath it: one
 * line about where things stand, the one thing to do, and the cases: open
 * ones if there are any, otherwise the closed ones. Plan and allowance live
 * on the subscription page, one link away.
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { listCases } from '@/lib/cases/load';
import { loadUpcoming } from '@/lib/cases/upcoming';
import { createAdminClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/http/api';
import { daysUntil } from '@/domain/reminders/notice';
import { CaseCard } from '@/components/CaseCard';
import { EmptyState } from '@/components/EmptyState';
import { Icon } from '@/components/Icons';

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
  const cases = await listCases(admin, user.id);
  const open = cases.filter((c) => c.status === 'OPEN');
  const now = new Date();
  const coming = await loadUpcoming(admin, user.id, open, now);
  const closedCases = cases.filter((c) => c.status !== 'OPEN');
  const closed = closedCases.length;

  const status =
    cases.length === 0
      ? 'No cases yet. Upload a bill to start one.'
      : open.length === 0
        ? `Nothing open. ${plural(closed, 'closed case')}, kept and ready to reopen.`
        : `${plural(open.length, 'open case')}${closed > 0 ? `, ${closed} closed` : ''}.`;

  return (
    <div className="shell stack--lg page">
      <div className="page-head">
        <div className="page-head__text">
          <h1>Home</h1>
          <p className="lede">{status}</p>
        </div>
        <Link href="/upload" className="btn btn--primary btn--lg">
          <Icon name="upload" />
          Upload a bill
        </Link>
      </div>

      {coming.length > 0 ? (
        <section className="card stack" aria-labelledby="coming-heading">
          <div className="section-head">
            <h2 id="coming-heading">Coming up</h2>
            <span className="caption">Reminders you set and dates you entered</span>
          </div>
          <ul className="upcoming">
            {coming.slice(0, 8).map((item) => {
              const rel = relativeDay(item.at, item.kind, now);
              return (
                <li key={item.id}>
                  <span className={`upcoming__when${rel.overdue ? ' upcoming__when--overdue' : ''}`}>{rel.text}</span>
                  <span>
                    <Link href={`/cases/${item.caseId}`}>{item.label}</Link>
                    <span className="muted"> · {item.caseTitle}</span>
                    {item.verified ? <span className="badge badge--success"> Verified</span> : null}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {open.length > 0 ? (
        <section className="stack">
          <div className="section-head">
            <h2>Open cases</h2>
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
        <EmptyState
          title="Upload your first bill"
          body="Wintora reads the figures, you confirm every number, and the check shows what adds up and what does not, with the numbers behind it."
          action={{ href: '/upload', label: 'Upload a bill' }}
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

      <p className="caption m-0">
        <Link href="/settings/subscription">Your plan and what is left this period</Link>
      </p>
    </div>
  );
}
