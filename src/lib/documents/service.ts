/**
 * Shared helpers for the document routes.
 *
 * Kept out of the route files so that the five routes read as five short
 * stories about authorization and stay under the same ownership check.
 */

import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { NextRequest } from 'next/server';
import { AppError } from '@/lib/errors';
import { uuidSchema } from '@/lib/http/api';

export const MB = 1024 * 1024;

export interface DocumentRow {
  readonly id: string;
  readonly user_id: string;
  readonly case_id: string | null;
  readonly storage_path: string | null;
  readonly original_filename: string | null;
  readonly mime_type: string;
  readonly byte_size: number;
  readonly sha256: string;
  readonly document_type: string;
  readonly page_count: number | null;
  readonly scan_status: 'PENDING' | 'CLEAN' | 'INFECTED' | 'FAILED' | 'SKIPPED';
  readonly scan_detail: string | null;
  readonly extraction_status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELED';
  readonly retention_until: string | null;
  readonly created_at: string;
  readonly deleted_at: string | null;
}

export const DOCUMENT_COLUMNS =
  'id, user_id, case_id, storage_path, original_filename, mime_type, byte_size, sha256, ' +
  'document_type, page_count, scan_status, scan_detail, extraction_status, retention_until, ' +
  'created_at, deleted_at';

/** The document id from /api/documents/{id}/..., validated as a UUID. */
export function documentIdFromPath(request: NextRequest): string {
  const segments = request.nextUrl.pathname.split('/').filter((s) => s.length > 0);
  const index = segments.indexOf('documents');
  const raw = index >= 0 ? segments[index + 1] : undefined;
  const parsed = uuidSchema.safeParse(raw);
  if (!parsed.success) throw new AppError('NOT_FOUND', 'That document does not exist.');
  return parsed.data;
}

/**
 * Load a document the user owns, or fail as not-found. Ownership failures are
 * indistinguishable from absence on purpose: "this belongs to someone else" is
 * an oracle.
 */
export async function loadOwnedDocument(
  admin: SupabaseClient,
  userId: string,
  documentId: string,
): Promise<DocumentRow> {
  const { data, error } = await admin
    .from('documents')
    .select(DOCUMENT_COLUMNS)
    .eq('id', documentId)
    .eq('user_id', userId)
    .is('deleted_at', null)
    .maybeSingle();

  if (error !== null || data === null) {
    throw new AppError('NOT_FOUND', 'That document does not exist.');
  }
  return data as unknown as DocumentRow;
}

/** Live bytes stored by this user, for the STORAGE_LIMIT_MB check. */
export async function storedBytesFor(admin: SupabaseClient, userId: string): Promise<number> {
  const { data } = await admin
    .from('documents')
    .select('byte_size')
    .eq('user_id', userId)
    .eq('scan_status', 'CLEAN')
    .is('deleted_at', null);
  return ((data ?? []) as { byte_size: number }[]).reduce((sum, r) => sum + r.byte_size, 0);
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** What the client is allowed to see. Never storage_path or the user id. */
export function publicDocument(row: DocumentRow): Record<string, unknown> {
  return {
    id: row.id,
    caseId: row.case_id,
    filename: row.original_filename,
    mimeType: row.mime_type,
    byteSize: row.byte_size,
    documentType: row.document_type,
    pageCount: row.page_count,
    scanStatus: row.scan_status,
    scanDetail: row.scan_detail,
    extractionStatus: row.extraction_status,
    retentionUntil: row.retention_until,
    createdAt: row.created_at,
  };
}
