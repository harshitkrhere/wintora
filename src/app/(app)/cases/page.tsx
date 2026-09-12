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
import { EmptyState } from '@/components/EmptyState';

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
    <div className="shell stack--lg page">
      <div className="page-head">
        <div className="page-head__text">
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
        <EmptyState
          title="No cases yet"
          body="A case is one bill: its documents, every check you run on it, and a record of what happened. Your first upload creates one."
          action={{ href: '/upload', label: 'Upload a bill' }}
          secondary={{ href: '/medical-bill-checker', label: 'Type the figures in instead' }}
        />
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
