/**
 * Shared helpers for the letter routes and pages.
 *
 * Templates come from the database (the seed in migrations 0012 and 0019 is
 * the bootstrap; after that an editor changes them there). Only PUBLISHED
 * templates are ever handed to a customer, and a premium one is listed for
 * everyone but rendered only for a plan that includes PREMIUM_TEMPLATES, so
 * the library is visible and the gate is honest.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { LetterTemplate } from '@/domain/letters/render';
import type { Attachment } from '@/domain/letters/evidence';
import { AppError } from '@/lib/errors';

export const TEMPLATE_COLUMNS =
  'key, name, description, category, fields, body_template, is_premium, review_status';

interface TemplateRow {
  key: string;
  name: string;
  description: string;
  category: string;
  fields: unknown;
  body_template: string;
  is_premium: boolean;
  review_status: LetterTemplate['reviewStatus'];
}

function toTemplate(row: TemplateRow): LetterTemplate {
  return {
    key: row.key,
    name: row.name,
    description: row.description,
    category: row.category,
    fields: row.fields as LetterTemplate['fields'],
    bodyTemplate: row.body_template,
    isPremium: row.is_premium,
    reviewStatus: row.review_status,
  };
}

/** Every template a customer may see. Unreviewed templates do not exist here. */
export async function listPublishedTemplates(admin: SupabaseClient): Promise<LetterTemplate[]> {
  const { data } = await admin
    .from('templates')
    .select(TEMPLATE_COLUMNS)
    .eq('review_status', 'PUBLISHED')
    .order('is_premium', { ascending: true })
    .order('name', { ascending: true });
  return ((data ?? []) as unknown as TemplateRow[]).map(toTemplate);
}

/** One published template, or not found. A DRAFT template is not found either. */
export async function loadPublishedTemplate(admin: SupabaseClient, key: string): Promise<LetterTemplate> {
  const { data } = await admin.from('templates').select(TEMPLATE_COLUMNS).eq('key', key).maybeSingle();
  if (data === null || data === undefined) {
    throw new AppError('NOT_FOUND', 'We could not find that template.');
  }
  const row = data as unknown as TemplateRow;
  // Unreviewed templates are never rendered for a user. A draft template is one
  // that has not passed editorial or legal review, and serving it would be
  // exactly the failure mode the review process exists to prevent.
  if (row.review_status !== 'PUBLISHED') {
    throw new AppError('NOT_FOUND', 'That template is not available yet. We are still reviewing it.', {
      detail: `template ${row.key} has review_status=${row.review_status}`,
    });
  }
  return toTemplate(row);
}

export interface LetterRow {
  readonly id: string;
  readonly case_id: string;
  readonly template_key: string;
  readonly title: string;
  readonly content: string;
  readonly field_values: Record<string, unknown>;
  readonly attachments: Attachment[];
  readonly status: 'DRAFT' | 'USER_REVIEWED' | 'FINALIZED' | 'ARCHIVED';
  readonly user_confirmed_at: string | null;
  readonly user_confirmed_accuracy: boolean;
  readonly created_at: string;
  readonly updated_at: string;
}

export const LETTER_COLUMNS =
  'id, case_id, template_key, title, content, field_values, attachments, status, ' +
  'user_confirmed_at, user_confirmed_accuracy, created_at, updated_at';

/** A letter the user owns, or not found. Ownership failures look like absence. */
export async function loadOwnedLetter(admin: SupabaseClient, userId: string, letterId: string): Promise<LetterRow> {
  const { data } = await admin
    .from('generated_documents')
    .select(LETTER_COLUMNS)
    .eq('id', letterId)
    .eq('user_id', userId)
    .is('deleted_at', null)
    .maybeSingle();
  if (data === null || data === undefined) {
    throw new AppError('NOT_FOUND', 'We could not find that letter.');
  }
  const row = data as unknown as LetterRow;
  return { ...row, attachments: Array.isArray(row.attachments) ? row.attachments : [] };
}

/** What the client may see of a letter. */
export function publicLetter(row: LetterRow): Record<string, unknown> {
  return {
    id: row.id,
    caseId: row.case_id,
    templateKey: row.template_key,
    title: row.title,
    content: row.content,
    fieldValues: row.field_values,
    attachments: row.attachments,
    status: row.status,
    confirmedAt: row.user_confirmed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** The most recent completed check on a case, with finding ids for attaching. */
export async function latestFindings(
  admin: SupabaseClient,
  userId: string,
  caseId: string,
): Promise<
  {
    id: string;
    title: string;
    explanation: string;
    evidence: { fieldPath: string; observed: Record<string, unknown>; expected?: Record<string, unknown> }[];
  }[]
> {
  const { data: analysis } = await admin
    .from('analyses')
    .select('id')
    .eq('user_id', userId)
    .eq('case_id', caseId)
    .eq('status', 'COMPLETED')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (analysis === null || analysis === undefined) return [];

  const { data: findings } = await admin
    .from('analysis_findings')
    .select('id, code, title, explanation, finding_evidence(field_path, observed, expected)')
    .eq('analysis_id', (analysis as { id: string }).id)
    .eq('user_id', userId)
    .neq('code', 'NO_ISSUES_FOUND')
    .order('created_at', { ascending: true });

  return ((findings ?? []) as unknown as {
    id: string;
    title: string;
    explanation: string;
    finding_evidence: { field_path: string | null; observed: Record<string, unknown>; expected: Record<string, unknown> | null }[] | null;
  }[]).map((f) => ({
    id: f.id,
    title: f.title,
    explanation: f.explanation,
    evidence: (f.finding_evidence ?? []).map((e) => ({
      fieldPath: e.field_path ?? '',
      observed: e.observed ?? {},
      ...(e.expected !== null ? { expected: e.expected } : {}),
    })),
  }));
}
