'use client';

/**
 * Upload a bill, have it read, review the figures, run the analysis.
 *
 * Three steps, shown as three steps, and the customer is in control of the
 * one that matters: the machine-read draft is shown in the same form they
 * could have filled in by hand, every value editable, and nothing is analysed
 * until they press the button. A misread costs them a correction. It cannot
 * become a finding.
 *
 * The case is created the moment a file is chosen, named after the file, and
 * renamed after the provider on the bill once the document has been read.
 * Nobody is asked to name a bill they have not shown us yet. The name can be
 * changed on the review step, and it is saved as soon as they leave the field.
 *
 * The file goes browser -> storage directly, using a signed URL the server
 * issued for exactly one path. The server never sees the bytes in transit; it
 * reads them back from storage to inspect them.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ExtractionDraft } from '@/domain/documents/draft';
import { BillCheckerTool } from './BillCheckerTool';

interface CaseSummary {
  id: string;
  title: string;
  status: string;
}

interface DocumentSummary {
  id: string;
  filename: string | null;
  scanStatus: string;
  scanDetail: string | null;
  extractionStatus: string;
}

type Step =
  | { kind: 'choose-file'; caseId: string | null }
  | { kind: 'uploading'; caseId: string | null; note: string }
  | { kind: 'rejected'; caseId: string; message: string }
  | { kind: 'reading'; caseId: string }
  | {
      kind: 'review';
      caseId: string;
      documentId: string;
      draft: ExtractionDraft;
      document: DocumentSummary;
      caseTitle: string;
    };

const ACCEPT = '.pdf,.png,.jpg,.jpeg,.heic,.tif,.tiff,application/pdf,image/png,image/jpeg,image/heic,image/tiff';

async function readError(response: Response, fallback: string): Promise<string> {
  try {
    const json = (await response.json()) as { error?: { message?: string } };
    return json.error?.message ?? fallback;
  } catch {
    return fallback;
  }
}

/**
 * A working name from the file name: "mercy_general-march.pdf" becomes
 * "mercy general march". Good enough to find the case again; replaced by the
 * provider's name once the bill has been read, if the reader finds one.
 */
export function titleFromFilename(filename: string): string {
  const stem = filename.replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[_\-\s]+/g, ' ').trim();
  return (stem.length > 0 ? stem : 'Uploaded bill').slice(0, 120);
}

const EMPTY_DRAFT: ExtractionDraft = {
  engine: 'none', engineVersion: '0', currency: null, lineItems: [],
  subtotal: null, total: null, amountDue: null, insurancePaid: null,
  adjustments: null, previousBalance: null, statementDate: null,
  providerName: null, accountReference: null, pageCount: null,
  overallConfidence: 'LOW', notes: [],
};

