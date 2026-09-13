/**
 * The one thing to do next about a case, computed from what has actually
 * happened to it rather than remembered anywhere.
 *
 * Home, the case card and the case overview all show this same answer, so
 * a person never has to work out where they left off. The rules read the
 * case's real rows: which documents were kept, which of them a completed
 * check has covered, which letters exist and whether any went out. They
 * are pure, ordered, and tested in tests/next-step.test.ts; the loaders in
 * ./load.ts assemble the facts from the rows they already fetch, scoped by
 * user id, and nothing here touches the database.
 *
 * What counts (see docs/MOBILE.md and the plan that set this):
 *   kept document   not deleted, and the scan came back CLEAN. An upload
 *                   that never finished, was refused or failed is not a
 *                   document for these purposes, though the case's own
 *                   documents screen still lists it with its status.
 *   bill / eob      a kept document by its stored type. Anything else is
 *                   kept and listed but never asked for a step.
 *   checked bill    a completed check names it as the document or the
 *                   compared document. A check on typed figures checks
 *                   no document.
 *   checked eob     a completed bill-vs-EOB check names it as the
 *                   compared document.
 *   letter          not deleted, not archived. Unsent means sent_at is
 *                   null whatever the draft's status.
 */

import type { AnalysisResult, FindingCode, Severity } from '@/domain/analysis/types';
import { suggestedActions } from '@/domain/analysis/engine';
import { isBillType } from '@/domain/documents/types';

export interface FactDocument {
  readonly id: string;
  readonly type: string;
  readonly scanStatus: string;
  readonly extractionStatus: string;
  readonly deletedAt: string | null;
  readonly createdAt: string;
  readonly filename?: string | null;
}

export interface FactAnalysis {
  readonly type: string;
  readonly status: string;
  readonly documentId: string | null;
  readonly compareDocumentId: string | null;
  readonly worstSeverity: Severity | null;
  readonly createdAt: string;
}

export interface FactLetter {
  readonly id: string;
  readonly status: string;
  readonly sentAt: string | null;
  readonly deletedAt: string | null;
  readonly updatedAt: string;
}

export interface CaseFacts {
  readonly id: string;
  readonly status: string;
  readonly documents: readonly FactDocument[];
  readonly analyses: readonly FactAnalysis[];
  readonly letters: readonly FactLetter[];
}

export type StepKey = 'upload-bill' | 'check-figures' | 'compare' | 'request' | 'draft' | 'add-eob';

export interface NextStep {
  readonly key: StepKey;
  /** The action, as a button would say it. */
  readonly label: string;
  /** One line on why, for the card. */
  readonly hint: string;
  readonly href: string;
}

function byCreated(a: { createdAt: string }, b: { createdAt: string }): number {
  return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
}

export function isKept(document: FactDocument): boolean {
  return document.deletedAt === null && document.scanStatus === 'CLEAN';
}

/** Kept documents on the case, all kinds. The count shown on cards. */
export function keptDocuments(documents: readonly FactDocument[]): FactDocument[] {
  return documents.filter(isKept);
}

function isLetter(letter: FactLetter): boolean {
  return letter.deletedAt === null && letter.status !== 'ARCHIVED';
}

