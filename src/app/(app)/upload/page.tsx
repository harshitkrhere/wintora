/**
 * /upload — Review a document: bring it in, have it read, check the
 * figures, run the check. Signed-in only; the public tools stay at
 * /medical-bill-checker for anyone else.
 *
 * The URL may name a case, a document on it to pick up at the review step,
 * and the kind of document (see lib/documents/upload-params.ts). Whether
 * the case and document are this person's is decided here, on the server,
 * before anything reaches the browser: by user id, not deleted, and for a
 * document, on that case and kept. Anything that fails that is treated as
 * absent and said in one neutral sentence, the same for a malformed,
 * unknown, foreign or deleted id, so nothing about existence leaks.
 */

import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import type { ExtractionDraft } from '@/domain/documents/draft';
import { requireUser } from '@/lib/http/api';
import { createAdminClient } from '@/lib/supabase/server';
import { latestDraft, loadKeptDocumentOnCase } from '@/lib/documents/service';
import { parseUploadParams } from '@/lib/documents/upload-params';
import { UploadFlow, type ResumeDocument } from '@/components/UploadFlow';

export const metadata: Metadata = {
  title: 'Review a document',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

const CASE_NOT_FOUND = 'That case could not be found. This starts a new case.';
const DOCUMENT_NOT_FOUND = 'That document could not be found. You can add one to the case.';

function asDraft(payload: unknown): ExtractionDraft | null {
  if (payload === null || typeof payload !== 'object') return null;
  const maybe = payload as { lineItems?: unknown };
  return Array.isArray(maybe.lineItems) ? (payload as ExtractionDraft) : null;
}

export default async function UploadPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<React.ReactElement> {
  let user;
  try {
    user = await requireUser();
  } catch {
    redirect('/signin?next=%2Fupload');
  }

  const params = parseUploadParams(await searchParams);
  const admin = createAdminClient();
  const notices: string[] = [];

  let caseId: string | null = null;
  let caseTitle: string | null = null;
  if (params.caseId !== null) {
    const { data } = await admin
      .from('cases')
      .select('id, title')
      .eq('id', params.caseId)
      .eq('user_id', user.id)
      .is('deleted_at', null)
      .maybeSingle();
    const row = data as { id: string; title: string } | null;
    if (row !== null) {
      caseId = row.id;
      caseTitle = row.title;
    }
  }
  if ((params.caseId !== null || params.malformedCase) && caseId === null) notices.push(CASE_NOT_FOUND);

  let resume: ResumeDocument | null = null;
  if (caseId !== null && params.documentId !== null) {
    const row = await loadKeptDocumentOnCase(admin, user.id, caseId, params.documentId);
    if (row !== null) {
      resume = {
        id: row.id,
        filename: row.original_filename,
        documentType: row.document_type,
        scanStatus: row.scan_status,
        extractionStatus: row.extraction_status,
        pageCount: row.page_count,
        draft: asDraft(await latestDraft(admin, user.id, row.id)),
      };
    }
  }
  if (caseId !== null && (params.documentId !== null || params.malformedDocument) && resume === null) {
    notices.push(DOCUMENT_NOT_FOUND);
  }

  return (
    <div className="medium stack--lg page">
      <div className="page-head__text">
        <h1>Review a document</h1>
        <p className="lede">
          Upload a bill or an EOB. We read the figures, you confirm them, and the same deterministic
          engine that runs the free tool checks the arithmetic.
        </p>
      </div>

      <UploadFlow
        initialCaseId={caseId}
        initialCaseTitle={caseTitle}
        initialIntake={params.type}
        resume={resume}
        notice={notices.length > 0 ? notices.join(' ') : null}
        fromChecker={params.fromChecker}
      />
    </div>
  );
}
