/**
 * /dashboard — where a signed-in person lands.
 *
 * The heading is always "Home", so the landmark never moves. Beneath it: one
 * line about where things stand, the one thing to do, and the open cases.
 * Plan and allowance live on the subscription page, one link away.
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { listCases } from '@/lib/cases/load';
import { createAdminClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/http/api';
import { CaseCard } from '@/components/CaseCard';
import { EmptyState } from '@/components/EmptyState';
import { Icon } from '@/components/Icons';

export const metadata: Metadata = { title: 'Home', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

export default async function DashboardPage(): Promise<React.ReactElement> {
  let user;
  try {
    user = await requireUser();
  } catch {
    redirect('/signin?next=%2Fdashboard');
  }

  const cases = await listCases(createAdminClient(), user.id);
  const open = cases.filter((c) => c.status === 'OPEN');
  const closed = cases.length - open.length;

  const status =
    cases.length === 0
      ? 'No cases yet. Upload a bill to start one.'
      : open.length === 0
        ? `Nothing open. ${plural(closed, 'closed case')} kept and ready to reopen.`
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
        <EmptyState
          compact
          title="All caught up"
          body="No open cases. Closed cases are kept and can be reopened from their page at any time."
          action={{ href: '/upload', label: 'Upload a new bill' }}
          secondary={{ href: '/cases', label: 'See closed cases' }}
        />
      )}

      <p className="caption m-0">
        <Link href="/settings/subscription">Your plan and what is left this period</Link>
      </p>
    </div>
  );
}
