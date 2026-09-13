/**
 * GET    /api/letters/{id}   one letter
 * PATCH  /api/letters/{id}   edit the text, or confirm it as reviewed
 * DELETE /api/letters/{id}   remove a letter
 *
 * The text is the customer's to change: the template gave them a starting
 * point and every word of it is editable. Confirming is a separate act with
 * two explicit statements (reviewed; accurate to the best of my knowledge),
 * and the database constraint agrees: a confirmation timestamp cannot be
 * written without the accuracy flag. A confirmed letter can still be edited,
 * which returns it to a draft, because a letter that changed after review
 * has not been reviewed.
 */

import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { DISCLAIMERS } from '@/config/disclaimers';
import { canFinalize } from '@/domain/letters/render';
import { AppError } from '@/lib/errors';
import { authorize, handler, ok, parseBody, pathIdAfter, requireUser } from '@/lib/http/api';
import { clientIp, enforceRateLimit } from '@/lib/http/ratelimit';
import { createAdminClient } from '@/lib/supabase/server';
import { LETTER_COLUMNS, loadOwnedLetter, publicLetter, type LetterRow } from '@/lib/letters/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_CONTENT = 40_000;

const bodySchema = z
  .object({
    content: z.string().max(MAX_CONTENT).optional(),
    title: z.string().trim().min(1).max(200).optional(),
    finalize: z
      .object({
        reviewed: z.boolean(),
        accurateToBestKnowledge: z.boolean(),
      })
      .optional(),
  })
  .refine((b) => b.content !== undefined || b.title !== undefined || b.finalize !== undefined, {
    message: 'Nothing to change.',
  });

export const GET = handler('/api/letters/[id]', async (request: NextRequest, context) => {
  const user = await requireUser();
  const letterId = pathIdAfter(request, 'letters');
  const admin = createAdminClient();
  const row = await loadOwnedLetter(admin, user.id, letterId);
  return ok(context, {
    letter: publicLetter(row),
    disclaimer: DISCLAIMERS.LETTER_DRAFT,
    confirmation: DISCLAIMERS.LETTER_FINALIZE,
  });
});

export const PATCH = handler('/api/letters/[id]', async (request: NextRequest, context) => {
  const user = await requireUser();
  enforceRateLimit('GENERAL', { userId: user.id, ip: clientIp(request.headers) });

  const letterId = pathIdAfter(request, 'letters');
  const body = await parseBody(request, bodySchema);
  const admin = createAdminClient();
  const row = await loadOwnedLetter(admin, user.id, letterId);

  await authorize(user, {
    feature: 'LETTER_GENERATION',
    resource: { type: 'generated_document', id: letterId },
    action: 'execute',
  }).catch(() => {
    throw new AppError('NOT_FOUND', 'We could not find that letter.');
  });

  const patch: Record<string, unknown> = {};
  const events: { event_type: string; title: string; detail?: string }[] = [];

  if (body.content !== undefined) {
    const content = body.content.replace(/\r\n?/g, '\n').trim();
    if (content.length === 0) {
      throw new AppError('VALIDATION_FAILED', 'The letter cannot be empty.');
    }
    patch.content = content;
    // Edited after confirmation means no longer confirmed.
    if (row.status === 'FINALIZED') {
      patch.status = 'DRAFT';
      patch.user_confirmed_at = null;
      patch.user_confirmed_accuracy = false;
      events.push({ event_type: 'LETTER_REOPENED', title: 'Letter edited after review', detail: row.title });
    }
  }

  if (body.title !== undefined) patch.title = body.title;

  if (body.finalize !== undefined) {
    const verdict = canFinalize(body.finalize);
    if (!verdict.ok) {
      throw new AppError('VALIDATION_FAILED', verdict.reason ?? 'Please confirm the letter.');
    }
    patch.status = 'FINALIZED';
    patch.user_confirmed_accuracy = true;
    patch.user_confirmed_at = new Date().toISOString();
    events.push({ event_type: 'LETTER_REVIEWED', title: 'Letter reviewed and confirmed', detail: body.title ?? row.title });
  }

  const { data, error } = await admin
    .from('generated_documents')
    .update(patch)
    .eq('id', letterId)
    .eq('user_id', user.id)
    .select(LETTER_COLUMNS)
    .single();

  if (error !== null || data === null) {
    throw new AppError('INTERNAL', 'We could not save that.', { detail: error?.code });
  }

  if (events.length > 0) {
    await admin.from('case_events').insert(
      events.map((e) => ({ case_id: row.case_id, user_id: user.id, origin: 'USER', ...e })),
    );
  }

  const updated = data as unknown as LetterRow;
  return ok(context, {
    letter: publicLetter({ ...updated, attachments: Array.isArray(updated.attachments) ? updated.attachments : [] }),
  });
});

export const DELETE = handler('/api/letters/[id]', async (request: NextRequest, context) => {
  const user = await requireUser();
  enforceRateLimit('GENERAL', { userId: user.id, ip: clientIp(request.headers) });

  const letterId = pathIdAfter(request, 'letters');
  const admin = createAdminClient();
  const row = await loadOwnedLetter(admin, user.id, letterId);

  const { error } = await admin
    .from('generated_documents')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', letterId)
    .eq('user_id', user.id);
  if (error !== null) {
    throw new AppError('INTERNAL', 'We could not remove that letter.', { detail: error.code });
  }

  await admin.from('case_events').insert({
    case_id: row.case_id,
    user_id: user.id,
    event_type: 'LETTER_REMOVED',
    title: 'Letter removed',
    detail: row.title,
    origin: 'USER',
  });

  return ok(context, { removed: true });
});
