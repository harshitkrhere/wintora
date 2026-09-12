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
 * Money as it appears after a label: optional currency mark, optional sign or
 * parentheses, digits with optional thousands separators, optional cents.
 * At most ~40 characters of filler (dots, colons, spaces, a "USD") may sit
 * between the label and the amount; that keeps "Total charges ....... $1.00"
 * matched and "Total number of visits: 3   Room charge $500" unmatched.
 */
const FILLER = String.raw`[\s.:=\-–—]{0,40}(?:USD|CAD)?\s*`;
const MONEY = String.raw`(\(?-?\s*(?:US|CA|C)?\$?\s*\d{1,3}(?:,\d{3})*(?:\.\d{2})?\)?|\(?-?\s*(?:US|CA|C)?\$?\s*\d+\.\d{2}\)?)`;

interface LabelRule {
  readonly key: keyof FoundTotals;
  readonly labels: readonly string[];
  readonly pick: 'first' | 'last';
}

const RULES: readonly LabelRule[] = [
  // ORDER MATTERS. Each rule blanks the text it consumed, so the specific
  // must run before the generic: "previous balance" before the "balance"
  // inside amountDue, "subtotal" before "total" (which would otherwise match
  // the tail of "Sub-total"). A rule that runs too early steals the number.
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
    key: 'amountDue',
    pick: 'last',
    labels: [
      'amount due', 'balance due', 'total due', 'now due', 'amount now due',
      'patient balance', 'patient responsibility', 'patient amount due',
      'amount you owe', 'you owe', 'please pay', 'pay this amount',
      'total amount due', 'total patient responsibility', 'your responsibility',
      'current balance', 'account balance', 'balance',
    ],
  },
  {
    key: 'total',
    pick: 'last',
    labels: ['total charges', 'total amount', 'grand total', 'total billed', 'charges total', 'total'],
  },
  {
    key: 'insurancePaid',
    pick: 'last',
    labels: [
      'insurance paid', 'insurance payment', 'insurance payments', 'plan paid',
      'paid by insurance', 'payments received', 'payments', 'payment received',
      'insurance credits',
    ],
  },
  {
    key: 'adjustments',
    pick: 'last',
    labels: [
      'adjustments', 'adjustment', 'contractual adjustment', 'contractual adjustments',
      'contractual allowance', 'discounts', 'discount', 'write-off', 'write off', 'writeoff',
      'insurance adjustments', 'insurance adjustment',
    ],
  },
];

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, String.raw`\s+`);
}

/**
 * Labels are matched longest-first inside each rule so "total amount due"
 * resolves to amountDue before "total" can claim it for total. Across rules,
 * a span of text consumed by an earlier rule is blanked so it cannot be
 * re-read by a later one: "Total amount due $500" must not also produce
 * total=$500.
 */
export function findTotalsInText(text: string): FoundTotals {
  const found: Record<keyof FoundTotals, DraftMoney | null> = {
    subtotal: null, total: null, amountDue: null,
    insurancePaid: null, adjustments: null, previousBalance: null,
  };
  if (text.trim().length === 0) return found;

  // Normalise whitespace but keep line structure: a label and its amount are
  // on one line on virtually every bill, and allowing a match to span lines
  // is how "Total\n\nRoom charge 500.00" becomes total=500.
  let working = text.replace(/[ \t]+/g, ' ');

  for (const rule of RULES) {
    const labels = [...rule.labels].sort((a, b) => b.length - a.length).map(escape);
    const re = new RegExp(String.raw`\b(?:${labels.join('|')})\b${FILLER}${MONEY}`, 'gi');

    const matches: { index: number; length: number; cents: number }[] = [];
    for (const m of working.matchAll(re)) {
      const cents = parseMoneyToCents(m[1] ?? '');
      if (cents === null || m.index === undefined) continue;
      matches.push({ index: m.index, length: m[0].length, cents });
    }
    if (matches.length === 0) continue;

    const chosen = rule.pick === 'last' ? matches[matches.length - 1]! : matches[0]!;
    found[rule.key] = { amountCents: chosen.cents, confidence: 'MEDIUM' };

    // Blank every span this rule consumed, so a generic later label ("total")
    // cannot re-read a specific earlier one ("total amount due").
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
