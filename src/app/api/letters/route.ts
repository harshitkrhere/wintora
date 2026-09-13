/**
 * GET  /api/letters?caseId=   the letters on a case
 * POST /api/letters           generate a letter DRAFT
 *
 * A draft is for the user to review, edit and send themselves. Wintora never
 * sends anything on a user's behalf: no email, no fax, no filing, no phone
 * call. See docs/AI_SAFETY.md.
 *
 * An ADVANCED draft is the same letter with evidence appended: the case
 * documents being enclosed and the points the check raised, each with the
 * figures it came from. Every word of the appendix is copied from the case
 * record, and it is gated on ADVANCED_LETTERS.
 */

import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { DISCLAIMERS } from '@/config/disclaimers';
import { renderLetter } from '@/domain/letters/render';
import {
  appendEvidence,
  attachmentsFrom,
  evidenceAppendix,
  type AttachedDocument,
  type AttachedFinding,
} from '@/domain/letters/evidence';
import { buildIdempotencyKey, withQuota, QuotaExceededError } from '@/domain/usage/meter';
import { quotaWindow } from '@/domain/usage/period';
import { freeSnapshot } from '@/domain/entitlements/compute';
import { AppError } from '@/lib/errors';
import { authorize, handler, ok, parseBody, requireUser } from '@/lib/http/api';
import { clientIp, enforceRateLimit } from '@/lib/http/ratelimit';
import { idempotencyKeySchema } from '@/lib/http/schemas';
import { createAdminClient } from '@/lib/supabase/server';
import { createEntitlementStore, createUsageStore } from '@/lib/supabase/stores';
import { LETTER_COLUMNS, latestFindings, loadPublishedTemplate, publicLetter, type LetterRow } from '@/lib/letters/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  caseId: z.string().uuid(),
  templateKey: z.string().trim().min(1).max(80),
  idempotencyKey: idempotencyKeySchema,
  // Values are validated a second time against the template's own field
  // definitions; unknown keys are dropped rather than rendered.
  fieldValues: z.record(
    z.string().max(80),
    z.union([z.string().max(4000), z.array(z.string().max(4000)).max(50)]),
  ),
  /** Evidence to append (ADVANCED_LETTERS). Ids must belong to this case. */
  evidence: z
    .object({
      documentIds: z.array(z.string().uuid()).max(20).default([]),
      findingIds: z.array(z.string().uuid()).max(20).default([]),
    })
    .optional(),
});

export const GET = handler('/api/letters', async (request: NextRequest, context) => {
  const user = await requireUser();
  const caseId = request.nextUrl.searchParams.get('caseId') ?? '';
  if (!z.string().uuid().safeParse(caseId).success) {
    throw new AppError('VALIDATION_FAILED', 'A case id is required.');
  }

  await authorize(user, {
    feature: 'CASE_TRACKING',
    resource: { type: 'case', id: caseId },
    action: 'read',
  }).catch(() => {
    throw new AppError('NOT_FOUND', 'That case does not exist.');
  });

  const admin = createAdminClient();
  const { data } = await admin
    .from('generated_documents')
    .select(LETTER_COLUMNS)
    .eq('user_id', user.id)
    .eq('case_id', caseId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false });

  return ok(context, {
    letters: ((data ?? []) as unknown as LetterRow[]).map((row) =>
      publicLetter({ ...row, attachments: Array.isArray(row.attachments) ? row.attachments : [] }),
    ),
  });
});

