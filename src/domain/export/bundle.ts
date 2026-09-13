/**
 * What goes into a case bundle (ADVANCED_EXPORT), as documents.
 *
 * The bundle is a folder a person could hand to someone else: a summary of
 * the case with every finding and its figures, each letter as its own file,
 * the timeline, and the original uploads. This module decides the words and
 * the file names; the renderers decide the bytes; the route does the I/O.
 *
 * Pure module: no I/O.
 */

import type { ExportDocument, ExportSection } from './document';

export interface BundleFinding {
  readonly severity: 'INFO' | 'REVIEW' | 'ATTENTION';
  readonly title: string;
  readonly explanation: string;
  readonly recommendedAction?: string;
  readonly confidence: 'LOW' | 'MEDIUM' | 'HIGH';
  readonly evidence: readonly {
    readonly fieldPath: string;
    readonly observed: Readonly<Record<string, unknown>>;
    readonly expected?: Readonly<Record<string, unknown>>;
  }[];
}

export interface BundleAnalysis {
  readonly analysisType: string;
  readonly engineVersion: string;
  readonly completedAt: string;
  readonly findings: readonly BundleFinding[];
}

export interface BundleLetter {
  readonly id: string;
  readonly title: string;
  readonly content: string;
  readonly status: string;
  readonly createdAt: string;
  readonly confirmedAt: string | null;
}

export interface BundleEvent {
  readonly occurredAt: string;
  readonly title: string;
  readonly detail: string | null;
  readonly origin: string;
}

export interface BundleDocument {
  readonly id: string;
  readonly filename: string | null;
  readonly mimeType: string;
  readonly byteSize: number;
  readonly uploadedAt: string;
}

export interface BundleDate {
  readonly label: string;
  readonly dueDate: string;
  readonly verified: boolean;
  readonly completed: boolean;
}

export interface BundleCase {
  readonly title: string;
  readonly providerName: string | null;
  readonly status: string;
  readonly amountCents: number | null;
  readonly currency: string | null;
  readonly statementDate: string | null;
  readonly accountReference: string | null;
  readonly memberLabel: string | null;
  readonly notes: string | null;
  readonly createdAt: string;
  readonly analyses: readonly BundleAnalysis[];
  readonly letters: readonly BundleLetter[];
  readonly events: readonly BundleEvent[];
  readonly documents: readonly BundleDocument[];
  readonly dates: readonly BundleDate[];
}

const SEVERITY_LABEL: Record<BundleFinding['severity'], string> = {
  ATTENTION: 'Worth a closer look',
  REVIEW: 'Worth confirming',
  INFO: 'For information',
};

const TYPE_LABEL: Record<string, string> = {
  BILL_CONSISTENCY: 'Bill check',
  BILL_VS_EOB: 'Bill compared with EOB',
};

function money(cents: number | null, currency: string | null): string | null {
  if (cents === null) return null;
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency ?? 'USD' }).format(cents / 100);
}

function when(iso: string): string {
  return new Date(iso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' });
}

function day(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { dateStyle: 'long', timeZone: 'UTC' });
}

function humanKey(key: string): string {
  return key.replace(/Cents$/, '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').toLowerCase();
}

function values(record: Readonly<Record<string, unknown>>): string {
  return Object.entries(record)
    .filter(([, v]) => v !== undefined && v !== null && String(v).trim().length > 0)
    .map(([k, v]) => `${humanKey(k)} ${String(v).trim()}`)
    .join(', ');
}

/** A file name that is safe in a ZIP and readable in a folder listing. */
export function safeFilename(label: string, fallback: string): string {
  const cleaned = label
    .normalize('NFKD')
    .replace(/[^\x20-\x7e]/g, '')
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  return cleaned.length > 0 ? cleaned : fallback;
}

