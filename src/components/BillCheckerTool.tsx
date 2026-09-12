'use client';

/**
 * The free bill checker.
 *
 * Runs without an account. Nothing is stored: the figures go to the API, the
 * deterministic engine runs, the result comes back, and it is gone. That is
 * stated on the page rather than assumed.
 *
 * This component contains no authorization logic and no plan checks. It renders
 * what the server returns. See docs/ENTITLEMENTS.md section 6.
 */

import { useCallback, useId, useMemo, useState } from 'react';
import type { AnalysisResult, Finding, Severity } from '@/domain/analysis/types';
import type { ExtractionDraft } from '@/domain/documents/draft';

interface DraftLine {
  readonly id: string;
  description: string;
  amount: string;
  code: string;
}

/**
 * The two analysis endpoints share everything except their footer. The
 * anonymous tool reports that nothing was stored; the case-bound route reports
 * what the run cost against the plan. Both are optional here so a response
 * shape from one cannot crash a page built for the other, which is exactly
 * what happened the first time a saved analysis rendered.
 */
interface ApiResponse {
  analysis: AnalysisResult;
  headline: string;
  nextSteps: string[];
  disclaimer: string;
  storage?: { stored: boolean; note: string };
  quota?: { remaining: number | null; limit: number | null; resetAt: string | null };
  replayed?: boolean;
}

const SEVERITY_LABEL: Record<Severity, string> = {
  ATTENTION: 'Worth a closer look',
  REVIEW: 'Worth confirming',
  INFO: 'For information',
};

function newLine(): DraftLine {
  return {
    id: Math.random().toString(36).slice(2),
    description: '',
    amount: '',
    code: '',
  };
}

