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
import { readDocument } from '@/lib/documents/extract';
import { AppError } from '@/lib/errors';
import { authorize, handler, ok, requireUser } from '@/lib/http/api';
import { clientIp, enforceRateLimit } from '@/lib/http/ratelimit';
import { createAdminClient } from '@/lib/supabase/server';
import { readObject } from '@/lib/documents/storage';
import { documentIdFromPath, loadOwnedDocument } from '@/lib/documents/service';
import type { AllowedMimeType } from '@/domain/documents/inspect';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export const POST = handler('/api/documents/[id]/extract', async (request: NextRequest, context) => {
  const user = await requireUser();
  enforceRateLimit('ANALYSIS', { userId: user.id, ip: clientIp(request.headers) });

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

    if (row.case_id !== null) {
      await admin.from('case_events').insert({
        case_id: row.case_id,
        user_id: user.id,
        event_type: 'DOCUMENT_READ',
        title: 'Document read',
        detail: `${draft.lineItems.length} line item(s) found`,
        origin: 'SYSTEM',
      });
    }

    return ok(context, { draft });
  } catch (error) {
    await admin.from('documents').update({ extraction_status: 'FAILED' }).eq('id', documentId);
    throw new AppError('INTERNAL', 'We could not read that document. You can still enter the figures yourself.', {
      detail: error instanceof Error ? error.message : 'unknown',
    });
  }
});
