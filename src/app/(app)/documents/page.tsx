/**
 * /documents — everything a person has given Wintora and everything it has
 * drafted for them, across every case, as cards with a switch for the kind.
 *
 * Metadata only. The list is scoped by the session's user id in the
 * loaders and takes nothing from the URL. Opening the file itself is a
 * later phase; a document opens its facts in a sheet and its case from
 * there.
 */

import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/http/api';
import { createAdminClient } from '@/lib/supabase/server';
import { listDocuments, listLetters } from '@/lib/documents/list';
import { DocumentsScreen } from '@/components/DocumentsScreen';

export const metadata: Metadata = { title: 'Documents', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

export default async function DocumentsPage(): Promise<React.ReactElement> {
  let user;
  try {
    user = await requireUser();
  } catch {
    redirect('/signin?next=%2Fdocuments');
  }

  const admin = createAdminClient();
  const [documents, letters] = await Promise.all([listDocuments(admin, user.id), listLetters(admin, user.id)]);

  return (
    <div className="shell stack--lg page">
      <div className="page-head__text">
        <h1>Documents</h1>
        <p className="lede">
          Every bill and EOB you have reviewed, and every letter drafted from them, on the case it belongs to.
        </p>
      </div>
      <DocumentsScreen documents={documents} letters={letters} />
    </div>
  );
}
