/**
 * Everything a case page shows, assembled once, behind one ownership check.
 *
 * A case is the unit a customer thinks in: one bill, its documents, what the
 * checks found, and what happened when. The tables already hold all of it;
 * this is the read side. Nothing here writes.
 *
 * Ownership is enforced twice: the query filters on user_id, and RLS on
 * every table does the same independently. A foreign id returns null, never
 * "this belongs to someone else".
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Finding, Severity, Confidence } from '@/domain/analysis/types';

export interface CaseSummary {
  readonly id: string;
  readonly title: string;
  readonly providerName: string | null;
  readonly status: string;
  readonly amountCents: number | null;
  readonly currency: string | null;
  readonly statementDate: string | null;
  readonly accountReference: string | null;
  /** Who the bill is for, when the case has been assigned to a household member. */
  readonly memberLabel: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly documentCount: number;
  readonly analysisCount: number;
  /** Highest severity across the latest analysis, or null if none ran. */
  readonly attention: Severity | null;
}

export interface CaseDocument {
  readonly id: string;
  readonly filename: string | null;
  readonly mimeType: string;
  readonly byteSize: number;
  readonly pageCount: number | null;
  readonly scanStatus: string;
  readonly extractionStatus: string;
  readonly retentionUntil: string | null;
  readonly createdAt: string;
}

export interface CaseAnalysis {
  readonly id: string;
  readonly analysisType: string;
  readonly engineVersion: string;
  readonly status: string;
  readonly completedAt: string | null;
  readonly createdAt: string;
  readonly findings: readonly Finding[];
}

export interface CaseEvent {
  readonly id: string;
  readonly eventType: string;
  readonly title: string;
  readonly detail: string | null;
  readonly origin: string;
  readonly occurredAt: string;
}

