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
import { Icon } from '@/components/Icons';

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
          <p className="lede">
            One case per bill. Everything you upload and every check you run stays on it.
          </p>
        </div>
        <Link href="/upload" className="btn btn--primary">
          <Icon name="upload" />
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
            <div className="section-head">
              <h2>Open</h2>
              <span className="section-head__count">{open.length}</span>
            </div>
            {open.length === 0 ? (
              <EmptyState
                compact
                title="Nothing open"
                body="Every case is closed. Reopen one from its page, or upload a new bill."
                action={{ href: '/upload', label: 'Upload a bill' }}
              />
            ) : null}
            {open.map((c) => (
              <CaseCard key={c.id} summary={c} />
            ))}
          </section>
          {rest.length > 0 ? (
            <section className="stack">
              <div className="section-head">
                <h2>Closed</h2>
                <span className="section-head__count">{rest.length}</span>
              </div>
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
