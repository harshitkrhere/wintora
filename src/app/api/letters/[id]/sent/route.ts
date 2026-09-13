/**
 * POST /api/letters/{id}/sent   the customer says they sent it
 *
 * Wintora sent nothing; this records that the customer did, by which route,
 * on which day and to whom, so the case timeline has the date and the
 * follow-up reminder has something to count from. Only a confirmed letter
 * can be marked sent: a draft nobody has reviewed should not be in the post.
 */

import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { AppError } from '@/lib/errors';
import { handler, ok, parseBody, pathIdAfter, requireUser } from '@/lib/http/api';
import { clientIp, enforceRateLimit } from '@/lib/http/ratelimit';
import { createAdminClient } from '@/lib/supabase/server';
import { LETTER_COLUMNS, loadOwnedLetter, publicLetter, type LetterRow } from '@/lib/letters/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  via: z.enum(['email', 'post', 'portal', 'fax', 'other']),
  sentOn: z.string().date(),
  to: z.string().trim().max(200).optional(),
});

const ROUTE_LABEL: Record<string, string> = {
  email: 'by email',
  post: 'by post',
  portal: 'through the patient portal',
  fax: 'by fax',
  other: 'in person or by another route',
};

export const POST = handler('/api/letters/[id]/sent', async (request: NextRequest, context) => {
  const user = await requireUser();
  enforceRateLimit('GENERAL', { userId: user.id, ip: clientIp(request.headers) });

  const letterId = pathIdAfter(request, 'letters');
  const body = await parseBody(request, bodySchema);
  const admin = createAdminClient();
  const row = await loadOwnedLetter(admin, user.id, letterId);

  if (row.status !== 'FINALIZED') {
    throw new AppError('CONFLICT', 'Confirm the letter as reviewed before recording that you sent it.');
  }

  const sentOn = new Date(`${body.sentOn}T12:00:00Z`);
  if (sentOn.getTime() > Date.now() + 24 * 60 * 60 * 1000) {
    throw new AppError('VALIDATION_FAILED', 'The date you sent it cannot be in the future.');
  }

  const { data, error } = await admin
    .from('generated_documents')
    .update({
      sent_at: sentOn.toISOString(),
      sent_via: body.via,
      sent_to: body.to !== undefined && body.to.length > 0 ? body.to : null,
    })
    .eq('id', letterId)
    .eq('user_id', user.id)
    .select(LETTER_COLUMNS)
    .single();

  if (error !== null || data === null) {
    throw new AppError('INTERNAL', 'We could not record that.', { detail: error?.code });
  }

  await admin.from('case_events').insert({
    case_id: row.case_id,
    user_id: user.id,
    event_type: 'LETTER_SENT',
    title: 'Letter sent',
    detail: `${row.title} — ${ROUTE_LABEL[body.via] ?? body.via}${body.to ? ` to ${body.to}` : ''}`,
    origin: 'USER',
    occurred_at: sentOn.toISOString(),
  });

  const updated = data as unknown as LetterRow;
  return ok(context, {
    letter: publicLetter({ ...updated, attachments: Array.isArray(updated.attachments) ? updated.attachments : [] }),
  });
});