export interface CaseLetter {
  readonly id: string;
  readonly templateKey: string;
  readonly title: string;
  readonly status: string;
  readonly attachmentCount: number;
  readonly confirmedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CaseReminder {
  readonly id: string;
  readonly title: string;
  readonly detail: string | null;
  readonly remindAt: string;
  readonly completedAt: string | null;
  readonly notifiedAt: string | null;
}

export interface CaseDeadline {
  readonly id: string;
  readonly label: string;
  readonly dueDate: string;
  /** True only when a source is cited; the database refuses the other case. */
  readonly verified: boolean;
  readonly notes: string | null;
  readonly completedAt: string | null;
}

export interface CaseMember {
  readonly label: string;
  readonly relationship: string | null;
}

/**
 * A document the retention sweep has removed. The file is gone; whether the
 * figures read from it were kept depends on EXTENDED_HISTORY at the time.
 */
export interface RemovedDocument {
  readonly id: string;
  readonly filename: string | null;
  readonly removedAt: string;
  readonly figuresKept: boolean;
}

export interface CaseDetail {
  readonly summary: CaseSummary;
  readonly notes: string | null;
  readonly documents: readonly CaseDocument[];
  readonly removedDocuments: readonly RemovedDocument[];
  readonly analyses: readonly CaseAnalysis[];
  readonly events: readonly CaseEvent[];
  readonly letters: readonly CaseLetter[];
  readonly reminders: readonly CaseReminder[];
  readonly deadlines: readonly CaseDeadline[];
  readonly member: CaseMember | null;
}

const SEVERITY_RANK: Record<Severity, number> = { INFO: 0, REVIEW: 1, ATTENTION: 2 };

function worst(severities: readonly Severity[]): Severity | null {
  let top: Severity | null = null;
  for (const s of severities) {
    if (top === null || SEVERITY_RANK[s] > SEVERITY_RANK[top]) top = s;
  }
  return top;
}

export async function listCases(admin: SupabaseClient, userId: string): Promise<CaseSummary[]> {
  const { data: rows } = await admin
    .from('cases')
    .select('id, title, provider_name, status, amount_cents, currency, statement_date, account_reference, created_at, updated_at')
    .eq('user_id', userId)
    .is('deleted_at', null)
    .order('updated_at', { ascending: false });

  const cases = (rows ?? []) as {
    id: string; title: string; provider_name: string | null; status: string;
    amount_cents: number | null; currency: string | null; statement_date: string | null;
    account_reference: string | null; created_at: string; updated_at: string;
  }[];
  if (cases.length === 0) return [];

  const ids = cases.map((c) => c.id);

  // Counts, the latest verdict and the household member, in three queries
  // rather than 3N.
  const [{ data: docs }, { data: analyses }, { data: members }] = await Promise.all([
    admin.from('documents').select('case_id').eq('user_id', userId).in('case_id', ids).is('deleted_at', null),
    admin
      .from('analyses')
      .select('id, case_id, created_at, analysis_findings(severity)')
      .eq('user_id', userId)
      .in('case_id', ids)
      .eq('status', 'COMPLETED')
      .order('created_at', { ascending: false }),
    admin.from('case_members').select('case_id, member_label').eq('user_id', userId).in('case_id', ids),
  ]);

  const memberByCase = new Map<string, string>();
  for (const m of (members ?? []) as { case_id: string; member_label: string }[]) {
    memberByCase.set(m.case_id, m.member_label);
  }

  const docCount = new Map<string, number>();
  for (const d of (docs ?? []) as { case_id: string }[]) {
    docCount.set(d.case_id, (docCount.get(d.case_id) ?? 0) + 1);
  }

  const analysisCount = new Map<string, number>();
  const latestAttention = new Map<string, Severity | null>();
  for (const a of (analyses ?? []) as { case_id: string; analysis_findings: { severity: Severity }[] | null }[]) {
    analysisCount.set(a.case_id, (analysisCount.get(a.case_id) ?? 0) + 1);
    // Ordered newest first, so the first one seen per case is the latest.
    if (!latestAttention.has(a.case_id)) {
      latestAttention.set(a.case_id, worst((a.analysis_findings ?? []).map((f) => f.severity)));
    }
  }

  return cases.map((c) => ({
    id: c.id,
    title: c.title,
    providerName: c.provider_name,
    status: c.status,
    amountCents: c.amount_cents,
    currency: c.currency,
    statementDate: c.statement_date,
    accountReference: c.account_reference,
    memberLabel: memberByCase.get(c.id) ?? null,
    createdAt: c.created_at,
    updatedAt: c.updated_at,
    documentCount: docCount.get(c.id) ?? 0,
    analysisCount: analysisCount.get(c.id) ?? 0,
    attention: latestAttention.get(c.id) ?? null,
  }));
}

export async function loadCase(
  admin: SupabaseClient,
  userId: string,
  caseId: string,
): Promise<CaseDetail | null> {
  const { data: row } = await admin
    .from('cases')
    .select('id, title, provider_name, status, amount_cents, currency, statement_date, account_reference, notes, created_at, updated_at')
    .eq('id', caseId)
    .eq('user_id', userId)
    .is('deleted_at', null)
    .maybeSingle();
  if (row === null || row === undefined) return null;

  const c = row as {
    id: string; title: string; provider_name: string | null; status: string;
    amount_cents: number | null; currency: string | null; statement_date: string | null;
    account_reference: string | null; notes: string | null; created_at: string; updated_at: string;
  };

  const [
    { data: docs },
    { data: removed },
    { data: analyses },
    { data: events },
    { data: letters },
    { data: reminders },
    { data: deadlines },
    { data: member },
  ] = await Promise.all([
    admin
      .from('documents')
      .select('id, original_filename, mime_type, byte_size, page_count, scan_status, extraction_status, retention_until, created_at')
      .eq('user_id', userId)
      .eq('case_id', caseId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false }),
    // Removed by retention. The row stays so the case can say what was here;
    // whether its figures survived is answered by the extraction still existing.
    admin
      .from('documents')
      .select('id, original_filename, deleted_at, document_extractions(id)')
      .eq('user_id', userId)
      .eq('case_id', caseId)
      .not('deleted_at', 'is', null)
      .order('deleted_at', { ascending: false })
      .limit(50),
    admin
      .from('analyses')
      .select(
        'id, analysis_type, engine_version, status, completed_at, created_at, ' +
          'analysis_findings(id, code, severity, title, explanation, recommended_action, confidence, ' +
          'finding_evidence(document_id, page_number, field_path, observed, expected))',
      )
      .eq('user_id', userId)
      .eq('case_id', caseId)
      .order('created_at', { ascending: false }),
    admin
      .from('case_events')
      .select('id, event_type, title, detail, origin, occurred_at')
      .eq('user_id', userId)
      .eq('case_id', caseId)
      .order('occurred_at', { ascending: false })
      .limit(100),
    admin
      .from('generated_documents')
      .select('id, template_key, title, status, attachments, user_confirmed_at, created_at, updated_at')
      .eq('user_id', userId)
      .eq('case_id', caseId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false }),
    admin
      .from('reminders')
      .select('id, title, detail, remind_at, completed_at, notified_at')
      .eq('user_id', userId)
      .eq('case_id', caseId)
      .order('remind_at', { ascending: true }),
    admin
      .from('deadlines')
      .select('id, label, due_date, is_verified, notes, completed_at')
      .eq('user_id', userId)
      .eq('case_id', caseId)
      .order('due_date', { ascending: true }),
    admin
      .from('case_members')
      .select('member_label, relationship')
      .eq('user_id', userId)
      .eq('case_id', caseId)
      .limit(1)
      .maybeSingle(),
  ]);

  type FindingRow = {
    id: string; code: string; severity: Severity; title: string; explanation: string;
    recommended_action: string | null; confidence: Confidence;
    finding_evidence: { document_id: string | null; page_number: number | null; field_path: string | null; observed: Record<string, unknown>; expected: Record<string, unknown> | null }[] | null;
  };
  type AnalysisRow = {
    id: string; analysis_type: string; engine_version: string; status: string;
    completed_at: string | null; created_at: string; analysis_findings: FindingRow[] | null;
  };

  const mappedAnalyses: CaseAnalysis[] = ((analyses ?? []) as unknown as AnalysisRow[]).map((a) => ({
    id: a.id,
    analysisType: a.analysis_type,
    engineVersion: a.engine_version,
    status: a.status,
    completedAt: a.completed_at,
    createdAt: a.created_at,
    findings: (a.analysis_findings ?? []).map((f) => ({
      code: f.code as Finding['code'],
      severity: f.severity,
      title: f.title,
      explanation: f.explanation,
      ...(f.recommended_action ? { recommendedAction: f.recommended_action } : {}),
      confidence: f.confidence,
      evidence: (f.finding_evidence ?? []).map((e) => ({
        documentId: e.document_id ?? 'statement',
        ...(e.page_number !== null ? { page: e.page_number } : {}),
        fieldPath: e.field_path ?? '',
        observed: e.observed ?? {},
        ...(e.expected ? { expected: e.expected } : {}),
      })),
      isAiGenerated: false as const,
    })),
  }));

  const latest = mappedAnalyses.find((a) => a.status === 'COMPLETED');

  return {
    summary: {
      id: c.id,
      title: c.title,
      providerName: c.provider_name,
      status: c.status,
      amountCents: c.amount_cents,
      currency: c.currency,
      statementDate: c.statement_date,
      accountReference: c.account_reference,
      memberLabel: (member as { member_label: string } | null)?.member_label ?? null,
      createdAt: c.created_at,
      updatedAt: c.updated_at,
      documentCount: (docs ?? []).length,
      analysisCount: mappedAnalyses.filter((a) => a.status === 'COMPLETED').length,
      attention: latest ? worst(latest.findings.map((f) => f.severity)) : null,
    },
    notes: c.notes,
    documents: ((docs ?? []) as {
      id: string; original_filename: string | null; mime_type: string; byte_size: number;
      page_count: number | null; scan_status: string; extraction_status: string;
      retention_until: string | null; created_at: string;
    }[]).map((d) => ({
      id: d.id,
      filename: d.original_filename,
      mimeType: d.mime_type,
      byteSize: d.byte_size,
      pageCount: d.page_count,
      scanStatus: d.scan_status,
      extractionStatus: d.extraction_status,
      retentionUntil: d.retention_until,
      createdAt: d.created_at,
    })),
    removedDocuments: ((removed ?? []) as unknown as {
      id: string; original_filename: string | null; deleted_at: string; document_extractions: { id: string }[] | null;
    }[]).map((d) => ({
      id: d.id,
      filename: d.original_filename,
      removedAt: d.deleted_at,
      figuresKept: (d.document_extractions ?? []).length > 0,
    })),
    analyses: mappedAnalyses,
    events: ((events ?? []) as {
      id: string; event_type: string; title: string; detail: string | null; origin: string; occurred_at: string;
    }[]).map((e) => ({
      id: e.id,
      eventType: e.event_type,
      title: e.title,
      detail: e.detail,
      origin: e.origin,
      occurredAt: e.occurred_at,
    })),
    letters: ((letters ?? []) as {
      id: string; template_key: string; title: string; status: string; attachments: unknown[] | null;
      user_confirmed_at: string | null; created_at: string; updated_at: string;
    }[]).map((l) => ({
      id: l.id,
      templateKey: l.template_key,
      title: l.title,
      status: l.status,
      attachmentCount: Array.isArray(l.attachments) ? l.attachments.length : 0,
      confirmedAt: l.user_confirmed_at,
      createdAt: l.created_at,
      updatedAt: l.updated_at,
    })),
    reminders: ((reminders ?? []) as {
      id: string; title: string; detail: string | null; remind_at: string; completed_at: string | null; notified_at: string | null;
    }[]).map((r) => ({
      id: r.id,
      title: r.title,
      detail: r.detail,
      remindAt: r.remind_at,
      completedAt: r.completed_at,
      notifiedAt: r.notified_at,
    })),
    deadlines: ((deadlines ?? []) as {
      id: string; label: string; due_date: string; is_verified: boolean; notes: string | null; completed_at: string | null;
    }[]).map((d) => ({
      id: d.id,
      label: d.label,
      dueDate: d.due_date,
      verified: d.is_verified,
      notes: d.notes,
      completedAt: d.completed_at,
    })),
    member:
      member !== null && member !== undefined
        ? {
            label: (member as { member_label: string }).member_label,
            relationship: (member as { relationship: string | null }).relationship,
          }
        : null,
  };
}
