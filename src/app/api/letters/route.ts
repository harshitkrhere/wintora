/**
 * POST /api/letters
 *
 * Generates a letter DRAFT for the user to review, edit and send themselves.
 * Wintora never sends anything on a user's behalf: no email, no fax, no filing,
 * no phone call. See docs/AI_SAFETY.md.
 */

import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { DISCLAIMERS } from '@/config/disclaimers';
import { renderLetter, type LetterTemplate } from '@/domain/letters/render';
import { buildIdempotencyKey, withQuota, QuotaExceededError } from '@/domain/usage/meter';
import { quotaWindow } from '@/domain/usage/period';
import { freeSnapshot } from '@/domain/entitlements/compute';
import { AppError } from '@/lib/errors';
import { authorize, handler, ok, parseBody, requireUser } from '@/lib/http/api';
import { clientIp, enforceRateLimit } from '@/lib/http/ratelimit';
import { idempotencyKeySchema } from '@/lib/http/schemas';
import { createAdminClient } from '@/lib/supabase/server';
import { createEntitlementStore, createUsageStore } from '@/lib/supabase/stores';

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
});

export const POST = handler('/api/letters', async (request: NextRequest, context) => {
  const user = await requireUser();
  enforceRateLimit('LETTER', { userId: user.id, ip: clientIp(request.headers) });

  const body = await parseBody(request, bodySchema);
  const admin = createAdminClient();

  const { data: templateRow } = await admin
    .from('templates')
    .select('key, name, description, category, fields, body_template, is_premium, review_status')
    .eq('key', body.templateKey)
    .maybeSingle();

  if (templateRow === null || templateRow === undefined) {
    throw new AppError('NOT_FOUND', 'We could not find that template.');
  }

  const raw = templateRow as unknown as {
    key: string;
    name: string;
    description: string;
    category: string;
    fields: unknown;
    body_template: string;
    is_premium: boolean;
    review_status: LetterTemplate['reviewStatus'];
  };

  // Unreviewed templates are never rendered for a user. A draft template is one
  // that has not passed editorial or legal review, and serving it would be
  // exactly the failure mode the review process exists to prevent.
  if (raw.review_status !== 'PUBLISHED') {
    throw new AppError(
      'NOT_FOUND',
      'That template is not available yet. We are still reviewing it.',
      { detail: `template ${raw.key} has review_status=${raw.review_status}` },
    );
  }

  const template: LetterTemplate = {
    key: raw.key,
    name: raw.name,
    description: raw.description,
    category: raw.category,
    fields: raw.fields as LetterTemplate['fields'],
    bodyTemplate: raw.body_template,
    isPremium: raw.is_premium,
    reviewStatus: raw.review_status,
  };

  if (template.isPremium) {
    await authorize(user, {
      feature: 'PREMIUM_TEMPLATES',
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

        const blocking = rendered.issues.filter((i) =>
          i.message.endsWith('is required.'),
        );
        if (blocking.length > 0) {
          throw new AppError('VALIDATION_FAILED', blocking[0]!.message, {
            meta: { fields: blocking.map((i) => i.fieldKey) },
          });
        }

        const { data, error } = await admin
          .from('generated_documents')
          .insert({
            user_id: user.id,
            case_id: body.caseId,
            template_key: template.key,
            title: template.name,
            content: rendered.content,
            field_values: body.fieldValues,
            // DRAFT until the user explicitly confirms they reviewed it.
            status: 'DRAFT',
            ai_phrasing_used: false,
          })
          .select('id, title, content, status, created_at')
          .single();

        if (error !== null || data === null) {
          throw new Error(`letter insert failed: ${error?.code ?? 'unknown'}`);
        }

        return { document: data, issues: rendered.issues, usedFields: rendered.usedFields };
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
