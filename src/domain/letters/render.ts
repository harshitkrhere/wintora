/**
 * Letter rendering.
 *
 * The renderer assembles a document from a structured template and verified
 * field values. A language model may improve wording afterwards, but it cannot
 * introduce a factual claim, because the facts are the field values and those
 * come from the user or from the case record.
 *
 * Output is plain text. It is never rendered as HTML anywhere in the product,
 * which removes an entire class of injection from a document a user will paste
 * into an email.
 *
 * Pure module: no I/O.
 */

export type FieldType = 'text' | 'textarea' | 'date' | 'money' | 'list';

export interface TemplateField {
  readonly key: string;
  readonly label: string;
  readonly type: FieldType;
  readonly required: boolean;
  readonly help?: string;
  readonly maxLength?: number;
}

export interface LetterTemplate {
  readonly key: string;
  readonly name: string;
  readonly description: string;
  readonly category: string;
  readonly fields: readonly TemplateField[];
  readonly bodyTemplate: string;
  readonly isPremium: boolean;
  readonly reviewStatus: 'DRAFT' | 'IN_REVIEW' | 'PUBLISHED' | 'STALE' | 'RETIRED';
}

export type FieldValue = string | readonly string[] | undefined;
export type FieldValues = Readonly<Record<string, FieldValue>>;

export interface RenderOptions {
  /** Injected rather than read from the clock so rendering stays pure. */
  readonly today?: Date;
  readonly locale?: string;
}

export interface ValidationIssue {
  readonly fieldKey: string;
  readonly message: string;
}

export interface RenderResult {
  readonly content: string;
  readonly issues: readonly ValidationIssue[];
  /** Which fields actually appeared in the output, for the review UI. */
  readonly usedFields: readonly string[];
}

const MAX_FIELD_LENGTH = 4000;
const MAX_LIST_ITEMS = 50;

export function validateFields(
  template: LetterTemplate,
  values: FieldValues,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  for (const field of template.fields) {
    const value = values[field.key];
    const empty =
      value === undefined ||
      (typeof value === 'string' && value.trim().length === 0) ||
      (Array.isArray(value) && value.length === 0);

    if (field.required && empty) {
      issues.push({ fieldKey: field.key, message: `${field.label} is required.` });
      continue;
    }
    if (empty) continue;

    const max = field.maxLength ?? MAX_FIELD_LENGTH;

    if (typeof value === 'string' && value.length > max) {
      issues.push({
        fieldKey: field.key,
        message: `${field.label} is too long (maximum ${max} characters).`,
      });
    }

    if (Array.isArray(value)) {
      if (value.length > MAX_LIST_ITEMS) {
        issues.push({
          fieldKey: field.key,
          message: `${field.label} has too many entries (maximum ${MAX_LIST_ITEMS}).`,
        });
      }
      if (value.some((v) => typeof v !== 'string' || v.length > max)) {
        issues.push({
          fieldKey: field.key,
          message: `An entry in ${field.label} is too long.`,
        });
      }
    }

    if (field.type === 'date' && typeof value === 'string') {
      if (Number.isNaN(new Date(value).getTime())) {
        issues.push({ fieldKey: field.key, message: `${field.label} is not a valid date.` });
      }
    }
  }

  // Unknown keys are dropped rather than rendered, so a crafted request body
  // cannot inject text into a letter through a field the template never
  // declared.
  const declared = new Set(template.fields.map((f) => f.key));
  for (const key of Object.keys(values)) {
    if (!declared.has(key)) {
      issues.push({
        fieldKey: key,
        message: `Unknown field "${key}" was ignored.`,
      });
    }
  }

  return issues;
}

function formatValue(
  field: TemplateField | undefined,
  value: FieldValue,
  locale: string,
): string {
  if (value === undefined) return '';

  if (Array.isArray(value)) {
    return value.map((item, i) => `${i + 1}. ${String(item).trim()}`).join('\n');
  }

  const text = String(value).trim();
  if (field?.type === 'date') {
    const d = new Date(text);
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleDateString(locale, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        timeZone: 'UTC',
      });
    }
  }
  return text;
}

/**
 * Render the template.
 *
 * Supports exactly two constructs, deliberately:
 *   {{key}}                  substitute a value
 *   {{#key}}...{{/key}}      include the block only when the value is present
 *
 * No expressions, no partials, no arbitrary evaluation. A template is data
 * from the database, and a template engine with more power than this would be
 * an execution surface.
 */
export function renderLetter(
  template: LetterTemplate,
  values: FieldValues,
  options: RenderOptions = {},
): RenderResult {
  const locale = options.locale ?? 'en-US';
  const today = options.today ?? new Date();
  const issues = validateFields(template, values);
  const usedFields: string[] = [];

  const fieldByKey = new Map(template.fields.map((f) => [f.key, f]));

  const resolve = (key: string): string => {
    if (key === 'today') {
      return today.toLocaleDateString(locale, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        timeZone: 'UTC',
      });
    }
    const field = fieldByKey.get(key);
    if (field === undefined) return '';
    const rendered = formatValue(field, values[key], locale);
    if (rendered.length > 0 && !usedFields.includes(key)) usedFields.push(key);
    return rendered;
  };

  const hasValue = (key: string): boolean => {
    if (key === 'today') return true;
    if (!fieldByKey.has(key)) return false;
    const v = values[key];
    if (v === undefined) return false;
    if (Array.isArray(v)) return v.length > 0;
    return String(v).trim().length > 0;
  };

  // Sections first, so a section containing a placeholder for an absent field
  // disappears whole rather than leaving a stray line.
  let output = template.bodyTemplate.replace(
    /\{\{#(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}/g,
    (_match, key: string, block: string) => (hasValue(key) ? block : ''),
  );

  output = output.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => resolve(key));

  // Tidy the whitespace an omitted section leaves behind.
  output = output.replace(/\n{3,}/g, '\n\n').trim();

  return { content: output, issues, usedFields };
}

/**
 * Wintora never sends anything. A draft becomes final only when the user has
 * explicitly reviewed it and confirmed the details are accurate.
 * See docs/AI_SAFETY.md and the `generated_documents_confirm_requires_review`
 * database constraint, which enforces the same rule one layer down.
 */
export interface FinalizationRequest {
  readonly reviewed: boolean;
  readonly accurateToBestKnowledge: boolean;
}

export function canFinalize(request: FinalizationRequest): {
  ok: boolean;
  reason?: string;
} {
  if (!request.reviewed) {
    return { ok: false, reason: 'Please confirm you have reviewed this document.' };
  }
  if (!request.accurateToBestKnowledge) {
    return {
      ok: false,
      reason:
        'Please confirm the information is accurate to the best of your knowledge.',
    };
  }
  return { ok: true };
}

/** Fields a template needs that the case record can fill in automatically. */
export function prefillFromCase(
  template: LetterTemplate,
  source: {
    userName?: string;
    providerName?: string;
    insurerName?: string;
    accountReference?: string;
    serviceDate?: string;
    statementDate?: string;
    amountDue?: string;
  },
): FieldValues {
  const map: Record<string, string | undefined> = {
    user_name: source.userName,
    provider_name: source.providerName,
    insurer_name: source.insurerName,
    account_reference: source.accountReference,
    service_date: source.serviceDate,
    statement_date: source.statementDate,
    balance: source.amountDue,
  };

  const out: Record<string, string> = {};
  for (const field of template.fields) {
    const value = map[field.key];
    if (value !== undefined && value.length > 0) out[field.key] = value;
  }
  return out;
}
