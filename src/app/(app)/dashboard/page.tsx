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
    <div className="shell stack--lg" style={{ paddingTop: '2.5rem', paddingBottom: '4rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'end', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 style={{ marginBottom: '0.35rem' }}>
            {open.length === 0 ? 'Check a bill' : `${open.length} open case${open.length === 1 ? '' : 's'}`}
          </h1>
          <p className="lede" style={{ margin: 0 }}>
            {open.length === 0
              ? 'Upload a PDF or a photo. You confirm the figures; the engine checks the arithmetic.'
              : 'Pick up where you left off, or start a new one.'}
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
      ) : (
        <section className="card" style={{ background: 'var(--surface-sunken)', border: 'none' }}>
          <p style={{ margin: 0 }}>
            No cases yet. Your first upload creates one. Prefer to type the figures in?{' '}
            <Link href="/medical-bill-checker">Use the bill checker</Link> — it works without saving anything.
          </p>
        </section>
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