/** Parse a typed amount to integer cents. Rejects anything ambiguous. */
function toCents(value: string): number | null {
  const cleaned = value.replace(/[$,\s]/g, '');
  if (cleaned.length === 0) return null;
  if (!/^-?\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  return Math.round(Number(cleaned) * 100);
}

/** Cents to the string a person would type: 123456 -> "1234.56". */
function fromCents(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return '';
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

function linesFromDraft(draft: ExtractionDraft): DraftLine[] {
  const fromDraft = draft.lineItems.map((li) => ({
    id: Math.random().toString(36).slice(2),
    description: li.description,
    amount: fromCents(li.amountCents),
    code: li.code ?? '',
  }));
  // Always leave room to add what the reader missed.
  return fromDraft.length > 0 ? [...fromDraft, newLine()] : [newLine(), newLine(), newLine()];
}

export function BillCheckerTool({
  showEob = false,
  initial = null,
  caseId = null,
}: {
  showEob?: boolean;
  /**
   * A machine-read draft to pre-fill the form. Every value is editable and
   * nothing is submitted until the customer presses the button: the draft is
   * a suggestion, the form is the fact.
   */
  initial?: ExtractionDraft | null;
  /**
   * When set, the analysis is saved to this case via /api/analyses and counts
   * against the plan's quota. When null, this is the anonymous public tool.
   */
  caseId?: string | null;
}): React.ReactElement {
  const formId = useId();
  const [lines, setLines] = useState<DraftLine[]>(() =>
    initial ? linesFromDraft(initial) : [newLine(), newLine(), newLine()],
  );
  const [subtotal, setSubtotal] = useState(fromCents(initial?.subtotal?.amountCents));
  const [total, setTotal] = useState(fromCents(initial?.total?.amountCents));
  const [accountReference, setAccountReference] = useState(initial?.accountReference?.value ?? '');
  const [amountDue, setAmountDue] = useState(fromCents(initial?.amountDue?.amountCents));
  const [insurancePaid, setInsurancePaid] = useState(fromCents(initial?.insurancePaid?.amountCents));
  const [adjustments, setAdjustments] = useState(fromCents(initial?.adjustments?.amountCents));
  const [statementDate, setStatementDate] = useState(initial?.statementDate?.value ?? '');
  const [eobPatientResponsibility, setEobPatientResponsibility] = useState('');
  const [eobPlanPaid, setEobPlanPaid] = useState('');
  const [currency, setCurrency] = useState<'USD' | 'CAD'>(initial?.currency ?? 'USD');
  // Stable for the life of this form so a double-click or a retry after a
  // dropped connection is the same analysis, not a second one billed twice.
  const [idempotencyKey] = useState(() => crypto.randomUUID().replace(/-/g, ''));

  const [result, setResult] = useState<ApiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const typedTotal = useMemo(() => {
    const cents = lines.reduce((acc, line) => acc + (toCents(line.amount) ?? 0), 0);
    return cents;
  }, [lines]);

  const updateLine = useCallback(
    (id: string, patch: Partial<DraftLine>): void => {
      setLines((prev) =>
        prev.map((line) => (line.id === id ? { ...line, ...patch } : line)),
      );
    },
    [],
  );

  const submit = useCallback(
    async (event: React.FormEvent): Promise<void> => {
      event.preventDefault();
      setBusy(true);
      setError(null);
      setResult(null);

      const filled = lines.filter(
        (line) => line.description.trim().length > 0 && toCents(line.amount) !== null,
      );

      if (filled.length === 0) {
        setError('Add at least one line item with a description and an amount.');
        setBusy(false);
        return;
      }

      const bill = {
        documentId: caseId !== null ? `case:${caseId}` : 'anonymous-tool',
        currency,
        lineItems: filled.map((line, index) => ({
          index,
          description: line.description.trim(),
          ...(line.code.trim().length > 0 ? { code: line.code.trim() } : {}),
          amountCents: toCents(line.amount) ?? 0,
          confidence: 'HIGH' as const,
        })),
        ...(toCents(subtotal) !== null ? { subtotalCents: toCents(subtotal)! } : {}),
        ...(toCents(total) !== null ? { totalCents: toCents(total)! } : {}),
        ...(accountReference.trim().length > 0 ? { accountReference: accountReference.trim() } : {}),
        ...(toCents(amountDue) !== null ? { amountDueCents: toCents(amountDue)! } : {}),
        ...(toCents(insurancePaid) !== null
          ? { insurancePaidCents: toCents(insurancePaid)! }
          : {}),
        ...(toCents(adjustments) !== null
          ? { adjustmentsCents: toCents(adjustments)! }
          : {}),
        ...(statementDate.length > 0 ? { statementDate } : {}),
        overallConfidence: 'HIGH' as const,
      };

      const eobResponsibility = toCents(eobPatientResponsibility);
      const eobPaid = toCents(eobPlanPaid);
      const eob =
        showEob && (eobResponsibility !== null || eobPaid !== null)
          ? {
              documentId: 'anonymous-tool-eob',
              currency,
              lines: [],
              ...(eobResponsibility !== null
                ? { totalPatientResponsibilityCents: eobResponsibility }
                : {}),
              ...(eobPaid !== null ? { totalPlanPaidCents: eobPaid } : {}),
            }
          : undefined;

      try {
        const payload = eob !== undefined ? { bill, eob } : { bill };
        const response = await fetch(caseId !== null ? '/api/analyses' : '/api/tools/bill-check', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(caseId !== null ? { caseId, idempotencyKey, ...payload } : payload),
        });

        const json = (await response.json()) as ApiResponse | { error: { message: string } };

        if (!response.ok) {
          setError(
            'error' in json
              ? json.error.message
              : 'Something went wrong. Please try again.',
          );
          return;
        }

        setResult(json as ApiResponse);
      } catch {
        setError('We could not reach the service. Please check your connection.');
      } finally {
        setBusy(false);
      }
    },
    [
      lines,
      subtotal,
      amountDue,
      insurancePaid,
      adjustments,
      statementDate,
      currency,
      showEob,
      eobPatientResponsibility,
      eobPlanPaid,
    ],
  );

  return (
    <div className="stack--lg">
      <form onSubmit={submit} className="card" aria-labelledby={`${formId}-heading`}>
        <h2 id={`${formId}-heading`} style={{ marginTop: 0 }}>
          Enter the figures from your statement
        </h2>
        <p className="small muted">
          Copy the numbers exactly as they are printed. You do not need every line for
          the checks to be useful.
        </p>

        <fieldset style={{ border: 'none', padding: 0, margin: '1.25rem 0 0' }}>
          <legend className="eyebrow" style={{ padding: 0 }}>
            Line items
          </legend>

          {lines.map((line, index) => (
            <div className="line-item-row" key={line.id}>
              <div>
                <label htmlFor={`${formId}-desc-${line.id}`}>
                  {index === 0 ? 'Description' : <span className="sr-only">Description</span>}
                </label>
                <input
                  id={`${formId}-desc-${line.id}`}
                  value={line.description}
                  onChange={(e) => updateLine(line.id, { description: e.target.value })}
                  placeholder="e.g. Emergency department visit"
                  maxLength={200}
                />
              </div>
              <div>
                <label htmlFor={`${formId}-amt-${line.id}`}>
                  {index === 0 ? 'Amount' : <span className="sr-only">Amount</span>}
                </label>
                <input
                  id={`${formId}-amt-${line.id}`}
                  value={line.amount}
                  onChange={(e) => updateLine(line.id, { amount: e.target.value })}
                  inputMode="decimal"
                  placeholder="0.00"
                />
              </div>
              <button
                type="button"
                className="btn btn--quiet"
                onClick={() => setLines((prev) => prev.filter((l) => l.id !== line.id))}
                aria-label={`Remove line ${index + 1}`}
                disabled={lines.length === 1}
              >
                ×
              </button>
            </div>
          ))}

          <button
            type="button"
            className="btn btn--secondary"
            onClick={() => setLines((prev) => [...prev, newLine()])}
          >
            Add another line
          </button>

          <p className="small muted" style={{ marginTop: '0.75rem' }}>
            Your lines currently add up to{' '}
            <strong>
              {new Intl.NumberFormat(currency === 'CAD' ? 'en-CA' : 'en-US', {
                style: 'currency',
                currency,
              }).format(typedTotal / 100)}
            </strong>
            .
          </p>
        </fieldset>

        <fieldset style={{ border: 'none', padding: 0, margin: '1.5rem 0 0' }}>
          <legend className="eyebrow" style={{ padding: 0 }}>
            Totals as printed
          </legend>

          <div className="field-row">
            <div className="field">
              <label htmlFor={`${formId}-subtotal`}>Subtotal</label>
              <input
                id={`${formId}-subtotal`}
                value={subtotal}
                onChange={(e) => setSubtotal(e.target.value)}
                inputMode="decimal"
                placeholder="0.00"
              />
            </div>
            <div className="field">
              <label htmlFor={`${formId}-total`}>Total charges</label>
              <input
                id={`${formId}-total`}
                value={total}
                onChange={(e) => setTotal(e.target.value)}
                inputMode="decimal"
                placeholder="0.00"
              />
            </div>
            <div className="field">
              <label htmlFor={`${formId}-adjustments`}>Adjustments or discounts</label>
              <input
                id={`${formId}-adjustments`}
                value={adjustments}
                onChange={(e) => setAdjustments(e.target.value)}
                inputMode="decimal"
                placeholder="0.00"
              />
            </div>
            <div className="field">
              <label htmlFor={`${formId}-insurance`}>Insurance paid</label>
              <input
                id={`${formId}-insurance`}
                value={insurancePaid}
                onChange={(e) => setInsurancePaid(e.target.value)}
                inputMode="decimal"
                placeholder="0.00"
              />
            </div>
            <div className="field">
              <label htmlFor={`${formId}-due`}>Amount due</label>
              <input
                id={`${formId}-due`}
                value={amountDue}
                onChange={(e) => setAmountDue(e.target.value)}
                inputMode="decimal"
                placeholder="0.00"
              />
            </div>
            <div className="field">
              <label htmlFor={`${formId}-date`}>Statement date</label>
              <input
                id={`${formId}-date`}
                type="date"
                value={statementDate}
                onChange={(e) => setStatementDate(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor={`${formId}-currency`}>Currency</label>
              <select
                id={`${formId}-currency`}
                value={currency}
                onChange={(e) => setCurrency(e.target.value === 'CAD' ? 'CAD' : 'USD')}
              >
                <option value="USD">US dollars</option>
                <option value="CAD">Canadian dollars</option>
              </select>
            </div>
          </div>
        </fieldset>

        {showEob ? (
          <fieldset style={{ border: 'none', padding: 0, margin: '1.5rem 0 0' }}>
            <legend className="eyebrow" style={{ padding: 0 }}>
              From your explanation of benefits
            </legend>
            <div className="field-row">
              <div className="field">
                <label htmlFor={`${formId}-eob-resp`}>Your responsibility</label>
                <input
                  id={`${formId}-eob-resp`}
                  value={eobPatientResponsibility}
                  onChange={(e) => setEobPatientResponsibility(e.target.value)}
                  inputMode="decimal"
                  placeholder="0.00"
                />
              </div>
              <div className="field">
                <label htmlFor={`${formId}-eob-paid`}>Plan paid</label>
                <input
                  id={`${formId}-eob-paid`}
                  value={eobPlanPaid}
                  onChange={(e) => setEobPlanPaid(e.target.value)}
                  inputMode="decimal"
                  placeholder="0.00"
                />
              </div>
            </div>
          </fieldset>
        ) : null}

        <div style={{ marginTop: '1.5rem', display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          <button type="submit" className="btn btn--primary" disabled={busy}>
            {busy ? 'Checking…' : 'Check my bill'}
          </button>
          <span className="small muted">
            {caseId !== null ? 'Saved to your case.' : 'No account needed.'}
          </span>
        </div>

        {error !== null ? (
          <p role="alert" className="notice" style={{ marginTop: '1rem' }}>
            {error}
          </p>
        ) : null}
      </form>

      {result !== null ? <Results result={result} /> : null}
    </div>
  );
}

function Results({ result }: { result: ApiResponse }): React.ReactElement {
  return (
    <section aria-live="polite" className="stack--lg">
      <div>
        <p className="eyebrow">What we found</p>
        <h2 style={{ marginBottom: '0.35rem' }}>{result.headline}</h2>
        <p className="small muted">
          {result.analysis.summary.lineItemCount} line item
          {result.analysis.summary.lineItemCount === 1 ? '' : 's'} checked against{' '}
          {result.analysis.checksRun.length} rules.
        </p>
      </div>

      <div className="stack">
        {result.analysis.findings.map((finding, index) => (
          <FindingCard key={`${finding.code}-${index}`} finding={finding} />
        ))}
      </div>

      {result.nextSteps.length > 0 ? (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>What you can do next</h3>
          <ul className="plan__features">
            {result.nextSteps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <p className="notice">{result.disclaimer}</p>
      {result.storage !== undefined ? (
        <p className="notice notice--accent">{result.storage.note}</p>
      ) : (
        <p className="notice notice--accent">
          {result.replayed === true
            ? 'This result was already saved to your case; nothing was counted twice.'
            : 'Saved to your case.'}
          {result.quota?.limit !== null && result.quota?.limit !== undefined ? (
            <>
              {' '}
              {result.quota.remaining ?? 0} of {result.quota.limit} analyses left this period.
            </>
          ) : null}
        </p>
      )}
    </section>
  );
}

function FindingCard({ finding }: { finding: Finding }): React.ReactElement {
  const modifier =
    finding.severity === 'ATTENTION'
      ? 'finding--attention'
      : finding.severity === 'REVIEW'
        ? 'finding--review'
        : '';

  return (
    <article className={`finding ${modifier}`.trim()}>
      <p
        className={`finding__severity ${
          finding.severity === 'INFO' ? 'finding__severity--info' : ''
        }`.trim()}
      >
        {SEVERITY_LABEL[finding.severity]}
        {finding.confidence !== 'HIGH' ? ` · ${finding.confidence.toLowerCase()} confidence` : ''}
      </p>
      <h3>{finding.title}</h3>
      <p>{finding.explanation}</p>

      {finding.recommendedAction !== undefined ? (
        <p className="small">
          <strong>Suggested next step:</strong> {finding.recommendedAction}
        </p>
      ) : null}

      {/* The numbers behind the claim. A finding a user cannot verify is a
          finding a user should not trust. */}
      {finding.evidence.length > 0 ? (
        <details>
          <summary className="small">Show the numbers this is based on</summary>
          <div className="evidence">
            {finding.evidence.map((evidence, index) => (
              <div key={index}>
                <span>{evidence.fieldPath}: </span>
                {Object.entries(evidence.observed).map(([key, value]) => (
                  <span key={key}>
                    {key}={String(value)}{' '}
                  </span>
                ))}
              </div>
            ))}
          </div>
        </details>
      ) : null}
    </article>
  );
}
