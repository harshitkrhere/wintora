'use client';

/**
 * Review a document: bring it in, have it read, confirm the figures, run
 * the check.
 *
 * Three steps, shown as three steps, and the customer is in control of the
 * one that matters: the machine-read draft is shown in the same form they
 * could have filled in by hand, every value editable, and nothing is
 * analysed until they press the button. A misread costs them a correction.
 * It cannot become a finding.
 *
 * The kind of document is chosen first (a bill, an EOB, something else),
 * preselected by the Review sheet through the URL and changeable here. The
 * engine checks bills and EOBs; anything else is kept with the case and
 * the words say so before the file is chosen.
 *
 * The case is created the moment a file is chosen, named after the file,
 * and renamed after the provider on the bill once the document has been
 * read. Nobody is asked to name a bill they have not shown us yet. The name
 * can be changed on the review step, and it is saved as soon as they leave
 * the field. Once a case exists the URL says so, so a reload comes back to
 * it, and a document that was read but never checked can be reopened at
 * the review step from anywhere (`resume`).
 *
 * The file goes browser -> storage directly, using a signed URL the server
 * issued for exactly one path. The server never sees the bytes in transit;
 * it reads them back from storage to inspect them.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { ExtractionDraft } from '@/domain/documents/draft';
import { INTAKE_TYPES, intakeFor, intakeForDocumentType, type IntakeKey } from '@/domain/documents/intake';
import { titleFromFilename } from '@/domain/documents/title';
import { clearHandoff, handoffToDraft, readHandoff, type CheckerHandoff } from '@/domain/checker/handoff';
import { offlineFailure, readApiError, type ApiFailure } from '@/lib/http/client';
import { ActionBar } from './ActionBar';
import { ApiNotice } from './ApiNotice';
import { BillCheckerTool } from './BillCheckerTool';
import { Icon } from './Icons';
import { Segmented } from './Segmented';
import { UploadProgress, type UploadStage } from './UploadProgress';

interface CaseSummary {
  id: string;
  title: string;
  status: string;
}

interface DocumentSummary {
  id: string;
  filename: string | null;
  documentType: string;
  scanStatus: string;
  scanDetail: string | null;
  extractionStatus: string;
}

/** A kept document reopened at the review step, as the server page loaded it. */
export interface ResumeDocument {
  readonly id: string;
  readonly filename: string | null;
  readonly documentType: string;
  readonly scanStatus: string;
  readonly extractionStatus: string;
  readonly pageCount: number | null;
  /** Null when the read failed or never finished: the figures are typed. */
  readonly draft: ExtractionDraft | null;
}

type Step =
  | { kind: 'choose-file'; caseId: string | null }
  | { kind: 'uploading'; caseId: string | null; stage: UploadStage }
  | { kind: 'rejected'; caseId: string; message: string }
  | {
      kind: 'review';
      caseId: string;
      /** Null when the figures are being typed in with no document behind them. */
      documentId: string | null;
      draft: ExtractionDraft;
      document: DocumentSummary | null;
      caseTitle: string;
      intake: IntakeKey;
      /** The document is here but nothing could be read from it. */
      unread: boolean;
    };

const ACCEPT = '.pdf,.png,.jpg,.jpeg,.heic,.tif,.tiff,application/pdf,image/png,image/jpeg,image/heic,image/tiff';

const EMPTY_DRAFT: ExtractionDraft = {
  engine: 'none', engineVersion: '0', currency: null, lineItems: [],
  subtotal: null, total: null, amountDue: null, insurancePaid: null,
  adjustments: null, previousBalance: null, tax: null, payments: null, statementDate: null,
  providerName: null, accountReference: null, pageCount: null,
  overallConfidence: 'LOW', notes: [],
};

const INTAKE_OPTIONS = INTAKE_TYPES.map((type) => ({ value: type.key, label: type.label }));

