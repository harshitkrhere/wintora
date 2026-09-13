/**
 * Build a case bundle and put it where a signed link can reach it.
 *
 * The bundle is a ZIP: a README, the case summary, every letter as its own
 * file, and (if asked) the original uploads. It is written to the private
 * bucket under {user_id}/exports/{export_id}.zip and the customer receives a
 * signed URL that expires. The object is removed by the retention sweep once
 * the link has, so an export never outlives its link.
 *
 * A Vercel function cannot return a body this size directly (4.5 MB cap),
 * and Supabase's free tier caps an object at 50 MB, so the bundle stops
 * adding documents at 45 MB and says which were left out.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { POLICY } from '@/config/policy';
import {
  caseSummaryDocument,
  letterDocument,
  manifestText,
  safeFilename,
  type BundleCase,
} from '@/domain/export/bundle';
import { renderDocx } from '@/domain/export/docx';
import { renderPdf } from '@/domain/export/pdf';
import { buildZip, type ZipEntry } from '@/domain/export/zip';
import { loadCase } from '@/lib/cases/load';
import { serverEnv } from '@/lib/env';
import { readObject } from '@/lib/documents/storage';

const MAX_BUNDLE_BYTES = 45 * 1024 * 1024;

export interface BuiltExport {
  readonly id: string;
  readonly url: string;
  readonly expiresAt: string;
  readonly byteSize: number;
  readonly fileCount: number;
  readonly omitted: readonly string[];
}

export async function buildCaseExport(
  admin: SupabaseClient,
  input: {
    userId: string;
    caseId: string;
    format: 'pdf' | 'docx';
    includeDocuments: boolean;
    now?: Date;
  },
): Promise<BuiltExport> {
  const now = input.now ?? new Date();
  const detail = await loadCase(admin, input.userId, input.caseId);
  if (detail === null) throw new Error('case not found');

  // Letters need their text; the case loader carries only the list.
  const { data: letterRows } = await admin
    .from('generated_documents')
    .select('id, title, content, status, created_at, user_confirmed_at')
    .eq('user_id', input.userId)
    .eq('case_id', input.caseId)
    .is('deleted_at', null)
    .order('created_at', { ascending: true });

  const letters = ((letterRows ?? []) as {
    id: string; title: string; content: string; status: string; created_at: string; user_confirmed_at: string | null;
  }[]).map((l) => ({
    id: l.id,
    title: l.title,
    content: l.content,
    status: l.status,
    createdAt: l.created_at,
    confirmedAt: l.user_confirmed_at,
  }));

  const bundle: BundleCase = {
    title: detail.summary.title,
    providerName: detail.summary.providerName,
    status: detail.summary.status,
    amountCents: detail.summary.amountCents,
    currency: detail.summary.currency,
    statementDate: detail.summary.statementDate,
    accountReference: detail.summary.accountReference,
    memberLabel: detail.summary.memberLabel,
    notes: detail.notes,
    createdAt: detail.summary.createdAt,
    analyses: detail.analyses
      .filter((a) => a.status === 'COMPLETED')
      .map((a) => ({
        analysisType: a.analysisType,
        engineVersion: a.engineVersion,
        completedAt: a.completedAt ?? a.createdAt,
        findings: a.findings.map((f) => ({
          severity: f.severity,
          title: f.title,
          explanation: f.explanation,
          ...(f.recommendedAction !== undefined ? { recommendedAction: f.recommendedAction } : {}),
          confidence: f.confidence,
          evidence: f.evidence.map((e) => ({
            fieldPath: e.fieldPath,
            observed: e.observed,
            ...(e.expected !== undefined ? { expected: e.expected } : {}),
          })),
        })),
      })),
    letters,
    events: [...detail.events].reverse().map((e) => ({
      occurredAt: e.occurredAt,
      title: e.title,
      detail: e.detail,
      origin: e.origin,
    })),
    documents: detail.documents.map((d) => ({
      id: d.id,
      filename: d.filename,
      mimeType: d.mimeType,
      byteSize: d.byteSize,
      uploadedAt: d.createdAt,
    })),
    dates: detail.deadlines.map((d) => ({
      label: d.label,
      dueDate: d.dueDate,
      verified: d.verified,
      completed: d.completedAt !== null,
    })),
  };

  const render = input.format === 'pdf' ? renderPdf : renderDocx;
  const ext = input.format;
  const entries: ZipEntry[] = [];
  const files: string[] = [];
  const omitted: string[] = [];
  let total = 0;

  const add = (name: string, data: Uint8Array): void => {
    entries.push({ name, data, modified: now });
    files.push(name);
    total += data.length;
  };

  add(`case-summary.${ext}`, render(caseSummaryDocument(bundle, now)));

  const usedNames = new Set<string>();
  letters.forEach((letter, i) => {
    let name = `letters/${String(i + 1).padStart(2, '0')} - ${safeFilename(letter.title, 'letter')}.${ext}`;
    while (usedNames.has(name)) name = name.replace(/(\.\w+)$/, ` (copy)$1`);
    usedNames.add(name);
    add(name, render(letterDocument(letter)));
  });

  if (input.includeDocuments && detail.documents.length > 0) {
    const { data: docRows } = await admin
      .from('documents')
      .select('id, original_filename, storage_path, byte_size, scan_status')
      .eq('user_id', input.userId)
      .eq('case_id', input.caseId)
      .is('deleted_at', null)
      .order('created_at', { ascending: true });

    const docNames = new Set<string>();
    for (const doc of (docRows ?? []) as {
      id: string; original_filename: string | null; storage_path: string | null; byte_size: number; scan_status: string;
    }[]) {
      const label = doc.original_filename ?? `document-${doc.id.slice(0, 8)}`;
      if (doc.scan_status !== 'CLEAN' || doc.storage_path === null) {
        omitted.push(`${label} (the file was not accepted, so it is not on the account)`);
        continue;
      }
      if (total + doc.byte_size > MAX_BUNDLE_BYTES) {
        omitted.push(`${label} (the bundle would exceed its size limit; download it from the case page)`);
        continue;
      }
      const bytes = await readObject(admin, doc.storage_path);
      if (bytes === null) {
        omitted.push(`${label} (could not be read from storage)`);
        continue;
      }
      let name = `documents/${safeFilename(label, `document-${doc.id.slice(0, 8)}`)}`;
      while (docNames.has(name)) name = `${name} (copy)`;
      docNames.add(name);
      add(name, bytes);
    }
  } else if (!input.includeDocuments && detail.documents.length > 0) {
    omitted.push('Uploaded documents (not requested for this export)');
  }

  const readme = manifestText({
    caseTitle: bundle.title,
    format: input.format,
    exportedAt: now,
    files,
    omitted,
  });
  entries.unshift({ name: 'README.txt', data: new TextEncoder().encode(readme), modified: now });

  const zip = buildZip(entries);
  const bucket = serverEnv().SUPABASE_DOCUMENTS_BUCKET;
  const expiresAt = new Date(now.getTime() + POLICY.export.linkTtlMinutes * 60 * 1000);

  const { data: row, error: insertError } = await admin
    .from('case_exports')
    .insert({
      user_id: input.userId,
      case_id: input.caseId,
      format: input.format,
      includes_documents: input.includeDocuments,
      byte_size: zip.length,
      file_count: entries.length,
      omitted,
      expires_at: expiresAt.toISOString(),
    })
    .select('id')
    .single();
  if (insertError !== null || row === null) {
    throw new Error(`case_exports insert failed: ${insertError?.code ?? 'unknown'}`);
  }
  const exportId = (row as { id: string }).id;
  const path = `${input.userId}/exports/${exportId}.zip`;

  const { error: uploadError } = await admin.storage.from(bucket).upload(path, zip, {
    contentType: 'application/zip',
    upsert: false,
  });
  if (uploadError !== null) {
    await admin.from('case_exports').update({ deleted_at: now.toISOString() }).eq('id', exportId);
    throw new Error(`export upload failed: ${uploadError.message}`);
  }
  await admin.from('case_exports').update({ storage_path: path }).eq('id', exportId);

  const url = await signedExportUrl(admin, path, bundle.title, expiresAt, now);

  return {
    id: exportId,
    url,
    expiresAt: expiresAt.toISOString(),
    byteSize: zip.length,
    fileCount: entries.length,
    omitted,
  };
}

/** A download link that dies with the export. */
export async function signedExportUrl(
  admin: SupabaseClient,
  path: string,
  caseTitle: string,
  expiresAt: Date,
  now: Date = new Date(),
): Promise<string> {
  const bucket = serverEnv().SUPABASE_DOCUMENTS_BUCKET;
  const ttl = Math.max(60, Math.floor((expiresAt.getTime() - now.getTime()) / 1000));
  const { data, error } = await admin.storage
    .from(bucket)
    .createSignedUrl(path, ttl, { download: `${safeFilename(caseTitle, 'case')} - Wintora export.zip` });
  if (error !== null || data === null) {
    throw new Error(`signed url failed: ${error?.message ?? 'no data'}`);
  }
  return data.signedUrl;
}
