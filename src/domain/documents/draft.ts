/**
 * The extraction draft: what a reader believes a document says, before the
 * customer has confirmed it.
 *
 * This is deliberately NOT a BillDocument. A BillDocument is an input to the
 * rule engine, and the rule engine's findings are presented as facts about
 * the bill. Anything a machine read off a photograph is a guess with a
 * confidence, and it becomes a fact only when the customer looks at it and
 * says yes. The review step in the UI is where a draft turns into a bill, and
 * nothing in this module lets that step be skipped.
 *
 * Pure module: no I/O, no dependencies.
 */

import type { Confidence } from '@/domain/analysis/types';

export interface DraftLine {
  readonly description: string;
  readonly amountCents: number | null;
  readonly code?: string;
  readonly quantity?: number;
  readonly serviceDate?: string;
  readonly confidence: Confidence;
}

export interface DraftMoney {
  readonly amountCents: number;
  readonly confidence: Confidence;
}

export interface DraftText {
  readonly value: string;
  readonly confidence: Confidence;
}

export interface ExtractionDraft {
  /** Which reader produced this, e.g. "pdf-text+model" or "azure-invoice". */
  readonly engine: string;
  readonly engineVersion: string;
  readonly currency: 'USD' | 'CAD' | null;
  readonly lineItems: readonly DraftLine[];
  readonly subtotal: DraftMoney | null;
  readonly total: DraftMoney | null;
  readonly amountDue: DraftMoney | null;
  readonly insurancePaid: DraftMoney | null;
  readonly adjustments: DraftMoney | null;
  readonly previousBalance: DraftMoney | null;
  readonly statementDate: DraftText | null;
  readonly providerName: DraftText | null;
  readonly accountReference: DraftText | null;
  readonly pageCount: number | null;
  /**
   * Lowest confidence across every field that was read. Shown to the customer
   * as "check these numbers carefully" rather than as a percentage, because a
   * percentage implies a precision no reader has.
   */
  readonly overallConfidence: Confidence;
  /**
   * Short, non-clinical notes for the customer: "two line items had no
   * amount", "the total was not found". Never raw document text.
   */
  readonly notes: readonly string[];
}

/**
 * Parse money as printed on a bill into integer cents, or null.
 *
 * Accepts "$1,234.56", "1234.56", "1,234", "(12.00)" and "-12.00" for credits,
 * and "1 234,56" as some Canadian bills print it. Rejects anything ambiguous
 * rather than guessing: a wrong amount confirmed by a tired customer becomes a
 * wrong finding, and a blank field they have to fill in does not.
 */
export function parseMoneyToCents(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  let s = raw.trim();
  if (s.length === 0) return null;

  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1).trim();
  }
  // The sign and the currency mark come in either order on real bills:
  // "-$12.00" and "$-171,196.61" both occur. Strip them in a loop so neither
  // order leaves a stray character for the numeric check to reject.
  for (let pass = 0; pass < 2; pass += 1) {
    if (s.startsWith('-')) {
      negative = !negative;
      s = s.slice(1).trim();
    }
    s = s.replace(/^(US|CA|C)?\$/i, '').trim();
  }
  s = s.replace(/\s*(USD|CAD)$/i, '').trim();

  // "1 234,56" / "1.234,56": comma-decimal with an explicit thousands group,
  // as some Canadian bills print. The thousands group is REQUIRED: a bare
  // "1,23" is far more likely a misread of "1,230" than a price of $1.23, and
  // the customer can type the real figure faster than we can guess it.
  if (/^\d{1,3}([ .]\d{3})+,\d{2}$/.test(s)) {
    s = s.replace(/[ .]/g, '').replace(',', '.');
  } else if (s.includes(',')) {
    // With a comma present it must be a proper thousands grouping.
    if (!/^\d{1,3}(,\d{3})+(\.\d{1,2})?$/.test(s)) return null;
    s = s.replace(/,/g, '');
  } else {
    s = s.replace(/\s/g, '');
  }

  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;

  const cents = Math.round(Number(s) * 100);
  if (!Number.isFinite(cents)) return null;
  return negative ? -cents : cents;
}

/** ISO date (YYYY-MM-DD) from the formats bills print, or null. */
export function parseDateToIso(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const s = raw.trim();
  if (s.length === 0) return null;

  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;

  // MM/DD/YYYY, the North American default.
  m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (m) {
    const mm = m[1]!.padStart(2, '0');
    const dd = m[2]!.padStart(2, '0');
    if (Number(mm) >= 1 && Number(mm) <= 12 && Number(dd) >= 1 && Number(dd) <= 31) {
      return `${m[3]}-${mm}-${dd}`;
    }
    return null;
  }

  // "Jan 5, 2026" / "January 5 2026" / "5 Jan 2026".
  const months: Record<string, string> = {
    jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
    jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
  };
  m = s.match(/^([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})$/);
  if (m) {
    const mm = months[m[1]!.toLowerCase()];
    if (mm) return `${m[3]}-${mm}-${m[2]!.padStart(2, '0')}`;
  }
  m = s.match(/^(\d{1,2})\s+([A-Za-z]{3})[a-z]*\.?,?\s+(\d{4})$/);
  if (m) {
    const mm = months[m[2]!.toLowerCase()];
    if (mm) return `${m[3]}-${mm}-${m[1]!.padStart(2, '0')}`;
  }

  return null;
}

const ORDER: Record<Confidence, number> = { LOW: 0, MEDIUM: 1, HIGH: 2 };

export function lowestConfidence(values: readonly (Confidence | null | undefined)[]): Confidence {
  let lowest: Confidence = 'HIGH';
  for (const v of values) {
    if (v !== null && v !== undefined && ORDER[v] < ORDER[lowest]) lowest = v;
  }
  return lowest;
}

/** Map a 0–1 provider confidence onto the three-level scale the UI uses. */
export function confidenceFromScore(score: number | null | undefined): Confidence {
  if (score === null || score === undefined || Number.isNaN(score)) return 'LOW';
  if (score >= 0.9) return 'HIGH';
  if (score >= 0.7) return 'MEDIUM';
  return 'LOW';
}

/** An empty draft, for when nothing could be read. The customer fills it in. */
export function emptyDraft(engine: string, engineVersion: string, note: string): ExtractionDraft {
  return {
    engine,
    engineVersion,
    currency: null,
    lineItems: [],
    subtotal: null,
    total: null,
    amountDue: null,
    insurancePaid: null,
    adjustments: null,
    previousBalance: null,
    statementDate: null,
    providerName: null,
    accountReference: null,
    pageCount: null,
    overallConfidence: 'LOW',
    notes: [note],
  };
}
