/**
 * Evidence attached to a letter (ADVANCED_LETTERS).
 *
 * An advanced draft is an ordinary letter plus two appended lists: the case
 * documents the customer is enclosing, and the points the check raised, each
 * with the figures it was derived from. Everything here is copied from the
 * case record; nothing is composed. The appendix is plain text, appended after
 * the signature where enclosures conventionally go, and the customer sees and
 * edits it like the rest of the draft.
 *
 * Pure module: no I/O.
 */

export interface AttachedDocument {
  readonly id: string;
  readonly label: string;
}

export interface AttachedFinding {
  readonly id: string;
  readonly label: string;
  readonly explanation: string;
  readonly evidence: readonly {
    readonly fieldPath: string;
    readonly observed: Readonly<Record<string, unknown>>;
    readonly expected?: Readonly<Record<string, unknown>>;
  }[];
}

/** What is stored on the draft, so the letter still reads after retention. */
export type Attachment =
  | { readonly kind: 'document'; readonly id: string; readonly label: string }
  | { readonly kind: 'finding'; readonly id: string; readonly label: string };

const MAX_ENCLOSURES = 20;
const MAX_POINTS = 20;
const MAX_EVIDENCE_PER_POINT = 6;

/** "amountCents" -> "amount", "subtotalCents" -> "subtotal", "line_total" -> "line total". */
function humanKey(key: string): string {
  return key
    .replace(/Cents$/, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .toLowerCase();
}

function formatValues(values: Readonly<Record<string, unknown>>): string {
  return Object.entries(values)
    .filter(([, v]) => v !== undefined && v !== null && String(v).trim().length > 0)
    .map(([k, v]) => `${humanKey(k)} ${String(v).trim()}`)
    .join(', ');
}

function whereLabel(fieldPath: string): string {
  // "lineItems[3]" -> "line 4"; "subtotalCents" -> "subtotal"; "totals" as is.
  const line = /^lineItems\[(\d+)\]/.exec(fieldPath);
  if (line !== null) return `line ${Number(line[1]) + 1}`;
  const eobLine = /^lines\[(\d+)\]/.exec(fieldPath);
  if (eobLine !== null) return `EOB line ${Number(eobLine[1]) + 1}`;
  return humanKey(fieldPath.replace(/\[.*$/, ''));
}

/**
 * The appendix text. Empty string when there is nothing to attach, so a
 * caller can append it unconditionally.
 */
export function evidenceAppendix(input: {
  readonly documents: readonly AttachedDocument[];
  readonly findings: readonly AttachedFinding[];
}): string {
  const parts: string[] = [];

  const documents = input.documents.slice(0, MAX_ENCLOSURES);
  if (documents.length > 0) {
    parts.push(
      ['Enclosures', '', ...documents.map((d, i) => `${i + 1}. ${d.label.trim()}`)].join('\n'),
    );
  }

  const findings = input.findings.slice(0, MAX_POINTS);
  if (findings.length > 0) {
    const lines: string[] = ['Points in question', ''];
    findings.forEach((f, i) => {
      lines.push(`${i + 1}. ${f.label.trim()}`);
      lines.push(`   ${f.explanation.trim()}`);
      for (const e of f.evidence.slice(0, MAX_EVIDENCE_PER_POINT)) {
        const observed = formatValues(e.observed);
        const expected = e.expected !== undefined ? formatValues(e.expected) : '';
        const where = whereLabel(e.fieldPath);
        const detail = [
          observed.length > 0 ? `as printed: ${observed}` : null,
          expected.length > 0 ? `expected: ${expected}` : null,
        ]
          .filter((s): s is string => s !== null)
          .join('; ');
        if (detail.length > 0) lines.push(`   ${where}: ${detail}`);
      }
      if (i < findings.length - 1) lines.push('');
    });
    parts.push(lines.join('\n'));
  }

  return parts.join('\n\n');
}

/** The letter with its appendix, or the letter unchanged when there is none. */
export function appendEvidence(content: string, appendix: string): string {
  const body = content.trimEnd();
  if (appendix.trim().length === 0) return body;
  return `${body}\n\n\n${appendix.trim()}`;
}

/** What to store on the draft for the record. */
export function attachmentsFrom(input: {
  readonly documents: readonly AttachedDocument[];
  readonly findings: readonly AttachedFinding[];
}): Attachment[] {
  return [
    ...input.documents.map((d) => ({ kind: 'document' as const, id: d.id, label: d.label })),
    ...input.findings.map((f) => ({ kind: 'finding' as const, id: f.id, label: f.label })),
  ];
}
