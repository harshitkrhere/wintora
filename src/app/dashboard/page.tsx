/**
 * /dashboard
 *
 * Where sign-in lands. Deliberately minimal for now: it proves the session
 * exists and routes onward. The case list and document workspace are not built
 * yet, and this says so rather than showing an empty shell that looks broken.
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { buildSubscriptionSummary } from '@/lib/billing/summary';
import { createAdminClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/http/api';
import { SignOutButton } from '@/components/SignOutButton';

export const metadata: Metadata = {
  title: 'Dashboard',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default async function DashboardPage(): Promise<React.ReactElement> {
  let user;
  try {
    user = await requireUser();
  } catch {
    redirect('/signin?next=%2Fdashboard');
  }

  const summary = await buildSubscriptionSummary(createAdminClient(), user.id);

  return (
    <div className="shell" style={{ paddingTop: '3rem' }}>
      <header style={{ marginBottom: '2rem' }}>
        <p className="eyebrow">Dashboard</p>
        <h1 style={{ marginBottom: '0.35rem' }}>You are signed in</h1>
        <p className="lede">
          Your plan is <strong>{summary.planDisplayName}</strong>.{' '}
          {summary.statusDescription}
        </p>
      </header>

      <section>
        <div className="two-col">
          <div className="card">
            <h2 style={{ marginTop: 0, fontSize: '1.05rem' }}>Check a bill</h2>
            <p className="small">
              Enter the figures from a statement and see whether they add up. The
              same engine runs on every plan.
            </p>
            <Link href="/medical-bill-checker" className="btn btn--primary">
              Open the bill checker
            </Link>
          </div>

          <div className="card">
            <h2 style={{ marginTop: 0, fontSize: '1.05rem' }}>Your subscription</h2>
            <p className="small">
              Plan, usage, renewal date and invoices, all from live data.
            </p>
            <Link href="/settings/subscription" className="btn btn--secondary">
              Manage subscription
            </Link>
          </div>
        </div>
      </section>

      <section>
        <h2>Remaining this period</h2>
        <div className="two-col">
          {summary.usage.map((line) => (
            <div className="card" key={line.featureKey}>
              <h3 style={{ marginTop: 0, fontSize: '0.98rem' }}>{line.label}</h3>
              <p style={{ marginBottom: 0 }}>
                {line.limit === null ? (
                  <>Unlimited</>
                ) : (
                  <>
                    <strong>{(line.remaining ?? 0).toLocaleString('en-US')}</strong> of{' '}
                    {line.limit.toLocaleString('en-US')} remaining
                  </>
                )}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Honest about what is not here yet, rather than an empty list that
          looks like a bug. */}
      <section>
        <p className="notice">
          Cases, document upload and the letter workspace are not built yet. The bill
          checker above works fully, and nothing you do there is lost.
        </p>
      </section>

      <SignOutButton />
    </div>
  );
}
