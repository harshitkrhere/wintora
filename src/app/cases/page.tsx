/**
 * /cases — every case the customer has, newest activity first.
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/http/api';
import { createAdminClient } from '@/lib/supabase/server';
import { listCases } from '@/lib/cases/load';
import { CaseCard } from '@/components/CaseCard';

export const metadata: Metadata = { title: 'Your cases', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

export default async function CasesPage(): Promise<React.ReactElement> {
  let user;
  try {
    user = await requireUser();
  } catch {
    redirect('/signin?next=%2Fcases');
  }

  const cases = await listCases(createAdminClient(), user.id);
  const open = cases.filter((c) => c.status === 'OPEN');
  const rest = cases.filter((c) => c.status !== 'OPEN');

  return (
    <div className="shell stack--lg" style={{ paddingTop: '2rem', paddingBottom: '3rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'end', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <p className="eyebrow">Cases</p>
          <h1>Your cases</h1>
          <p className="muted" style={{ margin: 0 }}>
            One case per bill. Everything you upload and every check you run stays on it.
          </p>
        </div>
        <Link href="/upload" className="btn btn--primary">
          Upload a bill
        </Link>
      </div>

      {cases.length === 0 ? (
        <div className="card">
          <p style={{ marginTop: 0 }}>No cases yet.</p>
          <p className="muted small" style={{ marginBottom: 0 }}>
            Upload a bill and a case is created for it. You can also{' '}
            <Link href="/medical-bill-checker">type the figures in</Link> without one.
          </p>
        </div>
      ) : (
        <>
          <section className="stack">
            <h2 style={{ fontSize: '1.1rem', margin: 0 }}>Open ({open.length})</h2>
            {open.length === 0 ? <p className="muted small">Nothing open.</p> : null}
            {open.map((c) => (
              <CaseCard key={c.id} summary={c} />
            ))}
          </section>
          {rest.length > 0 ? (
            <section className="stack">
              <h2 style={{ fontSize: '1.1rem', margin: 0 }}>Closed ({rest.length})</h2>
              {rest.map((c) => (
                <CaseCard key={c.id} summary={c} />
              ))}
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}
