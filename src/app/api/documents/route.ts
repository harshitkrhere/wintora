/**
 * GET  /api/documents?caseId=   list the documents on one of the user's cases
 * POST /api/documents           begin an upload
 *
 * Uploads are two steps. This route authorizes the upload and hands back a
 * signed URL bound to one object path; the browser puts the file there
 * directly (Vercel caps request bodies at 4.5 MB, plans promise up to 25 MB);
 * then /api/documents/{id}/finalize reads the bytes back and inspects them.
 *
 * Nothing is trusted from this request except the case id, which is
 * ownership-checked. The declared size is a pre-check so an obviously
 * oversized file is refused before any bytes move; the real size is measured
 * at finalize. Quota is NOT consumed here: a document counts when it exists,
 * which is after it has been inspected and accepted.
 */

import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { AppError } from '@/lib/errors';
import { authorize, handler, ok, parseBody, requireUser } from '@/lib/http/api';
import { clientIp, enforceRateLimit } from '@/lib/http/ratelimit';
import { createAdminClient } from '@/lib/supabase/server';
import { createUploadTarget, documentPath } from '@/lib/documents/storage';
import { DOCUMENT_COLUMNS, MB, type DocumentRow, publicDocument, storedBytesFor } from '@/lib/documents/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DOCUMENT_TYPES = [
  'BILL', 'ITEMIZED_BILL', 'EOB', 'STATEMENT', 'DENIAL_LETTER',
  'CORRESPONDENCE', 'INSURANCE_CARD', 'RECEIPT', 'OTHER',
] as const;

const beginSchema = z.object({
  caseId: z.string().uuid(),
  filename: z.string().min(1).max(255),
  /** Declared by the browser. Re-measured server-side at finalize. */
  byteSize: z.number().int().positive(),
  documentType: z.enum(DOCUMENT_TYPES).default('BILL'),
});

export const GET = handler('/api/documents', async (request: NextRequest, context) => {
  const user = await requireUser();
  enforceRateLimit('GENERAL', { userId: user.id, ip: clientIp(request.headers) });

  const caseId = z.string().uuid().safeParse(request.nextUrl.searchParams.get('caseId'));
  if (!caseId.success) throw new AppError('VALIDATION_FAILED', 'A case id is required.');

  // Ownership. Reading your own documents needs no feature, but the case must
  // be yours, and a foreign id must look like an empty case, not a refusal.
  await authorize(user, {
    feature: 'CASE_TRACKING',
    resource: { type: 'case', id: caseId.data },
    action: 'read',
  }).catch(() => {
    throw new AppError('NOT_FOUND', 'That case does not exist.');
  });

  const admin = createAdminClient();
  const { data } = await admin
    .from('documents')
    .select(DOCUMENT_COLUMNS)
    .eq('user_id', user.id)
    .eq('case_id', caseId.data)
    .is('deleted_at', null)
    .order('created_at', { ascending: false });

  return ok(context, {
    documents: ((data ?? []) as unknown as DocumentRow[]).map(publicDocument),
  });
});

export const POST = handler('/api/documents', async (request: NextRequest, context) => {
  const user = await requireUser();
  enforceRateLimit('UPLOAD', { userId: user.id, ip: clientIp(request.headers) });

  const body = await parseBody(request, beginSchema);
  const declaredMb = body.byteSize / MB;

  // 1. May this user upload at all, and to THIS case?
  await authorize(user, {
    feature: 'DOCUMENT_UPLOAD',
    resource: { type: 'case', id: body.caseId },
    action: 'create',
  });

  // 2. Limits, using the declared size as a pre-check. The message names the
  //    plan's ceiling, so a customer learns the limit before waiting on an
  //    upload that was always going to be refused.
  await authorize(user, { feature: 'MAX_FILE_SIZE_MB', currentUsage: 0, amount: declaredMb });

  const admin = createAdminClient();
  const storedMb = (await storedBytesFor(admin, user.id)) / MB;
  await authorize(user, { feature: 'STORAGE_LIMIT_MB', currentUsage: storedMb, amount: declaredMb });

  // 3. Quota pre-check. Not consumed until finalize.
  await authorize(user, { feature: 'MONTHLY_DOCUMENTS', action: 'create', amount: 1 });

  // 4. The row exists first so the object path can carry its id. It is
  //    unmistakably incomplete: sha256 'pending', scan PENDING, and it is not
  //    counted anywhere until finalize replaces those.
  const { data, error } = await admin
    .from('documents')
    .insert({
      user_id: user.id,
      case_id: body.caseId,
      original_filename: body.filename,
      mime_type: 'application/octet-stream',
      byte_size: body.byteSize,
      sha256: 'pending',
      document_type: body.documentType,
      scan_status: 'PENDING',
      extraction_status: 'PENDING',
    })
    .select('id')
    .single();

  if (error !== null || data === null) {
    throw new AppError('INTERNAL', 'We could not start that upload.', { detail: error?.code });
  }

  const documentId = (data as { id: string }).id;
  const path = documentPath(user.id, body.caseId, documentId);

  await admin.from('documents').update({ storage_path: path }).eq('id', documentId);

  const target = await createUploadTarget(admin, path);

  return ok(
    context,
    {
      documentId,
      upload: { url: target.url, token: target.token },
      next: `/api/documents/${documentId}/finalize`,
    },
    201,
  );
});
