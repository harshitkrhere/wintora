/**
 * POST /api/analyses
 *
 * Runs an analysis against a case. This route is the reference implementation
 * of the metered pattern:
 *
 *   authorize (entitlement + ownership)
 *     -> reserve quota atomically, keyed on a client idempotency key
 *       -> run the DETERMINISTIC engine
 *         -> persist findings and evidence
 *       -> commit on success, roll back on infrastructure failure
 *
 * A retry consumes nothing extra. A failure that is not the customer's fault
 * returns the credit. Ten concurrent requests against a limit of two grant
 * exactly two.
 */

import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { analyzeBill, analyzeBillAgainstEob, headline, suggestedActions } from '@/domain/analysis/engine';
import type { AnalysisResult, BillDocument, EobDocument } from '@/domain/analysis/types';
import { quotaWindow } from '@/domain/usage/period';
import { freeSnapshot } from '@/domain/entitlements/compute';
import { buildIdempotencyKey, withQuota, QuotaExceededError } from '@/domain/usage/meter';
import { DISCLAIMERS } from '@/config/disclaimers';
import { AppError } from '@/lib/errors';
import { authorize, handler, ok, parseBody, requireUser } from '@/lib/http/api';
import { clientIp, enforceRateLimit } from '@/lib/http/ratelimit';
import {
  billDocumentSchema,
  eobDocumentSchema,
  idempotencyKeySchema,
} from '@/lib/http/schemas';
import { createAdminClient } from '@/lib/supabase/server';
import { createEntitlementStore, createUsageStore } from '@/lib/supabase/stores';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  caseId: z.string().uuid(),
  idempotencyKey: idempotencyKeySchema,
  bill: billDocumentSchema,
  eob: eobDocumentSchema.optional(),
  /** The uploaded documents the figures were confirmed from, when there are any. */
  documentId: z.string().uuid().optional(),
  compareDocumentId: z.string().uuid().optional(),
});

export const POST = handler('/api/analyses', async (request: NextRequest, context) => {
  const user = await requireUser();
  enforceRateLimit('ANALYSIS', { userId: user.id, ip: clientIp(request.headers) });

  const body = await parseBody(request, bodySchema);
  const wantsComparison = body.eob !== undefined;

  // 1. Entitlement AND ownership. Being on Pro does not entitle you to analyse
  //    someone else's case.
  if (wantsComparison) {
    await authorize(user, {
      feature: 'EOB_COMPARISON',
      resource: { type: 'case', id: body.caseId },
      action: 'execute',
    });
  }

  // An EOB with lines is the two documents reconciled line by line, which is
  // what ADVANCED_DOCUMENT_ANALYSIS is. Totals alone are the basic comparison
  // every plan includes.
  const lineLevel = body.eob !== undefined && body.eob.lines.length > 0;
  if (lineLevel) {
    await authorize(user, {
      feature: 'ADVANCED_DOCUMENT_ANALYSIS',
      resource: { type: 'case', id: body.caseId },
      action: 'execute',
    });
  }

  // The documents named must be this user's and on this case; otherwise the
  // run proceeds without the link rather than recording a foreign id.
  const admin = createAdminClient();
  const documentIds = await ownedDocumentsOnCase(admin, user.id, body.caseId, [
    body.documentId,
    body.compareDocumentId,
  ]);

  const decision = await authorize(user, {
    feature: 'MONTHLY_ANALYSES',
    resource: { type: 'case', id: body.caseId },
    action: 'execute',
    amount: 1,
  });

  const store = createEntitlementStore(admin);
  const usage = createUsageStore(admin);

  const subscription = (await store.getSubscription(user.id)) ?? freeSnapshot(new Date());
  const window = quotaWindow(subscription);

  const idempotencyKey = buildIdempotencyKey({
    userId: user.id,
    featureKey: 'MONTHLY_ANALYSES',
    window,
    operationKey: body.idempotencyKey,
  });

  try {
    const run = await withQuota(
      usage,
      {
        userId: user.id,
        featureKey: 'MONTHLY_ANALYSES',
        amount: 1,
        idempotencyKey,
        window,
        limit: decision.limit,
      },
      async () => {
        // 2. The deterministic engine. No model is involved in deciding what is
        //    true; the AI layer only ever rephrases these findings later.
        const bill = body.bill as BillDocument;
        const result: AnalysisResult =
          body.eob !== undefined
            ? analyzeBillAgainstEob(bill, body.eob as EobDocument)
            : analyzeBill(bill);

        await persistAnalysis(admin, user.id, body.caseId, result, {
          documentId: documentIds[0] ?? null,
          compareDocumentId: documentIds[1] ?? null,
        });
        await recordConfirmedFigures(admin, user.id, body.caseId, bill);
        return result;
      },
    );

    return ok(
      context,
      {
        analysis: run.value,
        headline: headline(run.value),
        nextSteps: suggestedActions(run.value, { savedToCase: true }),
        disclaimer: wantsComparison
          ? DISCLAIMERS.EOB_COMPARISON
          : DISCLAIMERS.ANALYSIS_RESULT,
        quota: {
          remaining: run.remaining,
          limit: decision.limit,
          resetAt: decision.resetAt,
        },
        // True when this was a retry of an operation already paid for.
        replayed: run.replayed,
      },
      201,
    );
  } catch (error) {
    if (error instanceof QuotaExceededError) {
      throw new AppError('QUOTA_EXCEEDED', decision.message, {
        detail: `quota exhausted for ${error.featureKey}`,
        meta: { feature: error.featureKey, limit: error.limit, used: error.used },
      });
    }
    throw error;
  }
});