export const POST = handler('/api/letters', async (request: NextRequest, context) => {
  const user = await requireUser();
  enforceRateLimit('LETTER', { userId: user.id, ip: clientIp(request.headers) });

  const body = await parseBody(request, bodySchema);
  const admin = createAdminClient();
  const template = await loadPublishedTemplate(admin, body.templateKey);

  // Letters at all, on this case.
  await authorize(user, {
    feature: 'LETTER_GENERATION',
    resource: { type: 'case', id: body.caseId },
    action: 'create',
  });

  if (template.isPremium) {
    await authorize(user, {
      feature: 'PREMIUM_TEMPLATES',
      resource: { type: 'case', id: body.caseId },
      action: 'create',
    });
  }

  const wantsEvidence =
    body.evidence !== undefined &&
    (body.evidence.documentIds.length > 0 || body.evidence.findingIds.length > 0);

  if (wantsEvidence) {
    await authorize(user, {
      feature: 'ADVANCED_LETTERS',
      resource: { type: 'case', id: body.caseId },
      action: 'create',
    });
  }

  const decision = await authorize(user, {
    feature: 'MONTHLY_LETTERS',
    resource: { type: 'case', id: body.caseId },
    action: 'create',
    amount: 1,
  });

  // Resolve the evidence BEFORE the quota is touched, so a bad id costs
  // nothing. Only rows on this case, owned by this user, can be attached; an
  // id from anywhere else is simply not there.
  const attached = wantsEvidence
    ? await resolveEvidence(admin, user.id, body.caseId, body.evidence!)
    : { documents: [], findings: [] };

  const store = createEntitlementStore(admin);
  const usage = createUsageStore(admin);
  const subscription = (await store.getSubscription(user.id)) ?? freeSnapshot(new Date());
  const window = quotaWindow(subscription);

  const idempotencyKey = buildIdempotencyKey({
    userId: user.id,
    featureKey: 'MONTHLY_LETTERS',
    window,
    operationKey: body.idempotencyKey,
  });

  try {
    const run = await withQuota(
      usage,
      {
        userId: user.id,
        featureKey: 'MONTHLY_LETTERS',
        amount: 1,
        idempotencyKey,
        window,
        limit: decision.limit,
      },
      async () => {
        const rendered = renderLetter(template, body.fieldValues);

        const blocking = rendered.issues.filter((i) => i.message.endsWith('is required.'));
        if (blocking.length > 0) {
          throw new AppError('VALIDATION_FAILED', blocking[0]!.message, {
            meta: { fields: blocking.map((i) => i.fieldKey) },
          });
        }

        const content = appendEvidence(rendered.content, evidenceAppendix(attached));

        const { data, error } = await admin
          .from('generated_documents')
          .insert({
            user_id: user.id,
            case_id: body.caseId,
            template_key: template.key,
            title: template.name,
            content,
            field_values: body.fieldValues,
            attachments: attachmentsFrom(attached),
            // DRAFT until the user explicitly confirms they reviewed it.
            status: 'DRAFT',
            ai_phrasing_used: false,
          })
          .select(LETTER_COLUMNS)
          .single();

        if (error !== null || data === null) {
          throw new Error(`letter insert failed: ${error?.code ?? 'unknown'}`);
        }

        await admin.from('case_events').insert({
          case_id: body.caseId,
          user_id: user.id,
          event_type: 'LETTER_DRAFTED',
          title: 'Letter drafted',
          detail: template.name,
          origin: 'USER',
        });

        const row = data as unknown as LetterRow;
        return {
          letter: publicLetter({ ...row, attachments: Array.isArray(row.attachments) ? row.attachments : [] }),
          issues: rendered.issues,
          usedFields: rendered.usedFields,
        };
      },
      {
        // A validation rejection happens before any work, so the credit is
        // returned rather than spent on a rejected request.
        classifyFailure: (error) =>
          error instanceof AppError && error.code === 'VALIDATION_FAILED'
            ? 'INVALID_INPUT_REJECTED_BEFORE_PROCESSING'
            : 'INFRASTRUCTURE_FAILURE',
      },
    );

    return ok(
      context,
      {
        ...run.value,
        disclaimer: DISCLAIMERS.LETTER_DRAFT,
        confirmation: DISCLAIMERS.LETTER_FINALIZE,
        quota: {
          remaining: run.remaining,
          limit: decision.limit,
          resetAt: decision.resetAt,
        },
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

async function resolveEvidence(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  caseId: string,
  wanted: { documentIds: string[]; findingIds: string[] },
): Promise<{ documents: AttachedDocument[]; findings: AttachedFinding[] }> {
  const documents: AttachedDocument[] = [];
  if (wanted.documentIds.length > 0) {
    const { data } = await admin
      .from('documents')
      .select('id, original_filename, document_type, created_at')
      .eq('user_id', userId)
      .eq('case_id', caseId)
      .is('deleted_at', null)
      .in('id', wanted.documentIds);
    for (const d of (data ?? []) as { id: string; original_filename: string | null; document_type: string; created_at: string }[]) {
      const uploaded = new Date(d.created_at).toLocaleDateString('en-US', { dateStyle: 'medium', timeZone: 'UTC' });
      documents.push({ id: d.id, label: `${d.original_filename ?? 'Document'} (uploaded ${uploaded})` });
    }
  }

  let findings: AttachedFinding[] = [];
  if (wanted.findingIds.length > 0) {
    const wantedSet = new Set(wanted.findingIds);
    findings = (await latestFindings(admin, userId, caseId))
      .filter((f) => wantedSet.has(f.id))
      .map((f) => ({ id: f.id, label: f.title, explanation: f.explanation, evidence: f.evidence }));
  }

  return { documents, findings };
}
