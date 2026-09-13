/**
 * The seeded template library, rendered.
 *
 * Templates are data in a SQL seed, which is exactly where a typo in a
 * placeholder would go unnoticed until a customer saw "{{acount_reference}}"
 * in a letter. This parses every template out of the seed migrations, checks
 * each placeholder against the template's own fields, and renders each one
 * with sample values to make sure nothing is left unresolved.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderLetter, type LetterTemplate, type TemplateField } from '@/domain/letters/render';

const SEEDS = ['0012_seed_catalog.sql', '0019_working_features.sql'];

interface Seeded extends LetterTemplate {
  readonly file: string;
}

function unescapeE(s: string): string {
  return s.replace(/''/g, "'").replace(/\\n/g, '\n').replace(/\\\\/g, '\\');
}

function parseTemplates(): Seeded[] {
  const out: Seeded[] = [];
  const pattern =
    /\(\n  '([A-Z_]+)',\n  '((?:[^']|'')*)',\n  '((?:[^']|'')*)',\n  '([A-Z_]+)',\n  '(\[[\s\S]*?\])'::jsonb,\n  E'((?:[^'\\]|\\.|'')*)',\n  (true|false), '([A-Z_]+)'/g;
  for (const file of SEEDS) {
    const sql = readFileSync(join(process.cwd(), 'supabase', 'migrations', file), 'utf8');
    for (const m of sql.matchAll(pattern)) {
      out.push({
        file,
        key: m[1]!,
        name: m[2]!.replace(/''/g, "'"),
        description: m[3]!.replace(/''/g, "'"),
        category: m[4]!,
        fields: JSON.parse(m[5]!) as TemplateField[],
        bodyTemplate: unescapeE(m[6]!),
        isPremium: m[7] === 'true',
        reviewStatus: m[8] as LetterTemplate['reviewStatus'],
      });
    }
  }
  return out;
}

const templates = parseTemplates();

function sampleValue(field: TemplateField): string | string[] {
  switch (field.type) {
    case 'date':
      return '2026-09-01';
    case 'money':
      return '$1,234.56';
    case 'list':
      return ['First point', 'Second point'];
    case 'textarea':
      return 'Line one\nLine two';
    default:
      return `Sample ${field.label}`;
  }
}

describe('template library seed', () => {
  it('parsed every template out of both seeds', () => {
    // Five free-tier and one appeal in 0012; seven library templates in 0019.
    expect(templates.map((t) => t.key).sort()).toEqual(
      [
        'REQUEST_ITEMIZED_BILL',
        'REQUEST_BILLING_CLARIFICATION',
        'REQUEST_PAYMENT_PLAN',
        'REQUEST_FINANCIAL_ASSISTANCE',
        'REQUEST_EOB_COPY',
        'INSURANCE_APPEAL',
        'REQUEST_CORRECTED_STATEMENT',
        'REQUEST_ACCOUNT_HOLD',
        'REQUEST_CLAIM_STATUS',
        'REQUEST_SUBMIT_TO_INSURER',
        'CONFIRM_CONVERSATION',
        'FOLLOW_UP_PREVIOUS_LETTER',
        'REQUEST_PAYMENT_RECORD',
      ].sort(),
    );
  });

  it('keeps the appeal template unpublished pending legal review', () => {
    expect(templates.find((t) => t.key === 'INSURANCE_APPEAL')?.reviewStatus).toBe('DRAFT');
  });

  it.each(templates.map((t) => [t.key, t] as const))('%s: every placeholder is a declared field', (_key, t) => {
    const declared = new Set(['today', ...t.fields.map((f) => f.key)]);
    const used = new Set<string>();
    for (const m of t.bodyTemplate.matchAll(/\{\{#?\/?(\w+)\}\}/g)) used.add(m[1]!);
    for (const key of used) expect(declared.has(key), `{{${key}}} in ${t.key}`).toBe(true);
    // And every required field is actually used, or the customer is asked
    // for something the letter never says.
    for (const f of t.fields.filter((f) => f.required)) {
      expect(used.has(f.key), `required field ${f.key} unused in ${t.key}`).toBe(true);
    }
  });

  it.each(templates.map((t) => [t.key, t] as const))('%s: renders cleanly with sample values', (_key, t) => {
    const values: Record<string, string | string[]> = {};
    for (const f of t.fields) values[f.key] = sampleValue(f);
    const { content, issues } = renderLetter(t, values, { today: new Date('2026-09-13T00:00:00Z') });
    expect(issues).toEqual([]);
    expect(content).not.toContain('{{');
    expect(content).toContain('September 13, 2026');
    expect(content).not.toMatch(/\n{3,}/);
    // The sign-off is the customer, not us (an address block may follow it).
    expect(content.slice(-120)).toContain('Sample Your full name');
  });

  it('every template speaks in the plain register the product promises', () => {
    for (const t of templates) {
      // No legal assertions, no threats, no guarantees.
      expect(t.bodyTemplate).not.toMatch(/\b(pursuant|statute|violat|lawsuit|attorney|guarantee|demand that)\b/i);
    }
  });
});
