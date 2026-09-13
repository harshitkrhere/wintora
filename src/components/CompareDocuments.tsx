'use client';

/**
 * Reconcile two uploaded documents: a statement against its EOB.
 *
 * Both sides are pre-filled from what the reader found and both are fully
 * editable, because a machine-read figure is a guess until the customer has
 * looked at it. The check runs on what they confirm, line by line: charges
 * on one document that are not on the other, the same code billed at two
 * amounts, and the totals against each other.
 *
 * Gated on ADVANCED_DOCUMENT_ANALYSIS on the server; here that is only a
 * message. This component renders what the server returns and decides
 * nothing about plans. See docs/ENTITLEMENTS.md section 6.
 */

import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import type { AnalysisResult } from '@/domain/analysis/types';
import type { ExtractionDraft } from '@/domain/documents/draft';
import { offlineFailure, readApiError, type ApiFailure } from '@/lib/http/client';
import { ActionBar } from './ActionBar';
import { ApiNotice } from './ApiNotice';
import { FindingCard } from './FindingCard';
import { Icon } from './Icons';
import { Segmented, segmentedIds } from './Segmented';
import { fromCents, toCents } from './BillCheckerTool';

type Side = 'bill' | 'eob';
const SIDES: readonly { value: Side; label: string }[] = [
  { value: 'bill', label: 'Bill' },
  { value: 'eob', label: 'EOB' },
];

/** A typed amount as money, for the two figures shown above the switch. */
function shown(raw: string, currency: string): string {
  const cents = toCents(raw);
  if (cents === null) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);
}

export interface ReadDocument {
  readonly id: string;
  readonly filename: string | null;
  readonly documentType: string;
  readonly draft: ExtractionDraft | null;
}

interface BillLine {
  id: string;
  description: string;
  code: string;
  amount: string;
}

interface EobLine {
  id: string;
  description: string;
  code: string;
  billed: string;
  allowed: string;
  planPaid: string;
  responsibility: string;
}

interface Response {
  analysis: AnalysisResult;
  headline: string;
  nextSteps: string[];
  disclaimer: string;
  quota?: { remaining: number | null; limit: number | null; resetAt: string | null };
  replayed?: boolean;
}

function billLinesFrom(draft: ExtractionDraft | null): BillLine[] {
  const lines = (draft?.lineItems ?? []).map((li, i) => ({
    id: `b${i}`,
    description: li.description,
    code: li.code ?? '',
    amount: fromCents(li.amountCents),
  }));
  return lines.length > 0 ? lines : [{ id: 'b0', description: '', code: '', amount: '' }];
}

function eobLinesFrom(draft: ExtractionDraft | null): EobLine[] {
  const lines = (draft?.lineItems ?? []).map((li, i) => ({
    id: `e${i}`,
    description: li.description,
    code: li.code ?? '',
    billed: fromCents(li.amountCents),
    allowed: '',
    planPaid: '',
    responsibility: '',
  }));
  return lines.length > 0 ? lines : [{ id: 'e0', description: '', code: '', billed: '', allowed: '', planPaid: '', responsibility: '' }];
}

const opt = (key: string, value: string): Record<string, number> =>
  toCents(value) !== null ? { [key]: toCents(value)! } : {};

