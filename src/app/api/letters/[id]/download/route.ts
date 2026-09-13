/**
 * GET /api/letters/{id}/download?format=txt|pdf|docx
 *
 * The letter as a file the customer can print, attach or paste. This is part
 * of "review and send it yourself", not an export, so it costs no quota. A
 * draft that has not been confirmed is marked as such on its first line.
 *
 * The file is generated on the spot from the stored text, so what they get is
 * always what the page shows. Nothing is written to storage.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { letterDocument, safeFilename } from '@/domain/export/bundle';
import { renderDocx } from '@/domain/export/docx';
import { renderPdf } from '@/domain/export/pdf';
import { AppError } from '@/lib/errors';
import { handler, ok, pathIdAfter, requireUser } from '@/lib/http/api';
import { clientIp, enforceRateLimit } from '@/lib/http/ratelimit';
import { createAdminClient } from '@/lib/supabase/server';
import { loadOwnedLetter } from '@/lib/letters/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const FORMATS = {
  txt: { mime: 'text/plain; charset=utf-8', ext: 'txt' },
  pdf: { mime: 'application/pdf', ext: 'pdf' },
  docx: { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', ext: 'docx' },
} as const;

type Format = keyof typeof FORMATS;

export const GET = handler('/api/letters/[id]/download', async (request: NextRequest, context) => {
  const user = await requireUser();
  enforceRateLimit('GENERAL', { userId: user.id, ip: clientIp(request.headers) });

  const letterId = pathIdAfter(request, 'letters');
  const format = (request.nextUrl.searchParams.get('format') ?? 'txt') as Format;
  if (!(format in FORMATS)) {
    throw new AppError('VALIDATION_FAILED', 'Choose txt, pdf or docx.');
  }

  const admin = createAdminClient();
  const row = await loadOwnedLetter(admin, user.id, letterId);
  const doc = letterDocument({
    id: row.id,
    title: row.title,
    content: row.content,
    status: row.status,
    createdAt: row.created_at,
    confirmedAt: row.user_confirmed_at,
  });

  let bytes: Uint8Array;
  if (format === 'pdf') bytes = renderPdf(doc);
  else if (format === 'docx') bytes = renderDocx(doc);
  else {
    const banner = row.status === 'FINALIZED' ? '' : 'DRAFT - not yet reviewed. Check every detail before sending.\n\n';
    bytes = new TextEncoder().encode(`${banner}${row.content.replace(/\r\n?/g, '\n')}\n`);
  }

  // Log the request through the normal path, then hand back the bytes.
  ok(context, { bytes: bytes.length });

  const filename = `${safeFilename(row.title, 'letter')}.${FORMATS[format].ext}`;
  // A fresh ArrayBuffer-backed copy: the Response body type wants exactly that.
  const body = new Uint8Array(bytes).buffer as ArrayBuffer;
  return new NextResponse(body, {
    status: 200,
    headers: {
      'content-type': FORMATS[format].mime,
      'content-disposition': `attachment; filename="${filename}"`,
      'content-length': String(bytes.length),
      'cache-control': 'no-store',
      'x-request-id': context.requestId,
    },
  });
});