export function nextStepFor(facts: CaseFacts): NextStep | null {
  // 1. A closed case asks for nothing. The overview offers to reopen it.
  if (facts.status !== 'OPEN') return null;

  const kept = keptDocuments(facts.documents).sort(byCreated);
  const bills = kept.filter((d) => isBillType(d.type));
  const eobs = kept.filter((d) => d.type === 'EOB');
  const completed = facts.analyses.filter((a) => a.status === 'COMPLETED').sort(byCreated).reverse();

  const covered = new Set<string>();
  const compared = new Set<string>();
  for (const check of completed) {
    if (check.documentId !== null) covered.add(check.documentId);
    if (check.compareDocumentId !== null) {
      covered.add(check.compareDocumentId);
      if (check.type === 'BILL_VS_EOB') compared.add(check.compareDocumentId);
    }
  }

  const base = `/cases/${facts.id}`;

  // 2. Nothing the engine can read as a bill. An EOB alone still needs one.
  if (bills.length === 0) {
    return {
      key: 'upload-bill',
      label: 'Upload the bill',
      hint: 'A PDF from the patient portal reads best. A clear photo works too.',
      href: `/upload?case=${facts.id}&type=BILL`,
    };
  }

  // 3. A bill nobody has checked yet, oldest first. Whether it was read
  //    does not matter: a failed read is finished with typed figures.
  const uncheckedBill = bills.find((d) => !covered.has(d.id));
  if (uncheckedBill !== undefined) {
    return {
      key: 'check-figures',
      label: 'Check the figures',
      hint: uncheckedBill.filename ? `${uncheckedBill.filename} is in, and has not been checked.` : 'A bill is in, and has not been checked.',
      href: `/upload?case=${facts.id}&document=${uncheckedBill.id}`,
    };
  }

  // 4. An EOB that has not been set against the bill. Every bill is
  //    checked by now, so its figures exist.
  const uncheckedEob = eobs.find((d) => !compared.has(d.id));
  if (uncheckedEob !== undefined) {
    return {
      key: 'compare',
      label: 'Compare with the bill',
      hint: 'Your EOB is in. The check shows where the two documents disagree.',
      href: `${base}/compare`,
    };
  }

  const letters = facts.letters.filter(isLetter);
  const latest = completed[0];
  const attention = latest?.worstSeverity ?? null;

  // 5. The latest check found something, and nothing has been written yet.
  if ((attention === 'ATTENTION' || attention === 'REVIEW') && letters.length === 0) {
    return {
      key: 'request',
      label: 'Prepare a request',
      hint: 'A draft from a reviewed template, filled with your facts, for you to read and send.',
      href: `${base}/letters/new`,
    };
  }

  // 6. A draft that has not gone out.
  const unsent = letters.filter((l) => l.sentAt === null);
  if (unsent.length === 1) {
    return {
      key: 'draft',
      label: 'Review your draft',
      hint: 'Read it, change anything, and send it yourself when it is right.',
      href: `${base}/letters/${unsent[0]!.id}`,
    };
  }
  if (unsent.length > 1) {
    return {
      key: 'draft',
      label: 'Review your drafts',
      hint: `${unsent.length} drafts are waiting to be read and sent.`,
      href: `${base}/letters`,
    };
  }

  // 7. No EOB, and nothing has been sent yet that the case is waiting on.
  const sent = letters.length - unsent.length;
  if (eobs.length === 0 && sent === 0) {
    return {
      key: 'add-eob',
      label: 'Add your EOB',
      hint: 'The insurer’s explanation of benefits shows what they allowed and what is yours to pay.',
      href: `/upload?case=${facts.id}&type=EOB`,
    };
  }

  // 8. Nothing waiting on the person.
  return null;
}

/**
 * Home's one card: the first open case, newest activity first, that has a
 * step. `resumed` is true when that case changed in the last day, so the
 * card can say "continue where you left off" rather than "your next step".
 */
export function pickHomeStep<T extends { readonly id: string; readonly title: string; readonly status: string; readonly updatedAt: string; readonly nextStep: NextStep | null }>(
  cases: readonly T[],
  now: Date,
): { caseSummary: T; step: NextStep; resumed: boolean } | null {
  const open = cases
    .filter((c) => c.status === 'OPEN' && c.nextStep !== null)
    .sort((a, b) => (a.updatedAt > b.updatedAt ? -1 : a.updatedAt < b.updatedAt ? 1 : 0));
  const first = open[0];
  if (first === undefined || first.nextStep === null) return null;
  const age = now.getTime() - Date.parse(first.updatedAt);
  return { caseSummary: first, step: first.nextStep, resumed: age >= 0 && age < 24 * 60 * 60 * 1000 };
}

/* ------------------------------------------------------------- the checklist */

export interface Step {
  readonly text: string;
  readonly done: boolean;
}

/**
 * The checklist for a case: the engine's suggested actions for the latest
 * check, each marked done or not by the customer's own timeline entries
 * (newest first, so the first STEP_* event for a step is the current state).
 * Returns an empty list when there is nothing to chase.
 */
