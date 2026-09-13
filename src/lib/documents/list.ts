/**
 * Every document a person has, across their cases, for the Documents
 * screen and the recent list on Home. Metadata only, as always: nothing
 * here touches the file bytes or the figures read from them.
 *
 * Scoped by user_id from the session, never by anything a client sends. A
 * document whose case has since been deleted is left out; a kept document
 * is one whose scan came back CLEAN, so refused, failed and abandoned
 * uploads never appear here (they are shown, and marked, on the case's
 * own documents screen).
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export interface DocumentListItem {
  readonly id: string;
  readonly caseId: string;
  readonly caseTitle: string;
  readonly filename: string | null;
  readonly mimeType: string;
  readonly documentType: string;
  readonly pageCount: number | null;
  readonly extractionStatus: string;
  readonly retentionUntil: string | null;
  readonly createdAt: string;
}

export interface LetterListItem {
  readonly id: string;
  readonly caseId: string;
  readonly caseTitle: string;
  readonly title: string;
  readonly status: string;
  readonly sentAt: string | null;
  readonly updatedAt: string;
}

type CaseEmbed = { title: string; deleted_at: string | null } | null;

export async function listDocuments(
  admin: SupabaseClient,
  userId: string,
  { limit = 200 }: { limit?: number } = {},
): Promise<DocumentListItem[]> {
  const { data } = await admin
    .from('documents')
    .select(
      'id, case_id, original_filename, mime_type, document_type, page_count, extraction_status, retention_until, created_at, cases(title, deleted_at)',
    )
    .eq('user_id', userId)
    .is('deleted_at', null)
    .eq('scan_status', 'CLEAN')
    .not('case_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(limit);

  const rows = (data ?? []) as unknown as {
    id: string; case_id: string; original_filename: string | null; mime_type: string; document_type: string;
    page_count: number | null; extraction_status: string; retention_until: string | null; created_at: string;
    cases: CaseEmbed;
  }[];

  return rows
    .filter((row) => row.cases !== null && row.cases.deleted_at === null)
    .map((row) => ({
      id: row.id,
      caseId: row.case_id,
      caseTitle: row.cases!.title,
      filename: row.original_filename,
      mimeType: row.mime_type,
      documentType: row.document_type,
      pageCount: row.page_count,
      extractionStatus: row.extraction_status,
      retentionUntil: row.retention_until,
      createdAt: row.created_at,
    }));
}

export async function listLetters(
  admin: SupabaseClient,
  userId: string,
  { limit = 200 }: { limit?: number } = {},
): Promise<LetterListItem[]> {
  const { data } = await admin
    .from('generated_documents')
    .select('id, case_id, title, status, sent_at, updated_at, cases(title, deleted_at)')
    .eq('user_id', userId)
    .is('deleted_at', null)
    .neq('status', 'ARCHIVED')
    .order('updated_at', { ascending: false })
    .limit(limit);

  const rows = (data ?? []) as unknown as {
    id: string; case_id: string; title: string; status: string; sent_at: string | null; updated_at: string;
    cases: CaseEmbed;
  }[];

  return rows
    .filter((row) => row.cases !== null && row.cases.deleted_at === null)
    .map((row) => ({
      id: row.id,
      caseId: row.case_id,
      caseTitle: row.cases!.title,
      title: row.title,
      status: row.status,
      sentAt: row.sent_at,
      updatedAt: row.updated_at,
    }));
}
