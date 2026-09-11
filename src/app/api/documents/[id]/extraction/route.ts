/**
 * GET /api/documents/{id}/extraction
 *
 * The most recent draft for a document, or null. Used by the review page on
 * reload so a customer does not lose a read while filling in the form.
 */

import { type NextRequest } from 'next/server';
import { handler, ok, requireUser } from '@/lib/http/api';
import { clientIp, enforceRateLimit } from '@/lib/http/ratelimit';
import { createAdminClient } from '@/lib/supabase/server';
import { documentIdFromPath, loadOwnedDocument, publicDocument } from '@/lib/documents/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = handler('/api/documents/[id]/extraction', async (request: NextRequest, context) => {
  const user = await requireUser();
  enforceRateLimit('GENERAL', { userId: user.id, ip: clientIp(request.headers) });

  const documentId = documentIdFromPath(request);
  const admin = createAdminClient();
  const row = await loadOwnedDocument(admin, user.id, documentId);

  const { data } = await admin
    .from('document_extractions')
    .select('payload, created_at')
    .eq('document_id', documentId)
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  return ok(context, {
    document: publicDocument(row),
    draft: (data as { payload: unknown } | null)?.payload ?? null,
  });
});
