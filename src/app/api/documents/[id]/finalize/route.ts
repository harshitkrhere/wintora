/**
 * POST /api/documents/{id}/finalize
 *
 * The browser has put the bytes in storage. Now the server decides whether
 * they are a document.
 *
 *   read bytes  ->  real size vs plan  ->  structural scan  ->  sha256
 *      ->  consume MONTHLY_DOCUMENTS atomically  ->  record it
 *
 * A rejected file is deleted from storage and the row is kept as a record
 * with scan_status INFECTED or FAILED. That is a 200, not an error: the
 * request did what it should. The customer is told plainly why.
 *
 * With MALWARE_SCAN_PROVIDER=none the row stays PENDING and nothing can read
 * it. Fail closed, by design, on a fresh install.
 */

import { type NextRequest } from 'next/server';
import { structuralScan } from '@/domain/documents/inspect';
import { retentionUntil } from '@/domain/retention/policy';
import { freeSnapshot } from '@/domain/entitlements/compute';
import { quotaWindow } from '@/domain/usage/period';
import { buildIdempotencyKey, QuotaExceededError, withQuota } from '@/domain/usage/meter';
import { serverEnv } from '@/lib/env';
import { AppError } from '@/lib/errors';
import { authorize, handler, ok, requireUser } from '@/lib/http/api';
import { clientIp, enforceRateLimit } from '@/lib/http/ratelimit';
import { createAdminClient } from '@/lib/supabase/server';
import { createEntitlementStore, createUsageStore } from '@/lib/supabase/stores';
import { deleteObject, readObject } from '@/lib/documents/storage';
import {
  MB,
  documentIdFromPath,
  loadOwnedDocument,
  publicDocument,
  sha256Hex,
} from '@/lib/documents/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export const POST = handler('/api/documents/[id]/finalize', async (request: NextRequest, context) => {
  const user = await requireUser();
  enforceRateLimit('UPLOAD', { userId: user.id, ip: clientIp(request.headers) });

  const documentId = documentIdFromPath(request);
  const admin = createAdminClient();
  const row = await loadOwnedDocument(admin, user.id, documentId);

  // Idempotent: a retry after a network blip must not re-scan or re-count.
  if (row.sha256 !== 'pending') {
    return ok(context, { document: publicDocument(row), replayed: true });
  }
  if (row.storage_path === null || row.case_id === null) {
    throw new AppError('CONFLICT', 'That upload was not started correctly. Please try again.');
  }

  const bytes = await readObject(admin, row.storage_path);
  if (bytes === null) {
    throw new AppError('CONFLICT', 'The file has not arrived yet. Please try again in a moment.');
  }

  const reject = async (
    status: 'INFECTED' | 'FAILED',
    detail: string,
    message: string,
  ): Promise<ReturnType<typeof ok>> => {
    await deleteObject(admin, row.storage_path!);
    const { data } = await admin
      .from('documents')
      .update({ scan_status: status, scan_detail: detail, storage_path: null, byte_size: Math.max(bytes.length, 1) })
      .eq('id', documentId)
      .select('*')
      .single();
    return ok(context, {
      document: publicDocument({ ...row, ...(data as object) } as typeof row),
      rejected: true,
      message,
    });
  };

  // 1. Real size against the plan. The declared size was only a pre-check.
  try {
    await authorize(user, { feature: 'MAX_FILE_SIZE_MB', currentUsage: 0, amount: bytes.length / MB });
  } catch (error) {
    await deleteObject(admin, row.storage_path);
    await admin.from('documents').update({ scan_status: 'FAILED', scan_detail: 'over plan size limit', storage_path: null }).eq('id', documentId);
    throw error;
  }

  // 2. Inspect. With no scanner configured the row stays PENDING and is
  //    unreadable, which is the point.
  if (serverEnv().MALWARE_SCAN_PROVIDER === 'none') {
    return ok(context, {
      document: publicDocument(row),
      pending: true,
      message: 'Uploaded. Scanning is not enabled on this deployment, so the file cannot be read yet.',
    });
  }

  const scan = structuralScan(bytes);
  if (scan.verdict !== 'CLEAN' || scan.mimeType === null) {
    return reject(
      scan.verdict === 'CLEAN' ? 'FAILED' : scan.verdict,
      scan.detail,
      scan.mimeType === null
        ? 'That file is not a PDF or an image, so it was not kept. Please upload the bill as a PDF, PNG or JPEG.'
        : 'That PDF contains something that could run rather than be read, so it was not kept. Please export it again as a plain PDF, or take a photo of it.',
    );
  }

  const sha256 = sha256Hex(bytes);

  // 3. Retention comes from the plan at the moment of upload.
  const retention = await authorize(user, { feature: 'RETENTION_DAYS' });
  const keepUntil = retentionUntil({
    uploadedAt: new Date(),
    retentionDays: retention.limit ?? 30,
  });

  // 4. Consume quota and record, atomically against the counter. The document
  //    id is the operation key: a retried finalize is the same operation.
  const decision = await authorize(user, { feature: 'MONTHLY_DOCUMENTS', action: 'create', amount: 1 });
  const store = createEntitlementStore(admin);
  const usage = createUsageStore(admin);
  const subscription = (await store.getSubscription(user.id)) ?? freeSnapshot(new Date());
  const window = quotaWindow(subscription);

  try {
    await withQuota(
      usage,
      {
        userId: user.id,
        featureKey: 'MONTHLY_DOCUMENTS',
        amount: 1,
        idempotencyKey: buildIdempotencyKey({
          userId: user.id,
          featureKey: 'MONTHLY_DOCUMENTS',
          window,
          operationKey: `finalize:${documentId}`,
        }),
        window,
        limit: decision.limit,
      },
      async () => {
        const { error } = await admin
          .from('documents')
          .update({
            mime_type: scan.mimeType,
            byte_size: bytes.length,
            sha256,
            page_count: scan.pageCount,
            scan_status: 'CLEAN',
            scan_detail: scan.detail,
            retention_until: keepUntil.toISOString(),
          })
          .eq('id', documentId);
        if (error !== null) throw new Error(`documents.update ${error.code}`);

        await admin.from('case_events').insert({
          case_id: row.case_id,
          user_id: user.id,
          event_type: 'DOCUMENT_UPLOADED',
          title: 'Document uploaded',
          detail: row.original_filename,
          origin: 'USER',
        });
      },
    );
  } catch (error) {
    if (error instanceof QuotaExceededError) {
      await deleteObject(admin, row.storage_path);
      await admin.from('documents').update({ scan_status: 'FAILED', scan_detail: 'quota exhausted at finalize', storage_path: null }).eq('id', documentId);
      throw new AppError('QUOTA_EXCEEDED', 'You have used all of this period\'s document uploads.', {
        meta: { feature: 'MONTHLY_DOCUMENTS', limit: error.limit, resetAt: decision.resetAt },
      });
    }
    throw error;
  }

  const final = await loadOwnedDocument(admin, user.id, documentId);
  return ok(context, {
    document: publicDocument(final),
    quota: { remaining: Math.max((decision.remaining ?? 1) , 0), limit: decision.limit, resetAt: decision.resetAt },
  });
});
