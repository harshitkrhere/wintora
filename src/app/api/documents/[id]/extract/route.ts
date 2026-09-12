/**
 * POST /api/documents/{id}/extract
 *
 * Read a document into a draft the customer will review. Refuses anything not
 * scan_status CLEAN: that is the whole reason the scan exists.
 *
 * The result is a DRAFT. It is stored in document_extractions and shown to the
 * customer pre-filled into the bill form; analysis runs only on what they
 * confirm. Nothing here consumes an analysis quota, because nothing here is
 * an analysis.
 */

import { type NextRequest } from 'next/server';
import { z } from 'zod';
import type { ExtractionDraft } from '@/domain/documents/draft';
import { readDocument } from '@/lib/documents/extract';
import { AppError } from '@/lib/errors';
import { authorize, handler, ok, parseBody, requireUser } from '@/lib/http/api';
import { clientIp, enforceRateLimit } from '@/lib/http/ratelimit';
import { createAdminClient } from '@/lib/supabase/server';
import { readObject } from '@/lib/documents/storage';
import { documentIdFromPath, loadOwnedDocument } from '@/lib/documents/service';
import type { AllowedMimeType } from '@/domain/documents/inspect';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const bodySchema = z.object({
  /**
   * True when the client created the case from the file name a moment ago
   * and would like it named after the provider on the bill instead. A name
   * the customer typed is never replaced.
   */
  adoptTitle: z.boolean().optional(),
});

export const POST = handler('/api/documents/[id]/extract', async (request: NextRequest, context) => {
  const user = await requireUser();
  enforceRateLimit('ANALYSIS', { userId: user.id, ip: clientIp(request.headers) });

  const body = await parseBody(request, bodySchema);
  const documentId = documentIdFromPath(request);
  const admin = createAdminClient();
  const row = await loadOwnedDocument(admin, user.id, documentId);

  await authorize(user, {
    feature: 'DOCUMENT_UPLOAD',
    resource: { type: 'document', id: documentId },
    action: 'execute',
  });

  if (row.scan_status !== 'CLEAN' || row.storage_path === null) {
    throw new AppError(
      'CONFLICT',
      row.scan_status === 'PENDING'
        ? 'This document has not been checked yet, so it cannot be read.'
        : 'This document was not accepted, so it cannot be read.',
    );
  }
  if (row.extraction_status === 'RUNNING') {
    throw new AppError('CONFLICT', 'This document is already being read. Please wait a moment.');
  }

  await admin.from('documents').update({ extraction_status: 'RUNNING' }).eq('id', documentId);

  try {
    const bytes = await readObject(admin, row.storage_path);
    if (bytes === null) throw new Error('object missing');

    const draft = await readDocument(bytes, row.mime_type as AllowedMimeType);

    // One row per engine version. Re-reading with the same engine replaces.
    const { error } = await admin.from('document_extractions').upsert(
      {
        document_id: documentId,
        user_id: user.id,
        engine: draft.engine,
        engine_version: draft.engineVersion,
        payload: draft,
        field_confidence: {},
        overall_confidence: draft.overallConfidence,
      },
      { onConflict: 'document_id,engine_version' },
    );
    if (error !== null) throw new Error(`document_extractions.upsert ${error.code}`);

    await admin
      .from('documents')
      .update({ extraction_status: 'COMPLETED', page_count: draft.pageCount ?? row.page_count })
      .eq('id', documentId);

    let caseTitle: string | null = null;
    if (row.case_id !== null) {
      await admin.from('case_events').insert({
        case_id: row.case_id,
        user_id: user.id,
        event_type: 'DOCUMENT_READ',
        title: 'Document read',
        detail: `${draft.lineItems.length} line item(s) found`,
        origin: 'SYSTEM',
      });
      caseTitle = await adoptCaseDetails(admin, user.id, row.case_id, draft, body.adoptTitle === true);
    }

    return ok(context, { draft, caseTitle });
  } catch (error) {
    await admin.from('documents').update({ extraction_status: 'FAILED' }).eq('id', documentId);
    throw new AppError('INTERNAL', 'We could not read that document. You can still enter the figures yourself.', {
      detail: error instanceof Error ? error.message : 'unknown',
    });
  }
});

/**
 * What the document says about the case, written onto the case where the case
 * says nothing yet: the provider's name, the statement date, and, if asked,
 * the title. This is descriptive metadata so the case can be found in a list.
 * It is not a finding, nothing is analysed, and a value already on the case
 * is never overwritten. Returns the title the case has afterwards.
 */
async function adoptCaseDetails(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  caseId: string,
  draft: ExtractionDraft,
  adoptTitle: boolean,
): Promise<string | null> {
  const { data } = await admin
    .from('cases')
    .select('title, provider_name, statement_date')
    .eq('id', caseId)
    .eq('user_id', userId)
    .maybeSingle();
  if (data === null || data === undefined) return null;
  const current = data as { title: string; provider_name: string | null; statement_date: string | null };

  const provider = (draft.providerName?.value ?? '').trim().slice(0, 200);
  const date = (draft.statementDate?.value ?? '').trim();
  const dateIsUsable = /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(date));

  const patch: Record<string, string> = {};
  if (provider.length > 0 && current.provider_name === null) patch.provider_name = provider;
  if (dateIsUsable && current.statement_date === null) patch.statement_date = date;
  if (adoptTitle && provider.length > 0) patch.title = provider;
  if (Object.keys(patch).length === 0) return current.title;

  const { error } = await admin.from('cases').update(patch).eq('id', caseId).eq('user_id', userId);
  if (error !== null) return current.title;

  const detail = [
    patch.title !== undefined ? `named after the provider on the bill, "${patch.title}"` : null,
    patch.statement_date !== undefined ? `statement dated ${patch.statement_date}` : null,
  ].filter((part): part is string => part !== null);
  await admin.from('case_events').insert({
    case_id: caseId,
    user_id: userId,
    event_type: 'CASE_DETAILS_READ',
    title: 'Details filled in from the document',
    detail: detail.length > 0 ? detail.join('; ') : null,
    origin: 'SYSTEM',
  });

  return patch.title ?? current.title;
}