export function checklistFor(
  analysis: { readonly engineVersion: string; readonly analysisType: string; readonly findings: AnalysisResult['findings'] },
  events: readonly { readonly eventType: string; readonly detail: string | null }[],
): Step[] {
  const codes = new Set(analysis.findings.map((f) => f.code));
  if (codes.has('NO_ISSUES_FOUND')) return [];

  // suggestedActions reads only the findings and the analysis type; the rest
  // of the result is not stored and is not needed.
  const shape: AnalysisResult = {
    engineVersion: analysis.engineVersion,
    analysisType: analysis.analysisType === 'BILL_VS_EOB' ? 'BILL_VS_EOB' : 'BILL_CONSISTENCY',
    findings: analysis.findings,
    checksRun: [],
    summary: { lineItemCount: 0, totalChargesCents: null, currency: 'USD', attention: 0, review: 0, info: 0 },
  };
  const actions = suggestedActions(shape, { savedToCase: true });
  if (actions.every((a) => a.startsWith('Nothing to chase'))) return [];

  return actions.map((text) => {
    const last = events.find(
      (e) => (e.eventType === 'STEP_DONE' || e.eventType === 'STEP_REOPENED') && e.detail === text,
    );
    return { text, done: last?.eventType === 'STEP_DONE' };
  });
}

/* ------------------------------------------------ a finding's own next step */

/**
 * The letter a finding calls for, by template key seeded in the database
 * (supabase/migrations/0012 and 0019). A code with no letter to write
 * returns null and the finding shows its text as before.
 */
const TEMPLATE_FOR: Partial<Record<FindingCode, { key: string; label: string }>> = {
  MISSING_ITEMIZATION: { key: 'REQUEST_ITEMIZED_BILL', label: 'Ask for an itemized statement' },
  LINE_ITEM_SUM_MISMATCH: { key: 'REQUEST_BILLING_CLARIFICATION', label: 'Ask the billing office to clarify' },
  TOTAL_RECONCILIATION_MISMATCH: { key: 'REQUEST_BILLING_CLARIFICATION', label: 'Ask the billing office to clarify' },
  UNEXPLAINED_BALANCE_CHANGE: { key: 'REQUEST_BILLING_CLARIFICATION', label: 'Ask the billing office to clarify' },
  DUPLICATE_LINE_ITEM: { key: 'REQUEST_BILLING_CLARIFICATION', label: 'Ask about these charges' },
  REPEATED_SERVICE_DESCRIPTION: { key: 'REQUEST_BILLING_CLARIFICATION', label: 'Ask about these charges' },
  QUANTITY_PRICE_MISMATCH: { key: 'REQUEST_BILLING_CLARIFICATION', label: 'Ask about these charges' },
  MISSING_REQUIRED_FIELD: { key: 'REQUEST_BILLING_CLARIFICATION', label: 'Ask the billing office to clarify' },
  SERVICE_DATE_AFTER_STATEMENT_DATE: { key: 'REQUEST_BILLING_CLARIFICATION', label: 'Ask the billing office to clarify' },
  INCONSISTENT_SERVICE_DATES: { key: 'REQUEST_BILLING_CLARIFICATION', label: 'Ask the billing office to clarify' },
  BILL_EXCEEDS_EOB_PATIENT_RESPONSIBILITY: { key: 'REQUEST_CORRECTED_STATEMENT', label: 'Ask for a corrected statement' },
  EOB_PLAN_PAYMENT_NOT_REFLECTED: { key: 'REQUEST_CORRECTED_STATEMENT', label: 'Ask for a corrected statement' },
  BILLED_AMOUNT_DIFFERS_FROM_EOB: { key: 'REQUEST_CORRECTED_STATEMENT', label: 'Ask for a corrected statement' },
  CHARGE_NOT_ON_EOB: { key: 'REQUEST_CORRECTED_STATEMENT', label: 'Ask for a corrected statement' },
  EOB_LINE_NOT_ON_BILL: { key: 'REQUEST_CORRECTED_STATEMENT', label: 'Ask for a corrected statement' },
};

export function actionForFinding(code: FindingCode, caseId: string): { href: string; label: string } | null {
  const template = TEMPLATE_FOR[code];
  if (template === undefined) return null;
  return { href: `/cases/${caseId}/letters/new?template=${template.key}`, label: template.label };
}
