'use client';

/**
 * Upload a bill, have it read, review the figures, run the analysis.
 *
 * Four steps, and the customer is in control of the one that matters: the
 * machine-read draft is shown in the same form they could have filled in by
 * hand, every value editable, and nothing is analysed until they press the
 * button. A misread costs them a correction. It cannot become a finding.
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
  | { kind: 'choose-case' }
  | { kind: 'choose-file'; caseId: string }
  | { kind: 'uploading'; caseId: string; note: string }
  | { kind: 'rejected'; caseId: string; message: string }
  | { kind: 'reading'; caseId: string; documentId: string }
  | { kind: 'review'; caseId: string; documentId: string; draft: ExtractionDraft; document: DocumentSummary };

const ACCEPT = '.pdf,.png,.jpg,.jpeg,.heic,.tif,.tiff,application/pdf,image/png,image/jpeg,image/heic,image/tiff';

async function readError(response: Response, fallback: string): Promise<string> {
  try {
    const json = (await response.json()) as { error?: { message?: string } };
    return json.error?.message ?? fallback;
  } catch {
    return fallback;
  }
}

export function UploadFlow({ initialCaseId = null }: { initialCaseId?: string | null }): React.ReactElement {
  const [step, setStep] = useState<Step>(
    initialCaseId ? { kind: 'choose-file', caseId: initialCaseId } : { kind: 'choose-case' },
  );
  const [cases, setCases] = useState<CaseSummary[] | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (step.kind !== 'choose-case') return;
    fetch('/api/cases', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { cases: [] }))
      .then((j: { cases?: CaseSummary[] }) => setCases(j.cases ?? []))
      .catch(() => setCases([]));
  }, [step.kind]);

  const createCase = useCallback(async (): Promise<void> => {
    const title = newTitle.trim();
    if (title.length === 0) {
      setError('Give this bill a short name, like the provider or the date.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/cases', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title }),
      });
      if (!response.ok) {
        setError(await readError(response, 'We could not create that case.'));
        return;
      }
      const json = (await response.json()) as { case: { id: string } };
      setStep({ kind: 'choose-file', caseId: json.case.id });
    } catch {
      setError('We could not reach the service. Please check your connection.');
    } finally {
      setBusy(false);
    }
  }, [newTitle]);

  const upload = useCallback(
    async (caseId: string, file: File): Promise<void> => {
      setError(null);
      setStep({ kind: 'uploading', caseId, note: 'Preparing…' });

      try {
        // 1. Ask for permission and a place to put it.
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
        setStep({ kind: 'reading', caseId, documentId });
        const ext = await fetch(`/api/documents/${documentId}/extract`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{}',
        });
        if (!ext.ok) {
          // Reading failed but the upload stood. Offer the empty form.
          setError(await readError(ext, 'We could not read the document. You can enter the figures yourself.'));
          setStep({
            kind: 'review',
            caseId,
            documentId,
            document: finJson.document,
            draft: {
              engine: 'none', engineVersion: '0', currency: null, lineItems: [],
              subtotal: null, total: null, amountDue: null, insurancePaid: null,
              adjustments: null, previousBalance: null, statementDate: null,
              providerName: null, accountReference: null, pageCount: null,
              overallConfidence: 'LOW', notes: [],
            },
          });
          return;
        }
        const { draft } = (await ext.json()) as { draft: ExtractionDraft };
        setStep({ kind: 'review', caseId, documentId, draft, document: finJson.document });
      } catch {
        setError('We could not reach the service. Please check your connection.');
        setStep({ kind: 'choose-file', caseId });
      }
    },
    [],
  );

  // ------------------------------------------------------------------ views

  if (step.kind === 'choose-case') {
    return (
      <div className="stack">
        <h2 style={{ fontSize: '1.1rem' }}>Which bill is this for?</h2>
        {cases === null ? (
          <p className="muted">Loading your cases…</p>
        ) : cases.length > 0 ? (
          <ul className="stack" style={{ listStyle: 'none', padding: 0 }}>
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
        ) : null}
        <div className="card stack">
          <label htmlFor="new-case-title">
            {cases !== null && cases.length > 0 ? 'Or start a new one' : 'Start a case'}
          </label>
          <input
            id="new-case-title"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="e.g. Mercy General, March visit"
            maxLength={120}
          />
          <button type="button" className="btn btn--primary" onClick={createCase} disabled={busy}>
            {busy ? 'Creating…' : 'Create and continue'}
          </button>
        </div>
        {error && <p className="notice notice--error">{error}</p>}
      </div>
    );
  }

  if (step.kind === 'choose-file') {
    return (
      <div className="stack">
        <h2 style={{ fontSize: '1.1rem' }}>Upload the bill</h2>
        <p className="muted">
          A PDF from a patient portal works best. A clear photo of a paper bill also works.
          Nothing is analysed until you have checked the figures.
        </p>
        <input
          ref={fileInput}
          type="file"
          accept={ACCEPT}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void upload(step.caseId, file);
          }}
        />
        {error && <p className="notice notice--error">{error}</p>}
      </div>
    );
  }

  if (step.kind === 'uploading' || step.kind === 'reading') {
    return (
      <div className="stack">
        <p aria-live="polite">
          {step.kind === 'uploading' ? step.note : 'Reading the document…'}
        </p>
        <p className="muted small">
          {step.kind === 'reading'
            ? 'This usually takes a few seconds. A photo can take longer.'
            : 'The file goes straight to secure storage and is checked before anything reads it.'}
        </p>
      </div>
    );
  }

  if (step.kind === 'rejected') {
    return (
      <div className="stack">
        <p className="notice notice--error">{step.message}</p>
        <button
          type="button"
          className="btn btn--secondary"
          onClick={() => setStep({ kind: 'choose-file', caseId: step.caseId })}
        >
          Try another file
        </button>
      </div>
    );
  }

  // review
  return (
    <div className="stack--lg">
      <div className="card stack">
        <h2 style={{ marginTop: 0, fontSize: '1.1rem' }}>Check these figures</h2>
        <p className="muted" style={{ margin: 0 }}>
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

      <BillCheckerTool initial={step.draft} caseId={step.caseId} />

      <p className="small muted" style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <a href={`/cases/${step.caseId}`} className="btn btn--secondary">
          View this case
        </a>
        <button
          type="button"
          className="btn btn--quiet"
          onClick={() => setStep({ kind: 'choose-file', caseId: step.caseId })}
        >
          Upload another document to this case
        </button>
      </p>
    </div>
  );
}
