/**
 * Find the printed totals in the text of a bill, by their labels.
 *
 * A structured reader (Azure's invoice model, or the model-based structuring)
 * returns line items well and totals unreliably: hospital statements print
 * "TOTAL CHARGES" and "BALANCE DUE" in layouts that an invoice model was not
 * trained on. But the OCR text is available either way, and a bill labels its
 * totals in a small vocabulary. This scans for that vocabulary.
 *
 * Deterministic, so it is a backstop rather than a guess: a label followed by
 * a money amount, nothing inferred. Where the same label appears more than
 * once (a running "Total" per section, then a grand total) the LAST one wins,
 * because bills put the number that matters at the bottom. "Previous balance"
 * is the exception; it is a header figure and the first wins.
 *
 * Learned from the first real upload, a photographed hospital statement:
 *   - OCR puts a label and its amount on SEPARATE lines in column layouts.
 *     A single line break between them is allowed; running text is not.
 *   - Labels carry footnote markers: "Hospital Discount to Patient*".
 *   - The sign can follow the currency mark: "$-171,196.61".
 *   - "Patient Payments Received" and "Insurance Payments Received" both end
 *     in "payments received"; the patient line must be consumed first or the
 *     generic label picks the wrong one.
 *   - A photo clips the left edge, so "Insurance Payments Received" arrives as
 *     "surance Payments Received". Labels are therefore matched on their
 *     distinctive tail as well as their full form.
 *
 * Everything found is MEDIUM confidence: a label match is stronger than a
 * model's guess and weaker than a structured field the reader vouched for.
 *
 * Pure module: no I/O, no dependencies.
 */

import type { DraftMoney } from './draft';
import { parseMoneyToCents } from './draft';

export interface FoundTotals {
  readonly subtotal: DraftMoney | null;
  readonly total: DraftMoney | null;
  readonly amountDue: DraftMoney | null;
  readonly insurancePaid: DraftMoney | null;
  readonly adjustments: DraftMoney | null;
  readonly previousBalance: DraftMoney | null;
}

/**
 * What may sit between a label and its amount: footnote markers, dots,
 * colons, dashes, a currency word, and whitespace INCLUDING one line break.
 * Two consecutive line breaks (a blank line) end the search, so a bare
 * "Total" heading above a list does not adopt the first list amount.
 */
const FILLER = String.raw`(?:[ \t*.:=\-–—]|\n(?!\s*\n)){0,40}(?:USD|CAD)?[ \t]*`;

/**
 * Money, as bills print it. The sign may come before or after the currency
 * mark, or the whole thing may be in parentheses. To count as money at all it
 * needs a currency mark, a decimal part, or a thousands separator: a bare
 * integer is a code or a count, and "0110 ROOM & BOARD" must not yield $11.
 * The trailing lookahead stops "011" being read out of "0110".
 */
const MONEY =
  // No leading whitespace here: FILLER owns everything between label and
  // figure, including the rule that a blank line ends the search. A \s* at the
  // front of this pattern silently re-opened that door.
  String.raw`(\(?-?[ \t]*(?:US|CA|C)?\$[ \t]*-?[ \t]*\d{1,3}(?:,\d{3})*(?:\.\d{2})?[ \t]*\)?` + // has $
  String.raw`|\(?-?[ \t]*\d{1,3}(?:,\d{3})+(?:\.\d{2})?[ \t]*\)?` + // has thousands
  String.raw`|\(?-?[ \t]*\d+\.\d{2}[ \t]*\)?)(?![\d.])`; // has decimals

interface LabelRule {
  /** null means: consume this text so no later rule can read it, store nothing. */
  readonly key: keyof FoundTotals | null;
  readonly labels: readonly string[];
  readonly pick: 'first' | 'last';
}

/**
 * ORDER MATTERS. Each rule blanks the text it consumed, so the specific must
 * run before the generic: "patient payments" before "payments received",
 * "previous balance" before the "balance" inside amountDue, "subtotal" before
 * "total". A rule that runs too early steals the number.
 */
