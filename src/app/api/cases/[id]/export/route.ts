/**
 * GET  /api/cases/{id}/export   recent bundles, with fresh links for any still live
 * POST /api/cases/{id}/export   build a bundle of the whole case
 *
 * The bundle is the case as a folder: summary, findings with their figures,
 * every letter, the timeline and (if asked) the original uploads. It is
 * gated on ADVANCED_EXPORT and metered against MONTHLY_EXPORTS with the same
 * reserve-run-commit pattern as an analysis, so a retry costs nothing extra
 * and a storage failure returns the credit.
 */

import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { buildIdempotencyKey, withQuota, QuotaExceededError } from '@/domain/usage/meter';
import { quotaWindow } from '@/domain/usage/period';
import { freeSnapshot } from '@/domain/entitlements/compute';
import { AppError } from '@/lib/errors';
import { authorize, handler, ok, parseBody, pathIdAfter, requireUser } from '@/lib/http/api';
import { clientIp, enforceRateLimit } from '@/lib/http/ratelimit';
import { idempotencyKeySchema } from '@/lib/http/schemas';
import { createAdminClient } from '@/lib/supabase/server';
import { createEntitlementStore, createUsageStore } from '@/lib/supabase/stores';
import { buildCaseExport, signedExportUrl } from '@/lib/export/build';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const bodySchema = z.object({
  format: z.enum(['pdf', 'docx']),
  includeDocuments: z.boolean().default(true),
  idempotencyKey: idempotencyKeySchema,
});

export const GET = handler('/api/cases/[id]/export', async (request: NextRequest, context) => {
  const user = await requireUser();
  const caseId = pathIdAfter(request, 'cases');

  await authorize(user, {
    feature: 'CASE_TRACKING',
    resource: { type: 'case', id: caseId },
    action: 'read',
  }).catch(() => {
    throw new AppError('NOT_FOUND', 'That case does not exist.');
  });

  const admin = createAdminClient();
  const now = new Date();
  const { data } = await admin
    .from('case_exports')
    .select('id, format, includes_documents, storage_path, byte_size, file_count, omitted, expires_at, created_at')
    .eq('user_id', user.id)
    .eq('case_id', caseId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(10);

  const { data: caseRow } = await admin.from('cases').select('title').eq('id', caseId).maybeSingle();
  const title = (caseRow as { title: string } | null)?.title ?? 'case';

  const exports = [];
  for (const row of (data ?? []) as {
    id: string; format: string; includes_documents: boolean; storage_path: string | null; byte_size: number | null;
    file_count: number; omitted: string[]; expires_at: string; created_at: string;
  }[]) {
    const live = row.storage_path !== null && new Date(row.expires_at).getTime() > now.getTime();
    let url: string | null = null;
    if (live) {
      try {
        url = await signedExportUrl(admin, row.storage_path!, title, new Date(row.expires_at), now);
      } catch {
        url = null;
      }
    }
    exports.push({
      id: row.id,
      format: row.format,
      includesDocuments: row.includes_documents,
      byteSize: row.byte_size,
      fileCount: row.file_count,
      omitted: row.omitted ?? [],
      expiresAt: row.expires_at,
      createdAt: row.created_at,
      url,
    });
  }

  return ok(context, { exports });
});

export const POST = handler('/api/cases/[id]/export', async (request: NextRequest, context) => {
  const user = await requireUser();
  enforceRateLimit('LETTER', { userId: user.id, ip: clientIp(request.headers) });

  const caseId = pathIdAfter(request, 'cases');
  const body = await parseBody(request, bodySchema);

  await authorize(user, {
    feature: 'ADVANCED_EXPORT',
    resource: { type: 'case', id: caseId },
    action: 'export',
  });

  const decision = await authorize(user, {
    feature: 'MONTHLY_EXPORTS',
    resource: { type: 'case', id: caseId },
    action: 'export',
    amount: 1,
  });

  const admin = createAdminClient();
  const store = createEntitlementStore(admin);
  const usage = createUsageStore(admin);
  const subscription = (await store.getSubscription(user.id)) ?? freeSnapshot(new Date());
  const window = quotaWindow(subscription);

  const idempotencyKey = buildIdempotencyKey({
    userId: user.id,
    featureKey: 'MONTHLY_EXPORTS',
    window,
    operationKey: body.idempotencyKey,
  });

  try {
    const run = await withQuota(
      usage,
      {
        userId: user.id,
        featureKey: 'MONTHLY_EXPORTS',
        amount: 1,
        idempotencyKey,
        window,
        limit: decision.limit,
      },
      async () => {
        const built = await buildCaseExport(admin, {
          userId: user.id,
          caseId,
          format: body.format,
          includeDocuments: body.includeDocuments,
        });
        await admin.from('case_events').insert({
          case_id: caseId,
          user_id: user.id,
          event_type: 'CASE_EXPORTED',
          title: 'Case exported',
          detail: `${body.format.toUpperCase()} bundle, ${built.fileCount} file${built.fileCount === 1 ? '' : 's'}`,
          origin: 'USER',
        });
        return built;
      },
    );

    return ok(
      context,
      {
        export: run.value,
        quota: { remaining: run.remaining, limit: decision.limit, resetAt: decision.resetAt },
        replayed: run.replayed,
      },
      201,
    );
  } catch (error) {
    if (error instanceof QuotaExceededError) {
      throw new AppError('QUOTA_EXCEEDED', decision.message, {
        detail: `quota exhausted for ${error.featureKey}`,
      });
    }
    throw error;
  }
});
