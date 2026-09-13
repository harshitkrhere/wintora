'use client';

/**
 * Export the whole case as a bundle.
 *
 * One click builds a ZIP (summary, every letter, the timeline, the uploads)
 * and returns a link that expires. The link opens in the browser's download;
 * Wintora emails nothing and keeps the bundle only as long as the link lives.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from './Icons';

interface Built {
  id: string;
  url: string;
  expiresAt: string;
  byteSize: number;
  fileCount: number;
  omitted: string[];
}

function bytes(n: number): string {
  return n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
}

export function ExportCase({
  caseId,
  enabled,
  remaining,
  hasDocuments,
}: {
  caseId: string;
  enabled: boolean;
  remaining: number | null;
  hasDocuments: boolean;
}): React.ReactElement {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [format, setFormat] = useState<'pdf' | 'docx'>('pdf');
  const [includeDocuments, setIncludeDocuments] = useState(true);
  const [busy, setBusy] = useState(false);
  const [built, setBuilt] = useState<Built | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Fixed per opened panel: a second click while waiting is the same export.
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID().replace(/-/g, ''));

  const build = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/cases/${caseId}/export`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ format, includeDocuments, idempotencyKey }),
      });
      const json = (await response.json()) as { export: Built } | { error: { message: string } };
      if (!response.ok || !('export' in json)) {
        setError('error' in json ? json.error.message : 'We could not build the bundle.');
        return;
      }
      setBuilt(json.export);
      setIdempotencyKey(crypto.randomUUID().replace(/-/g, ''));
      router.refresh();
    } catch {
      setError('We could not reach the service. Please check your connection.');
    } finally {
      setBusy(false);
    }
  };

  if (!enabled) {
    return (
      <p className="caption m-0">
        Exporting the whole case as a bundle is part of the Plus and Pro plans.{' '}
        <a href="/pricing">See plans</a>
      </p>
    );
  }

  if (!open) {
    return (
      <div className="cluster">
        <button type="button" className="btn btn--secondary btn--sm" onClick={() => setOpen(true)}>
          <Icon name="external" />
          Export this case
        </button>
        {remaining !== null ? <span className="caption">{remaining} left this period</span> : null}
      </div>
    );
  }

  return (
    <div className="card card--soft stack">
      <div>
        <h3 className="card__title card__title--small">Export this case</h3>
        <p className="small muted m-0">
          A folder you can keep or hand on: the summary with every finding and its figures, each
          letter as its own file, the timeline{hasDocuments ? ', and your uploads' : ''}.
        </p>
      </div>

      <div className="field-row">
        <div className="field">
          <label htmlFor="export-format">Documents as</label>
          <select id="export-format" value={format} onChange={(e) => setFormat(e.target.value === 'docx' ? 'docx' : 'pdf')}>
            <option value="pdf">PDF</option>
            <option value="docx">Word (.docx)</option>
          </select>
        </div>
        {hasDocuments ? (
          <ul className="confirm-list">
            <li>
              <label>
                <input
                  type="checkbox"
                  checked={includeDocuments}
                  onChange={(e) => setIncludeDocuments(e.target.checked)}
                />
                <span>Include the uploaded files</span>
              </label>
            </li>
          </ul>
        ) : null}
      </div>

      <div className="cluster">
        <button type="button" className="btn btn--primary" onClick={build} disabled={busy || remaining === 0} aria-busy={busy}>
          {busy ? 'Building…' : 'Build the bundle'}
        </button>
        <button type="button" className="btn btn--quiet" onClick={() => setOpen(false)}>
          Close
        </button>
        {remaining === 0 ? <span className="caption">No exports left this period.</span> : null}
      </div>

      {built !== null ? (
        <div className="notice notice--success stack--sm">
          <p className="m-0">
            <a href={built.url} className="btn btn--primary btn--sm">
              Download the bundle ({bytes(built.byteSize)}, {built.fileCount} files)
            </a>
          </p>
          <p className="small m-0">
            The link works until{' '}
            {new Date(built.expiresAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}; after
            that the bundle is removed from our storage.
          </p>
          {built.omitted.length > 0 ? (
            <ul className="x-list small m-0">
              {built.omitted.map((o) => (
                <li key={o}>Not included: {o}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {error !== null ? (
        <p role="alert" className="notice notice--error">
          {error}
        </p>
      ) : null}
    </div>
  );
}
