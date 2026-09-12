/**
 * /dashboard — where a signed-in person lands.
 *
 * One thing to do, the cases they have, and a single quiet line about the
 * plan. Everything else is a click away and does not need to be here.
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { buildSubscriptionSummary } from '@/lib/billing/summary';
import { listCases } from '@/lib/cases/load';
import { createAdminClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/http/api';
import { CaseCard } from '@/components/CaseCard';
import { EmptyState } from '@/components/EmptyState';

export const metadata: Metadata = { title: 'Dashboard', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

export default async function DashboardPage(): Promise<React.ReactElement> {
  let user;
  try {
    user = await requireUser();
  } catch {
    redirect('/signin?next=%2Fdashboard');
  }

  const admin = createAdminClient();
  const [summary, cases] = await Promise.all([
    buildSubscriptionSummary(admin, user.id),
    listCases(admin, user.id),
  ]);

  const open = cases.filter((c) => c.status === 'OPEN');
  const quota = summary.usage.filter((u) =>
    ['MONTHLY_DOCUMENTS', 'MONTHLY_ANALYSES', 'MAX_ACTIVE_CASES'].includes(u.featureKey),
  );

  return (
    <div className="shell stack--lg page">
      <div className="page-head">
        <div className="page-head__text">
          <h1 style={{ marginBottom: '0.35rem' }}>
            {open.length > 0
              ? `${open.length} open case${open.length === 1 ? '' : 's'}`
              : cases.length === 0
                ? 'Check a bill'
                : 'Your cases'}
          </h1>
          <p className="lede" style={{ margin: 0 }}>
            {open.length > 0
              ? 'Pick up where you left off, or start a new one.'
              : cases.length === 0
                ? 'Upload a PDF or a photo. You confirm the figures; the engine checks the arithmetic.'
                : 'Nothing needs your attention right now.'}
          </p>
        </div>
        <Link href="/upload" className="btn btn--primary btn--lg">
          Upload a bill
        </Link>
      </div>

      {open.length > 0 ? (
        <section className="stack">
          {open.slice(0, 5).map((c) => (
            <CaseCard key={c.id} summary={c} />
          ))}
          {cases.length > 5 || cases.length > open.length ? (
            <p className="small" style={{ margin: 0 }}>
              <Link href="/cases">All cases</Link>
            </p>
          ) : null}
        </section>
      ) : cases.length === 0 ? (
        // A brand-new account: nothing has ever been here. Say what the
        // product does and what will happen, once.
        <EmptyState
          title="Nothing here yet, and that is fine"
          body="Wintora checks the arithmetic on a medical bill. Upload one and this is what happens:"
          steps={[
            'We read the figures from the PDF or photo.',
            'You confirm every number. Nothing runs on a guess.',
            'The check shows what adds up and what does not, with the numbers behind it.',
          ]}
          action={{ href: '/upload', label: 'Upload your first bill' }}
          secondary={{ href: '/medical-bill-checker', label: 'Or type the figures in' }}
        />
      ) : (
        // Someone who has used the product and closed everything. They know
        // how it works; a tutorial here would be condescending.
        <EmptyState
          compact
          title="All caught up"
          body={`No open cases. Your ${cases.length} closed case${cases.length === 1 ? ' is' : 's are'} kept and can be reopened at any time.`}
          action={{ href: '/upload', label: 'Upload a new bill' }}
          secondary={{ href: '/cases', label: 'See closed cases' }}
        />
      )}

      <section>
        <div className="stat-row">
          <span>
            <strong>{summary.planDisplayName}</strong> plan
          </span>
          {quota.map((q) =>
            q.limit === null ? null : (
              <span key={q.featureKey}>
                <strong>{q.remaining ?? 0}</strong> of {q.limit} {q.label.toLowerCase()}
              </span>
            ),
          )}
          <Link href="/settings/subscription" className="small">
            Manage
          </Link>
        </div>
      </section>
    </div>
  );
}