export function CompareDocuments({
  caseId,
  documents,
  enabled,
}: {
  caseId: string;
  documents: readonly ReadDocument[];
  enabled: boolean;
}): React.ReactElement {
  const formId = useId();
  const guessBill = documents.find((d) => d.documentType !== 'EOB') ?? documents[0];
  const guessEob = documents.find((d) => d.documentType === 'EOB' && d.id !== guessBill?.id) ?? documents.find((d) => d.id !== guessBill?.id);

  const [billId, setBillId] = useState(guessBill?.id ?? '');
  const [eobId, setEobId] = useState(guessEob?.id ?? '');
  const bill = useMemo(() => documents.find((d) => d.id === billId) ?? null, [documents, billId]);
  const eob = useMemo(() => documents.find((d) => d.id === eobId) ?? null, [documents, eobId]);

  const [billLines, setBillLines] = useState<BillLine[]>(() => billLinesFrom(bill?.draft ?? null));
  const [eobLines, setEobLines] = useState<EobLine[]>(() => eobLinesFrom(eob?.draft ?? null));
  const [subtotal, setSubtotal] = useState('');
  const [total, setTotal] = useState('');
  const [amountDue, setAmountDue] = useState('');
  const [insurancePaid, setInsurancePaid] = useState('');
  const [tax, setTax] = useState('');
  const [payments, setPayments] = useState('');
  const [statementDate, setStatementDate] = useState('');
  const [eobBilled, setEobBilled] = useState('');
  const [eobAllowed, setEobAllowed] = useState('');
  const [eobPlanPaid, setEobPlanPaid] = useState('');
  const [eobResponsibility, setEobResponsibility] = useState('');
  const [currency, setCurrency] = useState<'USD' | 'CAD'>('USD');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiFailure | null>(null);
  // On a phone one side is shown at a time; both stay mounted so edits keep.
  const [side, setSide] = useState<Side>('bill');
  const [result, setResult] = useState<Response | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID().replace(/-/g, ''));

  // Re-fill a side when its document changes. The other side is untouched.
  useEffect(() => {
    const d = bill?.draft ?? null;
    setBillLines(billLinesFrom(d));
    setSubtotal(fromCents(d?.subtotal?.amountCents));
    setTotal(fromCents(d?.total?.amountCents));
    setAmountDue(fromCents(d?.amountDue?.amountCents));
    setInsurancePaid(fromCents(d?.insurancePaid?.amountCents));
    setTax(fromCents(d?.tax?.amountCents));
    setPayments(fromCents(d?.payments?.amountCents));
    setStatementDate(d?.statementDate?.value ?? '');
    if (d?.currency) setCurrency(d.currency);
  }, [bill]);

  useEffect(() => {
    const d = eob?.draft ?? null;
    setEobLines(eobLinesFrom(d));
    setEobBilled(fromCents(d?.total?.amountCents ?? d?.subtotal?.amountCents));
    setEobResponsibility(fromCents(d?.amountDue?.amountCents));
    setEobPlanPaid(fromCents(d?.insurancePaid?.amountCents));
    setEobAllowed('');
  }, [eob]);

  const updateBill = useCallback((id: string, patch: Partial<BillLine>) => {
    setBillLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }, []);
  const updateEob = useCallback((id: string, patch: Partial<EobLine>) => {
    setEobLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }, []);

  const submit = useCallback(
    async (event: React.FormEvent): Promise<void> => {
      event.preventDefault();
      setBusy(true);
      setError(null);
      setResult(null);

      const billFilled = billLines.filter((l) => l.description.trim().length > 0 && toCents(l.amount) !== null);
      const eobFilled = eobLines.filter((l) => l.description.trim().length > 0);
      if (billFilled.length === 0) {
        setError({ code: null, message: 'The statement needs at least one line with a description and an amount.' });
        setBusy(false);
        return;
      }

      const body = {
        caseId,
        idempotencyKey,
        documentId: billId || undefined,
        compareDocumentId: eobId || undefined,
        bill: {
          documentId: billId || `case:${caseId}`,
          currency,
          lineItems: billFilled.map((l, index) => ({
            index,
            description: l.description.trim(),
            ...(l.code.trim().length > 0 ? { code: l.code.trim() } : {}),
            amountCents: toCents(l.amount) ?? 0,
            confidence: 'HIGH' as const,
          })),
          ...opt('subtotalCents', subtotal),
          ...opt('totalCents', total),
          ...opt('amountDueCents', amountDue),
          ...opt('insurancePaidCents', insurancePaid),
          ...opt('taxCents', tax),
          ...opt('paymentsCents', payments),
          ...(statementDate.length > 0 ? { statementDate } : {}),
          overallConfidence: 'HIGH' as const,
        },
        eob: {
          documentId: eobId || `case:${caseId}:eob`,
          currency,
          lines: eobFilled.map((l, index) => ({
            index,
            description: l.description.trim(),
            ...(l.code.trim().length > 0 ? { code: l.code.trim() } : {}),
            ...opt('billedCents', l.billed),
            ...opt('allowedCents', l.allowed),
            ...opt('planPaidCents', l.planPaid),
            ...opt('patientResponsibilityCents', l.responsibility),
            confidence: 'HIGH' as const,
          })),
          ...opt('totalBilledCents', eobBilled),
          ...opt('totalAllowedCents', eobAllowed),
          ...opt('totalPlanPaidCents', eobPlanPaid),
          ...opt('totalPatientResponsibilityCents', eobResponsibility),
          overallConfidence: 'HIGH' as const,
        },
      };

      try {
        const response = await fetch('/api/analyses', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!response.ok) {
          setError(await readApiError(response, 'The comparison could not run. Please try again.'));
          return;
        }
        const json = (await response.json()) as Response | { error: { message: string } };
        if (!('analysis' in json)) {
          setError({ code: null, message: 'error' in json ? json.error.message : 'The comparison could not run. Please try again.' });
          return;
        }
        setResult(json);
        setIdempotencyKey(crypto.randomUUID().replace(/-/g, ''));
      } catch {
        setError(offlineFailure());
      } finally {
        setBusy(false);
      }
    },
    [billLines, eobLines, caseId, idempotencyKey, billId, eobId, currency, subtotal, total, amountDue, insurancePaid, tax, payments, statementDate, eobBilled, eobAllowed, eobPlanPaid, eobResponsibility],
  );

  const label = (d: ReadDocument): string => `${d.filename ?? 'Document'}${d.draft ? ` · ${d.draft.lineItems.length} lines read` : ' · not read'}`;

  return (
    <form onSubmit={submit} className="stack--lg">
      {!enabled ? (
        <p className="notice notice--info">
          Line-by-line reconciliation is part of the paid plans. You can still compare the two
          totals from the upload page. <a href="/pricing">See plans</a>
        </p>
      ) : null}

      {/* On a phone: the two figures that matter side by side, then a
          switch between the two documents. The wide screen shows both. */}
      <div className="show-narrow stack">
        <div className="amount-pair">
          <div className="amount amount--sm">
            <span className="amount__value">{shown(amountDue.length > 0 ? amountDue : total, currency)}</span>
            <span className="amount__label">Bill: amount due</span>
          </div>
          <div className="amount amount--sm">
            <span className="amount__value">{shown(eobResponsibility, currency)}</span>
            <span className="amount__label">EOB: your responsibility</span>
          </div>
        </div>
        <Segmented label="Document" options={SIDES} value={side} onChange={setSide} idBase={`${formId}-side`} />
      </div>

      <div className="compare">
        <section
          className={`card stack compare__side${side === 'bill' ? '' : ' compare__side--off'}`}
          id={segmentedIds(`${formId}-side`, 'bill').panel}
          role="tabpanel"
          aria-labelledby={segmentedIds(`${formId}-side`, 'bill').tab}
        >
          <div className="compare__pick">
            <h2 id={`${formId}-bill`} className="card__title">
              The statement
            </h2>
            <label htmlFor={`${formId}-bill-doc`} className="sr-only">
              Statement document
            </label>
            <select id={`${formId}-bill-doc`} value={billId} onChange={(e) => setBillId(e.target.value)}>
              {documents.map((d) => (
                <option key={d.id} value={d.id}>
                  {label(d)}
                </option>
              ))}
            </select>
          </div>

          <div className="compare-lines">
            {billLines.map((l, i) => (
              <div className="line-item-row" key={l.id}>
                <div>
                  <label htmlFor={`${formId}-bd-${l.id}`} className={i === 0 ? undefined : 'sr-only-wide'}>
                    Description
                  </label>
                  <input id={`${formId}-bd-${l.id}`} value={l.description} maxLength={200} onChange={(e) => updateBill(l.id, { description: e.target.value })} />
                </div>
                <div>
                  <label htmlFor={`${formId}-ba-${l.id}`} className={i === 0 ? undefined : 'sr-only-wide'}>
                    Amount
                  </label>
                  <input id={`${formId}-ba-${l.id}`} value={l.amount} inputMode="decimal" placeholder="0.00" onChange={(e) => updateBill(l.id, { amount: e.target.value })} />
                </div>
                <button type="button" className="btn btn--quiet btn--icon" aria-label={`Remove statement line ${i + 1}`} disabled={billLines.length === 1} onClick={() => setBillLines((p) => p.filter((x) => x.id !== l.id))}>
                  <Icon name="close" />
                </button>
              </div>
            ))}
            <div className="cluster">
              <button type="button" className="btn btn--secondary btn--sm" onClick={() => setBillLines((p) => [...p, { id: `b${Date.now()}`, description: '', code: '', amount: '' }])}>
                <Icon name="plus" />
                Add a line
              </button>
              <span className="caption">Codes are matched first; add them in the description if the statement prints them.</span>
            </div>
          </div>

          <div className="field-row">
            <div className="field">
              <label htmlFor={`${formId}-sub`}>Subtotal</label>
              <input id={`${formId}-sub`} value={subtotal} inputMode="decimal" placeholder="0.00" onChange={(e) => setSubtotal(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor={`${formId}-tot`}>Total charges</label>
              <input id={`${formId}-tot`} value={total} inputMode="decimal" placeholder="0.00" onChange={(e) => setTotal(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor={`${formId}-ins`}>Insurance paid</label>
              <input id={`${formId}-ins`} value={insurancePaid} inputMode="decimal" placeholder="0.00" onChange={(e) => setInsurancePaid(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor={`${formId}-tax`}>Tax, if printed</label>
              <input id={`${formId}-tax`} value={tax} inputMode="decimal" placeholder="0.00" onChange={(e) => setTax(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor={`${formId}-paid`}>Already paid by you</label>
              <input id={`${formId}-paid`} value={payments} inputMode="decimal" placeholder="0.00" onChange={(e) => setPayments(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor={`${formId}-due`}>Amount due</label>
              <input id={`${formId}-due`} value={amountDue} inputMode="decimal" placeholder="0.00" onChange={(e) => setAmountDue(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor={`${formId}-date`}>Statement date</label>
              <input id={`${formId}-date`} type="date" value={statementDate} onChange={(e) => setStatementDate(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor={`${formId}-cur`}>Currency</label>
              <select id={`${formId}-cur`} value={currency} onChange={(e) => setCurrency(e.target.value === 'CAD' ? 'CAD' : 'USD')}>
                <option value="USD">US dollars</option>
                <option value="CAD">Canadian dollars</option>
              </select>
            </div>
          </div>
        </section>

        <section
          className={`card stack compare__side${side === 'eob' ? '' : ' compare__side--off'}`}
          id={segmentedIds(`${formId}-side`, 'eob').panel}
          role="tabpanel"
          aria-labelledby={segmentedIds(`${formId}-side`, 'eob').tab}
        >
          <div className="compare__pick">
            <h2 id={`${formId}-eob`} className="card__title">
              The explanation of benefits
            </h2>
            <label htmlFor={`${formId}-eob-doc`} className="sr-only">
              EOB document
            </label>
            <select id={`${formId}-eob-doc`} value={eobId} onChange={(e) => setEobId(e.target.value)}>
              {documents.map((d) => (
                <option key={d.id} value={d.id}>
                  {label(d)}
                </option>
              ))}
            </select>
          </div>

          <div className="compare-lines">
            {eobLines.map((l, i) => (
              <div className="compare-line" key={l.id}>
                <div className="field">
                  <label htmlFor={`${formId}-ed-${l.id}`} className={i === 0 ? undefined : 'sr-only-wide'}>
                    Service
                  </label>
                  <input id={`${formId}-ed-${l.id}`} value={l.description} maxLength={200} onChange={(e) => updateEob(l.id, { description: e.target.value })} />
                </div>
                <div className="field">
                  <label htmlFor={`${formId}-eb-${l.id}`} className={i === 0 ? undefined : 'sr-only-wide'}>
                    Billed
                  </label>
                  <input id={`${formId}-eb-${l.id}`} value={l.billed} inputMode="decimal" placeholder="0.00" onChange={(e) => updateEob(l.id, { billed: e.target.value })} />
                </div>
                <div className="field">
                  <label htmlFor={`${formId}-ea-${l.id}`} className={i === 0 ? undefined : 'sr-only-wide'}>
                    Allowed
                  </label>
                  <input id={`${formId}-ea-${l.id}`} value={l.allowed} inputMode="decimal" placeholder="0.00" onChange={(e) => updateEob(l.id, { allowed: e.target.value })} />
                </div>
                <div className="field">
                  <label htmlFor={`${formId}-ep-${l.id}`} className={i === 0 ? undefined : 'sr-only-wide'}>
                    Plan paid
                  </label>
                  <input id={`${formId}-ep-${l.id}`} value={l.planPaid} inputMode="decimal" placeholder="0.00" onChange={(e) => updateEob(l.id, { planPaid: e.target.value })} />
                </div>
                <div className="field">
                  <label htmlFor={`${formId}-er-${l.id}`} className={i === 0 ? undefined : 'sr-only-wide'}>
                    You owe
                  </label>
                  <input id={`${formId}-er-${l.id}`} value={l.responsibility} inputMode="decimal" placeholder="0.00" onChange={(e) => updateEob(l.id, { responsibility: e.target.value })} />
                </div>
              </div>
            ))}
            <div className="cluster">
              <button type="button" className="btn btn--secondary btn--sm" onClick={() => setEobLines((p) => [...p, { id: `e${Date.now()}`, description: '', code: '', billed: '', allowed: '', planPaid: '', responsibility: '' }])}>
                <Icon name="plus" />
                Add a line
              </button>
              {eobLines.length > 1 ? (
                <button type="button" className="btn btn--quiet btn--sm" onClick={() => setEobLines((p) => p.slice(0, -1))}>
                  Remove last line
                </button>
              ) : null}
            </div>
          </div>

          <div className="field-row">
            <div className="field">
              <label htmlFor={`${formId}-etb`}>Total billed</label>
              <input id={`${formId}-etb`} value={eobBilled} inputMode="decimal" placeholder="0.00" onChange={(e) => setEobBilled(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor={`${formId}-eta`}>Total allowed</label>
              <input id={`${formId}-eta`} value={eobAllowed} inputMode="decimal" placeholder="0.00" onChange={(e) => setEobAllowed(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor={`${formId}-etp`}>Plan paid</label>
              <input id={`${formId}-etp`} value={eobPlanPaid} inputMode="decimal" placeholder="0.00" onChange={(e) => setEobPlanPaid(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor={`${formId}-etr`}>Your responsibility</label>
              <input id={`${formId}-etr`} value={eobResponsibility} inputMode="decimal" placeholder="0.00" onChange={(e) => setEobResponsibility(e.target.value)} />
            </div>
          </div>
        </section>
      </div>

      <ActionBar
        secondary={
          <span className="small muted">
            {billId === eobId ? 'Choose two different documents.' : 'Runs on the figures as you have confirmed them, and is saved to the case.'}
          </span>
        }
      >
        <button type="submit" className="btn btn--primary btn--lg" disabled={busy || !enabled || billId === eobId} aria-busy={busy}>
          {busy ? 'Comparing…' : 'Run the check'}
        </button>
      </ActionBar>

      <ApiNotice failure={error} />

      {result !== null ? (
        <section aria-live="polite" className="stack--md reveal">
          <div>
            <h2 className="m-0">{result.headline}</h2>
            <p className="small muted mt-1">
              {result.analysis.summary.lineItemCount} statement line{result.analysis.summary.lineItemCount === 1 ? '' : 's'} checked against{' '}
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
              <h3 className="card__title">What you can do next</h3>
              <ul className="check-list">
                {result.nextSteps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ul>
            </div>
          ) : null}
          <p className="notice">{result.disclaimer}</p>
          <p className="notice notice--success">
            {result.replayed === true ? 'This comparison was already saved to your case.' : 'Saved to your case.'}
            {result.quota?.limit !== null && result.quota?.limit !== undefined ? ` ${result.quota.remaining ?? 0} of ${result.quota.limit} analyses left this period.` : ''}{' '}
            <a href={`/cases/${caseId}`}>Back to the case</a>
          </p>
        </section>
      ) : null}
    </form>
  );
}