/** The case summary: what the case is, what the checks found, what happened. */
export function caseSummaryDocument(c: BundleCase, exportedAt: Date): ExportDocument {
  const sections: ExportSection[] = [];

  const about: string[] = [];
  if (c.providerName !== null) about.push(`Provider: ${c.providerName}`);
  const amount = money(c.amountCents, c.currency);
  if (amount !== null) about.push(`Amount on the statement: ${amount}`);
  if (c.statementDate !== null) about.push(`Statement date: ${c.statementDate}`);
  if (c.accountReference !== null) about.push(`Account reference: ${c.accountReference}`);
  if (c.memberLabel !== null) about.push(`For: ${c.memberLabel}`);
  about.push(`Status: ${c.status === 'OPEN' ? 'Open' : 'Closed'}`);
  about.push(`Case started: ${day(c.createdAt)}`);
  about.push(`Exported: ${when(exportedAt.toISOString())} UTC`);
  sections.push({ heading: 'About this case', paragraphs: [about.join('\n')] });

  if (c.notes !== null && c.notes.trim().length > 0) {
    sections.push({ heading: 'Notes', paragraphs: [c.notes.trim()] });
  }

  if (c.analyses.length === 0) {
    sections.push({ heading: 'Checks', paragraphs: ['No checks have been run on this case.'] });
  }
  c.analyses.forEach((a, i) => {
    const paragraphs: string[] = [
      `${TYPE_LABEL[a.analysisType] ?? a.analysisType}, run ${when(a.completedAt)} UTC, engine ${a.engineVersion}. ` +
        `${a.findings.length} finding${a.findings.length === 1 ? '' : 's'}.`,
    ];
    a.findings.forEach((f, j) => {
      const lines = [`${j + 1}. ${f.title} (${SEVERITY_LABEL[f.severity]}; confidence ${f.confidence.toLowerCase()})`, f.explanation];
      if (f.recommendedAction !== undefined) lines.push(`What you can do: ${f.recommendedAction}`);
      for (const e of f.evidence.slice(0, 10)) {
        const observed = values(e.observed);
        const expected = e.expected !== undefined ? values(e.expected) : '';
        const parts = [observed.length > 0 ? `as printed: ${observed}` : null, expected.length > 0 ? `expected: ${expected}` : null]
          .filter((s): s is string => s !== null)
          .join('; ');
        if (parts.length > 0) lines.push(`${humanKey(e.fieldPath.replace(/\[.*$/, ''))}: ${parts}`);
      }
      paragraphs.push(lines.join('\n'));
    });
    paragraphs.push(
      'These checks compare what is printed. They cannot tell you whether a charge was appropriate or what your insurer will decide.',
    );
    sections.push({ heading: i === 0 ? 'Checks' : `Check ${i + 1}`, paragraphs });
  });

  if (c.dates.length > 0) {
    sections.push({
      heading: 'Dates',
      paragraphs: [
        c.dates
          .map(
            (d) =>
              `${d.dueDate}: ${d.label}${d.verified ? ' (verified)' : ' (entered by you)'}${d.completed ? ' - done' : ''}`,
          )
          .join('\n'),
      ],
    });
  }

  if (c.letters.length > 0) {
    sections.push({
      heading: 'Letters',
      paragraphs: [
        c.letters
          .map((l) => `${l.title} - ${l.status === 'FINALIZED' ? `reviewed ${l.confirmedAt !== null ? day(l.confirmedAt) : ''}` : 'draft'} (see the letters folder)`)
          .join('\n'),
      ],
    });
  }

  sections.push({
    heading: 'Documents',
    paragraphs: [
      c.documents.length === 0
        ? 'No documents on this case.'
        : c.documents.map((d) => `${d.filename ?? 'Document'} - uploaded ${day(d.uploadedAt)}`).join('\n'),
    ],
  });

  sections.push({
    heading: 'Timeline',
    paragraphs: [
      c.events.length === 0
        ? 'Nothing recorded yet.'
        : c.events
            .map((e) => `${when(e.occurredAt)}  ${e.title}${e.detail !== null ? ` - ${e.detail}` : ''}${e.origin === 'USER' ? ' (you)' : ''}`)
            .join('\n'),
    ],
  });

  return { title: c.title, sections };
}

/** One letter as its own document. A draft says so at the top. */
export function letterDocument(letter: BundleLetter): ExportDocument {
  const paragraphs: string[] = [];
  if (letter.status !== 'FINALIZED') {
    paragraphs.push('DRAFT - not yet reviewed. Check every detail before sending.');
  }
  // Blank-line separated blocks become paragraphs; single line breaks stay.
  for (const block of letter.content.replace(/\r\n?/g, '\n').split(/\n{2,}/)) {
    paragraphs.push(block);
  }
  return { title: letter.title, sections: [{ paragraphs }] };
}

/** The README at the top of the bundle. */
export function manifestText(input: {
  readonly caseTitle: string;
  readonly format: 'pdf' | 'docx';
  readonly exportedAt: Date;
  readonly files: readonly string[];
  readonly omitted: readonly string[];
}): string {
  const lines = [
    `Wintora case export: ${input.caseTitle}`,
    `Exported ${when(input.exportedAt.toISOString())} UTC`,
    '',
    'Contents',
    ...input.files.map((f) => `  ${f}`),
  ];
  if (input.omitted.length > 0) {
    lines.push('', 'Not included', ...input.omitted.map((o) => `  ${o}`));
  }
  lines.push(
    '',
    'The summary and letters are plain documents you can open, print or forward.',
    'The documents folder holds your uploads exactly as you uploaded them.',
    'Wintora prepared this bundle from your case record. It has not sent it anywhere.',
  );
  return `${lines.join('\n')}\n`;
}
