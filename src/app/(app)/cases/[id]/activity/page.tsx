/**
 * /cases/{id}/activity — what happened when, newest first. Only things
 * that actually happened appear here: what the product did, and what the
 * person told it they did. Nothing is invented from a document. Read-only.
 */

import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { requireUser } from '@/lib/http/api';
import { createAdminClient } from '@/lib/supabase/server';
import { loadCase } from '@/lib/cases/load';
import { CaseHeader } from '@/components/CaseHeader';
import { dateTime } from '@/components/documentStatus';

export const metadata: Metadata = { title: 'Activity', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

export default async function CaseActivityPage({ params }: { params: Promise<{ id: string }> }): Promise<React.ReactElement> {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  let user;
  try {
    user = await requireUser();
  } catch {
    redirect(`/signin?next=${encodeURIComponent(`/cases/${id}/activity`)}`);
  }

  const detail = await loadCase(createAdminClient(), user.id, id);
  if (detail === null) notFound();
  const { summary, events } = detail;

  return (
    <div className="shell stack--lg page">
      <CaseHeader
        caseId={summary.id}
        caseTitle={summary.title}
        title="Activity"
        lede="Only things that actually happened appear here: what the product did, and what you told it you did."
      />
      <div className="card">
        <ol className="timeline">
          {events.map((e) => (
            <li key={e.id}>
              <span className="timeline__when">{dateTime(e.occurredAt)}</span>
              <span>
                <span className="timeline__event">{e.title}</span>
                {e.detail ? <span className="muted"> — {e.detail}</span> : null}
                {e.origin === 'USER' ? <span className="muted"> · you</span> : null}
              </span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