/**
 * The figures the customer confirmed, onto the case, so the list of cases can
 * say what each bill is for and how much it asks. Only what was given is
 * written; a field left blank on the form never blanks one already on the
 * case. Best effort: a failure here must not undo an analysis already paid
 * for, so nothing is thrown.
 */
async function recordConfirmedFigures(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  caseId: string,
  bill: BillDocument,
): Promise<void> {
  const patch: Record<string, unknown> = {};
  const amount = bill.amountDueCents ?? bill.totalCents;
  if (amount !== undefined) {
    patch.amount_cents = amount;
    patch.currency = bill.currency;
  }
  if (bill.statementDate !== undefined) patch.statement_date = bill.statementDate;
  if (bill.providerName !== undefined && bill.providerName.trim().length > 0) {
    patch.provider_name = bill.providerName.trim().slice(0, 200);
  }
  if (Object.keys(patch).length === 0) return;
  await admin.from('cases').update(patch).eq('id', caseId).eq('user_id', userId);
}

/** Which of the named document ids are really this user's, on this case. */
async function ownedDocumentsOnCase(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  caseId: string,
  ids: readonly (string | undefined)[],
): Promise<(string | null)[]> {
  const wanted = ids.filter((id): id is string => id !== undefined);
  if (wanted.length === 0) return ids.map(() => null);
  const { data } = await admin
    .from('documents')
    .select('id')
    .eq('user_id', userId)
    .eq('case_id', caseId)
    .is('deleted_at', null)
    .in('id', wanted);
  const owned = new Set(((data ?? []) as { id: string }[]).map((d) => d.id));
  return ids.map((id) => (id !== undefined && owned.has(id) ? id : null));
}

async function persistAnalysis(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  caseId: string,
  result: AnalysisResult,
  documents: { documentId: string | null; compareDocumentId: string | null },
): Promise<void> {
  const { data: analysis, error } = await admin
    .from('analyses')
    .insert({
      user_id: userId,
      case_id: caseId,
      document_id: documents.documentId,
      compare_document_id: documents.compareDocumentId,
      analysis_type: result.analysisType,
      engine_version: result.engineVersion,
      status: 'COMPLETED',
      cost_level: result.analysisType === 'BILL_VS_EOB' ? 'MEDIUM' : 'LOW',
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
    })
    .select('id')
    .single();

  if (error !== null || analysis === null) {
    // Thrown inside withQuota, so the reservation is rolled back: a storage
    // failure is not the customer's fault and must not cost them a credit.
    throw new Error(`analysis insert failed: ${error?.code ?? 'unknown'}`);
  }

  const analysisId = (analysis as { id: string }).id;

  for (const finding of result.findings) {
    const { data: findingRow, error: findingError } = await admin
      .from('analysis_findings')
      .insert({
        analysis_id: analysisId,
        user_id: userId,
        code: finding.code,
        severity: finding.severity,
        title: finding.title,
        explanation: finding.explanation,
        recommended_action: finding.recommendedAction ?? null,
        confidence: finding.confidence,
        // Always false, and the database has a CHECK constraint that agrees.
        is_ai_generated: false,
        ai_phrasing_used: false,
      })
      .select('id')
      .single();

    if (findingError !== null || findingRow === null) continue;

    const findingId = (findingRow as { id: string }).id;

    if (finding.evidence.length > 0) {
      await admin.from('finding_evidence').insert(
        finding.evidence.map((e) => ({
          finding_id: findingId,
          user_id: userId,
          page_number: e.page ?? null,
          field_path: e.fieldPath,
          observed: e.observed,
          expected: e.expected ?? null,
        })),
      );
    }
  }

  await admin.from('case_events').insert({
    case_id: caseId,
    user_id: userId,
    event_type: 'ANALYSIS_COMPLETED',
    title: 'Analysis completed',
    detail: `${result.findings.length} finding(s)`,
    origin: 'SYSTEM',
  });
}