const RULES: readonly LabelRule[] = [
  // Consumed, not stored. The form has no "patient payments" field, and
  // these must not be mistaken for insurance payments.
  {
    key: null,
    pick: 'last',
    labels: ['patient payments received', 'patient payments', 'patient payment', 'payments by patient', 'you paid', 'paid by patient'],
  },
  {
    key: 'previousBalance',
    pick: 'first',
    labels: ['previous balance', 'prior balance', 'balance forward', 'beginning balance'],
  },
  {
    key: 'subtotal',
    pick: 'last',
    labels: ['subtotal', 'sub total', 'sub-total'],
  },
  {
    key: 'adjustments',
    pick: 'last',
    labels: [
      'hospital discount to patient', 'discount to patient', 'hospital discount',
      'contractual adjustments', 'contractual adjustment', 'contractual allowance',
      'insurance adjustments', 'insurance adjustment', 'adjustments', 'adjustment',
      'discounts', 'discount', 'write-off', 'write off', 'writeoff', 'allowances', 'allowance',
    ],
  },
  {
    key: 'insurancePaid',
    pick: 'last',
    labels: [
      'insurance payments received', 'insurance payment received', 'insurance payments',
      'insurance payment', 'insurance paid', 'plan paid', 'paid by insurance',
      'insurance credits', 'payments received', 'payment received', 'payments',
    ],
  },
  {
    key: 'amountDue',
    pick: 'last',
    labels: [
      'discounted charges pending with insurance', 'charges pending with insurance',
      'pending with insurance', 'total amount due', 'total patient responsibility',
      'patient amount due', 'amount now due', 'amount due', 'balance due', 'total due',
      'now due', 'patient balance', 'patient responsibility', 'your responsibility',
      'amount you owe', 'you owe', 'please pay', 'pay this amount', 'current balance',
      'account balance', 'balance',
    ],
  },
  {
    key: 'total',
    pick: 'last',
    labels: [
      'pre-discount charges', 'prediscount charges', 'pre discount charges',
      'charges before discount', 'gross charges', 'total charges', 'total billed',
      'charges total', 'total amount', 'grand total', 'total',
    ],
  },
];

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, String.raw`\s+`);
}

/**
 * A photograph clips the LEFT edge, so the first word of a label loses its
 * leading letters: "Insurance Payments Received" arrives as "surance Payments
 * Received", "Contractual" as "ctual". For a MULTI-word label the first word
 * may match by any suffix of at least three letters, because the later words
 * still identify it. A single-word label must match in full: "subtotal" has
 * the suffix "total", and letting it match by suffix handed every plain
 * "Total" line to the subtotal rule.
 */
function labelPattern(label: string): string {
  const words = label.split(/\s+/);
  if (words.length < 2) return escape(label);

  const first = words[0] ?? '';
  const rest = words.slice(1).map(escape);
  const suffixes: string[] = [];
  for (let i = 0; i <= Math.max(0, first.length - 3); i += 1) {
    suffixes.push(escape(first.slice(i)));
  }
  const firstPattern = suffixes.length > 1 ? `(?:${suffixes.join('|')})` : escape(first);
  return [firstPattern, ...rest].join(String.raw`\s+`);
}

export function findTotalsInText(text: string): FoundTotals {
  const found: Record<keyof FoundTotals, DraftMoney | null> = {
    subtotal: null, total: null, amountDue: null,
    insurancePaid: null, adjustments: null, previousBalance: null,
  };
  if (text.trim().length === 0) return found;

  let working = text.replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ');

  for (const rule of RULES) {
    // Longest label first, so "total amount due" is tried before "total".
    const labels = [...rule.labels].sort((a, b) => b.length - a.length).map(labelPattern);
    const re = new RegExp(String.raw`\b(?:${labels.join('|')})\b${FILLER}${MONEY}`, 'gi');

    const matches: { index: number; length: number; cents: number }[] = [];
    for (const m of working.matchAll(re)) {
      const cents = parseMoneyToCents(m[1] ?? '');
      if (cents === null || m.index === undefined) continue;
      matches.push({ index: m.index, length: m[0].length, cents });
    }
    if (matches.length === 0) continue;

    if (rule.key !== null) {
      const chosen = rule.pick === 'last' ? matches[matches.length - 1]! : matches[0]!;
      found[rule.key] = { amountCents: chosen.cents, confidence: 'MEDIUM' };
    }

    // Blank every span this rule consumed, so a generic later label cannot
    // re-read a specific earlier one.
    for (const m of matches) {
      working = working.slice(0, m.index) + ' '.repeat(m.length) + working.slice(m.index + m.length);
    }
  }

  return found;
}

/** Fill only what the reader left empty. The reader's own fields always win. */
export function backfillTotals<T extends FoundTotals>(draft: T, text: string): T {
  const scanned = findTotalsInText(text);
  return {
    ...draft,
    subtotal: draft.subtotal ?? scanned.subtotal,
    total: draft.total ?? scanned.total,
    amountDue: draft.amountDue ?? scanned.amountDue,
    insurancePaid: draft.insurancePaid ?? scanned.insurancePaid,
    adjustments: draft.adjustments ?? scanned.adjustments,
    previousBalance: draft.previousBalance ?? scanned.previousBalance,
  };
}