export function UploadFlow({ initialCaseId = null }: { initialCaseId?: string | null }): React.ReactElement {
  const [step, setStep] = useState<Step>({ kind: 'choose-file', caseId: initialCaseId });
  const [cases, setCases] = useState<CaseSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hasResult, setHasResult] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  // Existing cases, for the person who wants to add a second document to one.
  // Fetched once, only when the case is not already decided.
  useEffect(() => {
    if (initialCaseId !== null) return;
    fetch('/api/cases', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { cases: [] }))
      .then((j: { cases?: CaseSummary[] }) => setCases((j.cases ?? []).filter((c) => c.status === 'OPEN')))
      .catch(() => setCases([]));
  }, [initialCaseId]);

  const upload = useCallback(async (existingCaseId: string | null, file: File): Promise<void> => {
    setError(null);
    setHasResult(false);
    let caseId = existingCaseId;
    let adoptTitle = false;

    try {
      // 0. A case to put it in, if there is not one yet. Named after the file
      //    for now; the document itself will offer a better name in a moment.
      if (caseId === null) {
        setStep({ kind: 'uploading', caseId: null, note: 'Starting a case…' });
        const created = await fetch('/api/cases', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ title: titleFromFilename(file.name) }),
        });
        if (!created.ok) {
          setError(await readError(created, 'We could not start a case for this bill.'));
          setStep({ kind: 'choose-file', caseId: null });
          return;
        }
        const json = (await created.json()) as { case: { id: string } };
        caseId = json.case.id;
        adoptTitle = true;
      }

      // 1. Ask for permission and a place to put it.
      setStep({ kind: 'uploading', caseId, note: 'Preparing…' });
      const begin = await fetch('/api/documents', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ caseId, filename: file.name, byteSize: file.size }),
      });
      if (!begin.ok) {
        setError(await readError(begin, 'We could not start the upload.'));
        setStep({ kind: 'choose-file', caseId });
        return;
      }
      const { documentId, upload: target } = (await begin.json()) as {
        documentId: string;
        upload: { url: string; token: string };
      };

      // 2. Send the bytes straight to storage. The URL is single-use and
      //    bound to one path, so this cannot write anywhere else.
      setStep({ kind: 'uploading', caseId, note: 'Uploading…' });
      const put = await fetch(target.url, {
        method: 'PUT',
        headers: { 'content-type': file.type || 'application/octet-stream' },
        body: file,
      });
      if (!put.ok) {
        setError('The upload did not complete. Please try again.');
        setStep({ kind: 'choose-file', caseId });
        return;
      }

      // 3. Have the server inspect what arrived.
      setStep({ kind: 'uploading', caseId, note: 'Checking the file…' });
      const fin = await fetch(`/api/documents/${documentId}/finalize`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      if (!fin.ok) {
        setError(await readError(fin, 'The file could not be checked.'));
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

      // 4. Read it.
      setStep({ kind: 'reading', caseId });
      const ext = await fetch(`/api/documents/${documentId}/extract`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ adoptTitle }),
      });
      if (!ext.ok) {
        // Reading failed but the upload stood. Offer the empty form.
        setError(await readError(ext, 'We could not read the document. You can enter the figures yourself.'));
        setStep({
          kind: 'review',
          caseId,
          documentId,
          document: finJson.document,
          draft: EMPTY_DRAFT,
          caseTitle: titleFromFilename(file.name),
        });
        return;
      }
      const extJson = (await ext.json()) as { draft: ExtractionDraft; caseTitle?: string | null };
      setStep({
        kind: 'review',
        caseId,
        documentId,
        draft: extJson.draft,
        document: finJson.document,
        caseTitle: extJson.caseTitle ?? titleFromFilename(file.name),
      });
    } catch {
      setError('We could not reach the service. Please check your connection.');
      setStep({ kind: 'choose-file', caseId });
    }
  }, []);

  const current: 1 | 2 | 3 = step.kind === 'review' ? (hasResult ? 3 : 2) : 1;

  return (
    <div className="stack--lg">
      <Stepper current={current} />

      {step.kind === 'choose-file' ? (
        <div className="stack">
          <div className="card stack">
            <h2 className="card__title">Upload the bill</h2>
            <p className="muted card__lead">
              A PDF from a patient portal works best. A clear photo of a paper bill also works.
              Nothing is analysed until you have checked the figures.
            </p>
            <input
              ref={fileInput}
              type="file"
              accept={ACCEPT}
              aria-label="Choose a bill to upload"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void upload(step.caseId, file);
              }}
            />
            {error && <p className="notice notice--error">{error}</p>}
          </div>

          {step.caseId === null && cases !== null && cases.length > 0 ? (
            <details className="existing">
              <summary>Adding a document to a case you already have?</summary>
              <ul>
                {cases.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      className="btn btn--secondary"
                      onClick={() => setStep({ kind: 'choose-file', caseId: c.id })}
                    >
                      {c.title}
                    </button>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
          {step.caseId !== null && initialCaseId === null ? (
            <p className="small muted">
              This document will be added to the case you picked.{' '}
              <button type="button" className="btn btn--quiet" onClick={() => setStep({ kind: 'choose-file', caseId: null })}>
                Start a new case instead
              </button>
            </p>
          ) : null}
        </div>
      ) : null}

      {step.kind === 'uploading' || step.kind === 'reading' ? (
        <Waiting
          note={step.kind === 'uploading' ? step.note : 'Reading the document…'}
          detail={
            step.kind === 'reading'
              ? 'Usually a few seconds; a photo can take longer. You will check every figure before anything is analysed.'
              : 'The file goes straight to secure storage and is checked before anything reads it.'
          }
        />
      ) : null}

      {step.kind === 'rejected' ? (
        <div className="stack">
          <p className="notice notice--error">{step.message}</p>
          <div className="actions">
            <button
              type="button"
              className="btn btn--secondary"
              onClick={() => setStep({ kind: 'choose-file', caseId: step.caseId })}
            >
              Try another file
            </button>
          </div>
        </div>
      ) : null}

      {step.kind === 'review' ? (
        <div className="stack--lg">
          <div className="card stack">
            <CaseName caseId={step.caseId} initial={step.caseTitle} />
            <h2 className="card__title">Check these figures</h2>
            <p className="muted card__lead">
              {step.draft.lineItems.length > 0
                ? `We read ${step.draft.lineItems.length} line item${step.draft.lineItems.length === 1 ? '' : 's'} from “${step.document.filename ?? 'your document'}”. `
                : `We could not read line items from “${step.document.filename ?? 'your document'}”. `}
              Compare every value against the document. Correct anything that is wrong, add
              anything that is missing, then run the check.
            </p>
            {step.draft.notes.length > 0 && (
              <ul className="small muted" style={{ margin: 0, paddingLeft: '1.2rem' }}>
                {step.draft.notes.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
            )}
            {error && <p className="notice notice--error">{error}</p>}
          </div>

          <BillCheckerTool initial={step.draft} caseId={step.caseId} onResult={() => setHasResult(true)} />

          <div className="actions">
            <a href={`/cases/${step.caseId}`} className="btn btn--secondary">
              View this case
            </a>
            <button
              type="button"
              className="btn btn--quiet"
              onClick={() => {
                setHasResult(false);
                setStep({ kind: 'choose-file', caseId: step.caseId });
              }}
            >
              Upload another document to this case
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------------ parts

const STEPS = ['Upload', 'Confirm figures', 'Results'] as const;

/** Where the person is in the three steps. Said, not implied. */
function Stepper({ current }: { current: 1 | 2 | 3 }): React.ReactElement {
  return (
    <ol className="stepper" aria-label="Progress">
      {STEPS.map((label, i) => {
        const n = i + 1;
        const state = n < current ? 'done' : n === current ? 'current' : 'todo';
        return (
          <li
            key={label}
            className={`stepper__step stepper__step--${state}`}
            aria-current={n === current ? 'step' : undefined}
          >
            <span className="stepper__num" aria-hidden>
              {n < current ? '✓' : n}
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

/** Something is happening. Say what, and what comes next. */
function Waiting({ note, detail }: { note: string; detail: string }): React.ReactElement {
  return (
    <div className="wait" role="status" aria-live="polite">
      <div className="progress" aria-hidden>
        <div className="progress__bar" />
      </div>
      <p className="wait__note">{note}</p>
      <p className="small muted card__last">{detail}</p>
    </div>
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