export function UploadFlow({
  initialCaseId = null,
  initialCaseTitle = null,
  initialIntake = 'BILL',
  resume = null,
  notice = null,
  fromChecker = false,
}: {
  initialCaseId?: string | null;
  initialCaseTitle?: string | null;
  initialIntake?: IntakeKey;
  resume?: ResumeDocument | null;
  /** One neutral sentence from the server page about a URL it could not honour. */
  notice?: string | null;
  fromChecker?: boolean;
}): React.ReactElement {
  const [intake, setIntake] = useState<IntakeKey>(initialIntake);
  const [step, setStep] = useState<Step>(() => {
    if (resume !== null && initialCaseId !== null) {
      return {
        kind: 'review',
        caseId: initialCaseId,
        documentId: resume.id,
        draft: resume.draft ?? EMPTY_DRAFT,
        document: {
          id: resume.id,
          filename: resume.filename,
          documentType: resume.documentType,
          scanStatus: resume.scanStatus,
          scanDetail: null,
          extractionStatus: resume.extractionStatus,
        },
        caseTitle: initialCaseTitle ?? (resume.filename !== null ? titleFromFilename(resume.filename) : 'Case'),
        intake: intakeForDocumentType(resume.documentType).key,
        unread: resume.draft === null,
      };
    }
    return { kind: 'choose-file', caseId: initialCaseId };
  });
  const [cases, setCases] = useState<CaseSummary[] | null>(null);
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [hasResult, setHasResult] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [starting, setStarting] = useState(false);
  const [rereading, setRereading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  // Figures typed into the free checker before signing up, held in this tab.
  // Read once, on arrival with ?from=checker; shown as an offer, never acted
  // on until the person chooses.
  const [handoff, setHandoff] = useState<CheckerHandoff | null>(null);
  useEffect(() => {
    if (initialCaseId !== null || !fromChecker) return;
    setHandoff(readHandoff(window.sessionStorage));
  }, [initialCaseId, fromChecker]);

  // Existing cases, for the person who wants to add a second document to one.
  // Fetched once, only when the case is not already decided.
  useEffect(() => {
    if (initialCaseId !== null) return;
    fetch('/api/cases', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { cases: [] }))
      .then((j: { cases?: CaseSummary[] }) => setCases((j.cases ?? []).filter((c) => c.status === 'OPEN')))
      .catch(() => setCases([]));
  }, [initialCaseId]);

  /** The URL follows the case, so a reload comes back to it. */
  const rememberCase = useCallback((caseId: string, kind: IntakeKey): void => {
    try {
      window.history.replaceState(window.history.state, '', `/upload?case=${caseId}&type=${kind}`);
    } catch {
      // A browser that refuses is a browser that reloads to a fresh start. Fine.
    }
  }, []);

  const upload = useCallback(async (existingCaseId: string | null, file: File, kind: IntakeKey): Promise<void> => {
    setFailure(null);
    setHasResult(false);
    let caseId = existingCaseId;
    let adoptTitle = false;
    const chosen = intakeFor(kind);

    try {
      // 0. A case to put it in, if there is not one yet. Named after the file
      //    for now; the document itself will offer a better name in a moment.
      if (caseId === null) {
        setStep({ kind: 'uploading', caseId: null, stage: 'uploading' });
        const created = await fetch('/api/cases', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ title: titleFromFilename(file.name) }),
        });
        if (!created.ok) {
          setFailure(await readApiError(created, 'We could not start a case for this document.'));
          setStep({ kind: 'choose-file', caseId: null });
          return;
        }
        const json = (await created.json()) as { case: { id: string } };
        caseId = json.case.id;
        adoptTitle = kind === 'BILL';
        rememberCase(caseId, kind);
      }

      // 1. Ask for permission and a place to put it.
      setStep({ kind: 'uploading', caseId, stage: 'uploading' });
      const begin = await fetch('/api/documents', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ caseId, filename: file.name, byteSize: file.size, documentType: chosen.documentType }),
      });
      if (!begin.ok) {
        setFailure(await readApiError(begin, 'We could not start the upload.'));
        setStep({ kind: 'choose-file', caseId });
        return;
      }
      const { documentId, upload: target } = (await begin.json()) as {
        documentId: string;
        upload: { url: string; token: string };
      };

      // 2. Send the bytes straight to storage. The URL is single-use and
      //    bound to one path, so this cannot write anywhere else.
      const put = await fetch(target.url, {
        method: 'PUT',
        headers: { 'content-type': file.type || 'application/octet-stream' },
        body: file,
      });
      if (!put.ok) {
        setFailure({ code: null, message: 'The upload did not finish. Please try again.' });
        setStep({ kind: 'choose-file', caseId });
        return;
      }

      // 3. Have the server inspect what arrived.
      setStep({ kind: 'uploading', caseId, stage: 'checking' });
      const fin = await fetch(`/api/documents/${documentId}/finalize`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      if (!fin.ok) {
        setFailure(await readApiError(fin, 'The file could not be checked.'));
        setStep({ kind: 'choose-file', caseId });
        return;
      }
      const finJson = (await fin.json()) as {
        document: DocumentSummary;
        rejected?: boolean;
        pending?: boolean;
        message?: string;
      };
      if (finJson.rejected === true || finJson.pending === true) {
        setStep({ kind: 'rejected', caseId, message: finJson.message ?? 'The file was not accepted.' });
        return;
      }
      const document: DocumentSummary = { ...finJson.document, documentType: finJson.document.documentType ?? chosen.documentType };

      // 4. Read it.
      setStep({ kind: 'uploading', caseId, stage: 'reading' });
      const ext = await fetch(`/api/documents/${documentId}/extract`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ adoptTitle }),
      });
      if (!ext.ok) {
        // Reading failed but the upload stood. Offer the empty form.
        setFailure(await readApiError(ext, 'We could not read the document. You can enter the figures yourself.'));
        setStep({
          kind: 'review',
          caseId,
          documentId,
          document,
          draft: EMPTY_DRAFT,
          caseTitle: titleFromFilename(file.name),
          intake: kind,
          unread: true,
        });
        return;
      }
      const extJson = (await ext.json()) as { draft: ExtractionDraft; caseTitle?: string | null };
      setStep({
        kind: 'review',
        caseId,
        documentId,
        draft: extJson.draft,
        document,
        caseTitle: extJson.caseTitle ?? titleFromFilename(file.name),
        intake: kind,
        unread: false,
      });
    } catch {
      setFailure(offlineFailure());
      setStep({ kind: 'choose-file', caseId });
    }
  }, [rememberCase]);

  /**
   * A document that is here but was not read: ask for another read. The
   * server refuses while one is already running and says so; that sentence
   * is shown as it is.
   */
  const reread = useCallback(async (): Promise<void> => {
    if (step.kind !== 'review' || step.documentId === null) return;
    setRereading(true);
    setFailure(null);
    try {
      const ext = await fetch(`/api/documents/${step.documentId}/extract`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ adoptTitle: false }),
      });
      if (!ext.ok) {
        setFailure(await readApiError(ext, 'We could not read the document. You can enter the figures yourself.'));
        return;
      }
      const extJson = (await ext.json()) as { draft: ExtractionDraft };
      setStep({ ...step, draft: extJson.draft, unread: false });
    } catch {
      setFailure(offlineFailure());
    } finally {
      setRereading(false);
    }
  }, [step]);

  /**
   * No document: the person would rather type the figures than upload. Same
   * case, same form, same engine, same quota; the case simply has no file on
   * it yet. Before this existed the link went to the public tool, which saves
   * nothing, so a signed-in person lost their result for choosing the keyboard.
   */
  const typeIn = useCallback(async (existingCaseId: string | null, draft: ExtractionDraft = EMPTY_DRAFT): Promise<void> => {
    setFailure(null);
    setHasResult(false);
    let caseId = existingCaseId;
    let caseTitle = cases?.find((c) => c.id === caseId)?.title ?? initialCaseTitle ?? 'Typed-in bill';
    if (caseId === null) {
      setStarting(true);
      try {
        const created = await fetch('/api/cases', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ title: 'Typed-in bill' }),
        });
        if (!created.ok) {
          setFailure(await readApiError(created, 'We could not start a case for this bill.'));
          return;
        }
        const json = (await created.json()) as { case: { id: string; title: string } };
        caseId = json.case.id;
        caseTitle = json.case.title;
        rememberCase(caseId, 'BILL');
      } catch {
        setFailure(offlineFailure());
        return;
      } finally {
        setStarting(false);
      }
    }
    setStep({ kind: 'review', caseId, documentId: null, document: null, draft, caseTitle, intake: 'BILL', unread: false });
  }, [cases, initialCaseTitle, rememberCase]);

  /** The stored figures become the form, in a case of their own. Cleared once the check has run. */
  const keepHandoff = useCallback(async (): Promise<void> => {
    if (handoff === null) return;
    await typeIn(null, handoffToDraft(handoff));
    setHandoff(null);
  }, [handoff, typeIn]);

  const discardHandoff = useCallback((): void => {
    clearHandoff(window.sessionStorage);
    setHandoff(null);
  }, []);

  const chosen = intakeFor(step.kind === 'review' ? step.intake : intake);
  const current: 1 | 2 | 3 = step.kind === 'review' ? (hasResult || step.intake !== 'BILL' ? 3 : 2) : 1;
  const pickedCase = step.kind === 'choose-file' && step.caseId !== null ? cases?.find((c) => c.id === step.caseId) : undefined;
  const caseName = pickedCase?.title ?? initialCaseTitle ?? null;

  return (
    <div className="stack--lg">
      <Stepper current={current} intake={chosen.key} />

      {notice !== null && step.kind === 'choose-file' ? (
        <p className="notice notice--info" role="status">
          {notice}
        </p>
      ) : null}

      {step.kind === 'choose-file' && handoff !== null ? (
        <div className="card stack">
          <div>
            <h2 className="card__title">These are the figures you typed before signing up</h2>
            <p className="muted card__lead">
              {handoff.lines.length} line item{handoff.lines.length === 1 ? '' : 's'}, held in this browser tab. Save
              them to a case and the check runs again here, or discard them and start from the bill.
            </p>
          </div>
          <div className="cluster">
            <button type="button" className="btn btn--primary" onClick={() => void keepHandoff()} disabled={starting} aria-busy={starting}>
              {starting ? 'Starting a case…' : 'Save them to a case'}
            </button>
            <button type="button" className="btn btn--quiet" onClick={discardHandoff} disabled={starting}>
              Discard
            </button>
          </div>
        </div>
      ) : null}

      {step.kind === 'choose-file' ? (
        <div className="stack">
          <div
            className="card stack"
            data-drag={dragging ? 'true' : 'false'}
            onDragOver={(e) => {
              e.preventDefault();
              if (!dragging) setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              const file = e.dataTransfer.files?.[0];
              if (file) void upload(step.caseId, file, intake);
            }}
          >
            <Segmented label="What is it?" options={INTAKE_OPTIONS} value={intake} onChange={setIntake} />
            <div>
              <h2 className="card__title">{chosen.heading}</h2>
              <p className="muted card__lead">
                {chosen.support}{' '}
                {chosen.key === 'BILL' ? 'A PDF from a patient portal works best. A clear photo of a paper bill also works. Nothing is analysed until you have checked the figures.' : null}
                {chosen.key === 'EOB' ? 'A PDF from your insurer’s portal or a clear photo of the paper one.' : null}
              </p>
            </div>
            {/* Two big ways in. The camera is offered where there is one to
                hold; a dropped file follows exactly the same path as a chosen one. */}
            <div className="intake">
              <label className="intake__choice intake__choice--camera">
                <Icon name="camera" />
                <span>
                  Take a photo
                  <small>Lay the page flat, in good light</small>
                </span>
                <input
                  type="file"
                  className="sr-only"
                  accept="image/*"
                  capture="environment"
                  aria-label="Take a photo of the document"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void upload(step.caseId, file, intake);
                  }}
                />
              </label>
              <label className="intake__choice">
                <Icon name="upload" />
                <span>
                  Choose a file
                  <small>PDF, JPG, PNG, HEIC or TIFF</small>
                </span>
                <input
                  ref={fileInput}
                  type="file"
                  className="sr-only"
                  accept={ACCEPT}
                  aria-label="Choose a document to upload"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void upload(step.caseId, file, intake);
                  }}
                />
              </label>
            </div>
            <ApiNotice failure={failure} />
            {chosen.key === 'BILL' ? (
              <p className="small card__last">
                Prefer to type the numbers in?{' '}
                <button
                  type="button"
                  className="btn btn--link"
                  onClick={() => void typeIn(step.caseId)}
                  disabled={starting}
                  aria-busy={starting}
                >
                  {starting ? 'Starting a case…' : 'Enter the figures yourself'}
                </button>{' '}
                — it is saved to {step.caseId !== null ? 'this case' : 'a new case'} just the same.
              </p>
            ) : null}
          </div>

          {step.caseId === null && cases !== null && cases.length > 0 ? (
            <details className="existing">
              <summary>Adding a document to a case you already have?</summary>
              <ul>
                {cases.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      className="btn btn--secondary btn--sm"
                      onClick={() => setStep({ kind: 'choose-file', caseId: c.id })}
                    >
                      {c.title}
                    </button>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
          {step.caseId !== null ? (
            <p className="notice notice--info">
              This document will be added to <strong>{caseName ?? 'the case you picked'}</strong>.{' '}
              {initialCaseId === null ? (
                <button type="button" className="btn btn--link" onClick={() => setStep({ kind: 'choose-file', caseId: null })}>
                  Start a new case instead
                </button>
              ) : (
                <Link href={`/cases/${step.caseId}`}>Open the case</Link>
              )}
            </p>
          ) : null}
        </div>
      ) : null}

      {step.kind === 'uploading' ? (
        <div className="card stack" role="status" aria-live="polite">
          <h2 className="card__title">Bringing your document in</h2>
          <UploadProgress stage={step.stage} />
          <p className="small muted card__last">
            {step.stage === 'reading'
              ? 'Usually a few seconds; a photo can take longer. You will check every figure before anything is analysed.'
              : 'The file goes straight to secure storage and is checked before anything reads it.'}
          </p>
        </div>
      ) : null}

      {step.kind === 'rejected' ? (
        <div className="card status-card" role="alert">
          <div className="icon-tile icon-tile--warning" aria-hidden>
            <Icon name="alert" />
          </div>
          <div className="status-card__body">
            <h2 className="card__title">That file was not accepted</h2>
            <p className="small muted">{step.message}</p>
            <div className="card__actions">
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => setStep({ kind: 'choose-file', caseId: step.caseId })}
              >
                Choose another file
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {step.kind === 'review' && step.intake === 'BILL' ? (
        <div className="stack--lg">
          <div className="card stack">
            <CaseName caseId={step.caseId} initial={step.caseTitle} />
            <div>
              <h2 className="card__title">
                {step.document === null ? 'Enter the figures' : step.unread ? 'We couldn’t read this document' : 'Check these figures'}
              </h2>
              <p className="muted card__lead">
                {step.document === null
                  ? 'Copy the numbers exactly as they are printed on the statement. You do not need every line for the checks to be useful. The result is saved to the case, and you can upload the bill itself later.'
                  : step.unread
                    ? `“${step.document.filename ?? 'Your document'}” is kept on the case, but no figures came out of it. Type them in below, or try reading it again.`
                    : step.draft.lineItems.length > 0
                      ? `We read ${step.draft.lineItems.length} line item${step.draft.lineItems.length === 1 ? '' : 's'} from “${step.document.filename ?? 'your document'}”. Compare every value against the document. Correct anything that is wrong, add anything that is missing, then run the check.`
                      : `We could not read line items from “${step.document.filename ?? 'your document'}”. Compare every value against the document, add anything that is missing, then run the check.`}
              </p>
            </div>
            {step.draft.notes.length > 0 && (
              <ul className="x-list">
                {step.draft.notes.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
            )}
            <ApiNotice failure={failure} tone="warning" />
            {step.unread && step.documentId !== null ? (
              <div className="cluster">
                <button type="button" className="btn btn--secondary" onClick={() => void reread()} disabled={rereading} aria-busy={rereading}>
                  {rereading ? 'Reading…' : 'Try reading it again'}
                </button>
                <button type="button" className="btn btn--link" onClick={() => setStep({ kind: 'choose-file', caseId: step.caseId })}>
                  Upload a clearer copy
                </button>
              </div>
            ) : null}
          </div>

          <BillCheckerTool
            initial={step.draft}
            caseId={step.caseId}
            documentId={step.documentId}
            inApp
            onResult={() => {
              setHasResult(true);
              // Saved to the case: the copy held in this tab has done its job.
              clearHandoff(window.sessionStorage);
            }}
          />

          <div className="actions">
            <Link href={`/cases/${step.caseId}`} className="btn btn--secondary">
              Open the case
              <Icon name="arrow-right" />
            </Link>
            <button
              type="button"
              className="btn btn--quiet"
              onClick={() => {
                setHasResult(false);
                setStep({ kind: 'choose-file', caseId: step.caseId });
              }}
            >
              {step.document === null ? 'Upload the bill to this case' : 'Add another document to this case'}
            </button>
          </div>
        </div>
      ) : null}

      {step.kind === 'review' && step.intake === 'EOB' ? (
        <div className="stack--lg">
          <div className="card stack">
            <CaseName caseId={step.caseId} initial={step.caseTitle} />
            <div>
              <h2 className="card__title">{step.unread ? 'Your EOB is in, but could not be read' : 'Your EOB is in'}</h2>
              <p className="muted card__lead">
                {step.unread
                  ? `“${step.document?.filename ?? 'The document'}” is kept on the case. The comparison can still run: you type the EOB’s figures beside the bill’s.`
                  : `We read ${step.draft.lineItems.length} line item${step.draft.lineItems.length === 1 ? '' : 's'} from “${step.document?.filename ?? 'your EOB'}”. Next, set it against the bill: you confirm both sides, and the check shows where they disagree.`}
              </p>
            </div>
            <ApiNotice failure={failure} tone="warning" />
            {step.unread && step.documentId !== null ? (
              <div className="cluster">
                <button type="button" className="btn btn--secondary" onClick={() => void reread()} disabled={rereading} aria-busy={rereading}>
                  {rereading ? 'Reading…' : 'Try reading it again'}
                </button>
              </div>
            ) : null}
          </div>
          <ActionBar
            secondary={
              <Link href={`/cases/${step.caseId}`} className="btn btn--link">
                Open the case
              </Link>
            }
          >
            <Link href={`/cases/${step.caseId}/compare`} className="btn btn--primary btn--lg">
              Compare with the bill
              <Icon name="arrow-right" />
            </Link>
          </ActionBar>
        </div>
      ) : null}

      {step.kind === 'review' && step.intake === 'OTHER' ? (
        <div className="stack--lg">
          <div className="card stack">
            <CaseName caseId={step.caseId} initial={step.caseTitle} />
            <div>
              <h2 className="card__title">Kept with the case</h2>
              <p className="muted card__lead">
                “{step.document?.filename ?? 'The document'}” is on the case now, for as long as your plan keeps documents.
                Checks run on bills and EOBs; this one is here for the record.
              </p>
            </div>
            <ApiNotice failure={failure} tone="warning" />
          </div>
          <ActionBar
            secondary={
              <button type="button" className="btn btn--link" onClick={() => setStep({ kind: 'choose-file', caseId: step.caseId })}>
                Add another document
              </button>
            }
          >
            <Link href={`/cases/${step.caseId}`} className="btn btn--primary btn--lg">
              Open the case
              <Icon name="arrow-right" />
            </Link>
          </ActionBar>
        </div>
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------------ parts

const STEPS: Record<IntakeKey, readonly string[]> = {
  BILL: ['Upload', 'Confirm figures', 'Results'],
  EOB: ['Upload', 'Compare', 'Results'],
  OTHER: ['Upload', 'Kept'],
};

/** Where the person is in the steps. Said, not implied. */
function Stepper({ current, intake }: { current: 1 | 2 | 3; intake: IntakeKey }): React.ReactElement {
  const labels = STEPS[intake];
  const at = Math.min(current, labels.length);
  return (
    <ol className="stepper" aria-label="Progress">
      {labels.map((label, i) => {
        const n = i + 1;
        const state = n < at ? 'done' : n === at ? 'current' : 'todo';
        return (
          <li
            key={label}
            className={`stepper__step stepper__step--${state}`}
            aria-current={n === at ? 'step' : undefined}
          >
            <span className="stepper__num" aria-hidden>
              {n < at ? '✓' : n}
            </span>
            <span className="stepper__label">
              <span className="sr-only">{state === 'done' ? 'Done: ' : state === 'current' ? 'Current step: ' : ''}</span>
              {label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * The case's name, editable in place. Saved when the field loses focus, and
 * the saving is reported in words, so nobody wonders whether it took.
 */
function CaseName({ caseId, initial }: { caseId: string; initial: string }): React.ReactElement {
  const [title, setTitle] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  const save = useCallback(async (): Promise<void> => {
    const next = title.trim();
    if (next.length === 0 || next === saved) {
      if (next.length === 0) setTitle(saved);
      return;
    }
    setState('saving');
    try {
      const response = await fetch(`/api/cases/${caseId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: next }),
      });
      if (!response.ok) throw new Error('not saved');
      setSaved(next);
      setState('saved');
    } catch {
      setState('error');
    }
  }, [caseId, title, saved]);

  return (
    <div className="case-name">
      <label htmlFor="case-title">Case name</label>
      <input
        id="case-title"
        value={title}
        maxLength={200}
        onChange={(e) => {
          setTitle(e.target.value);
          if (state !== 'idle') setState('idle');
        }}
        onBlur={() => void save()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
      />
      <span className="case-name__status" aria-live="polite">
        {state === 'saving' ? 'Saving…' : state === 'saved' ? 'Saved' : state === 'error' ? 'Not saved. Try again.' : ''}
      </span>
    </div>
  );
}
