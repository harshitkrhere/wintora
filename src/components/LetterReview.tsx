'use client';

/**
 * Review a letter: read it, change it, confirm it, take it away.
 *
 * The text is a textarea, because every word is the customer's to change.
 * Confirming needs two statements ticked, one at a time. Once confirmed the
 * letter reads back as plain text with the download links; editing it again
 * returns it to a draft, because a letter that changed after review has not
 * been reviewed.
 *
 * Nothing on this page sends anything. "Copy" puts the text on the clipboard
 * for an email the customer writes; the downloads are files they attach.
 */

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from './Icons';

export interface LetterView {
  readonly id: string;
  readonly caseId: string;
  readonly title: string;
  readonly content: string;
  readonly status: string;
  readonly confirmedAt: string | null;
  readonly attachments: readonly { kind: string; id: string; label: string }[];
}

async function readError(response: Response, fallback: string): Promise<string> {
  try {
    const json = (await response.json()) as { error?: { message?: string } };
    return json.error?.message ?? fallback;
  } catch {
    return fallback;
  }
}

export function LetterReview({ letter, confirmation }: { letter: LetterView; confirmation: string }): React.ReactElement {
  const router = useRouter();
  const [content, setContent] = useState(letter.content);
  const [saved, setSaved] = useState(letter.content);
  const [status, setStatus] = useState(letter.status);
  const [reviewed, setReviewed] = useState(false);
  const [accurate, setAccurate] = useState(false);
  const [busy, setBusy] = useState<'save' | 'confirm' | 'delete' | 'copy' | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const dirty = content !== saved;
  const confirmed = status === 'FINALIZED';

  useEffect(() => {
    if (note === null) return;
    const t = setTimeout(() => setNote(null), 3000);
    return () => clearTimeout(t);
  }, [note]);

  const patch = useCallback(
    async (body: Record<string, unknown>, kind: 'save' | 'confirm'): Promise<boolean> => {
      setBusy(kind);
      setError(null);
      try {
        const response = await fetch(`/api/letters/${letter.id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!response.ok) {
          setError(await readError(response, 'We could not save that.'));
          return false;
        }
        const json = (await response.json()) as { letter: { content: string; status: string } };
        setSaved(json.letter.content);
        setContent(json.letter.content);
        setStatus(json.letter.status);
        router.refresh();
        return true;
      } catch {
        setError('We could not reach the service. Please check your connection.');
        return false;
      } finally {
        setBusy(null);
      }
    },
    [letter.id, router],
  );

  const save = async (): Promise<void> => {
    if (await patch({ content }, 'save')) setNote('Saved');
  };

  const confirm = async (): Promise<void> => {
    const body: Record<string, unknown> = { finalize: { reviewed, accurateToBestKnowledge: accurate } };
    if (dirty) body.content = content;
    if (await patch(body, 'confirm')) {
      setNote('Confirmed');
      setReviewed(false);
      setAccurate(false);
    }
  };

  const copy = async (): Promise<void> => {
    setBusy('copy');
    try {
      await navigator.clipboard.writeText(content);
      setNote('Copied');
    } catch {
      setError('Your browser did not allow copying. Select the text and copy it instead.');
    } finally {
      setBusy(null);
    }
  };

  const remove = async (): Promise<void> => {
    if (!window.confirm('Remove this letter? This cannot be undone.')) return;
    setBusy('delete');
    setError(null);
    try {
      const response = await fetch(`/api/letters/${letter.id}`, { method: 'DELETE' });
      if (!response.ok) {
        setError(await readError(response, 'We could not remove the letter.'));
        return;
      }
      router.push(`/cases/${letter.caseId}`);
      router.refresh();
    } catch {
      setError('We could not reach the service.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="stack--lg">
      <div className="card stack">
        <div className="card__header">
          <div>
            <h2 className="card__title">{confirmed ? 'Your letter' : 'Your draft'}</h2>
            <p className="small muted m-0">
              {confirmed
                ? 'Confirmed as reviewed. Editing it again returns it to a draft.'
                : 'Change anything. Names, dates and amounts came from what you entered; check them against the paperwork.'}
            </p>
          </div>
          <span className={`badge ${confirmed ? 'badge--success' : 'badge--neutral'} badge--dot`}>
            {confirmed ? 'Reviewed' : 'Draft'}
          </span>
        </div>

        <label htmlFor="letter-body" className="sr-only">
          Letter text
        </label>
        <textarea
          id="letter-body"
          className="letter-text"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          spellCheck
        />

        <div className="letter-actions">
          <button type="button" className="btn btn--secondary" onClick={save} disabled={!dirty || busy !== null} aria-busy={busy === 'save'}>
            {busy === 'save' ? 'Saving…' : dirty ? 'Save changes' : 'Saved'}
          </button>
          <button type="button" className="btn btn--quiet" onClick={copy} disabled={busy !== null}>
            Copy text
          </button>
          <span className="spacer" />
          <span className="small muted" aria-live="polite">
            {note ?? ''}
          </span>
        </div>

        {letter.attachments.length > 0 ? (
          <p className="caption m-0">
            Evidence attached: {letter.attachments.map((a) => a.label).join('; ')}. It appears at the
            end of the letter and can be edited like the rest.
          </p>
        ) : null}

        {error !== null ? (
          <p role="alert" className="notice notice--error">
            {error}
          </p>
        ) : null}
      </div>

      {!confirmed ? (
        <section className="card stack" aria-labelledby="confirm-heading">
          <div>
            <h2 id="confirm-heading" className="card__title">
              Before you send it
            </h2>
            <p className="small muted m-0">{confirmation}</p>
          </div>
          <ul className="confirm-list">
            <li>
              <label>
                <input type="checkbox" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} />
                <span>I have read the whole letter.</span>
              </label>
            </li>
            <li>
              <label>
                <input type="checkbox" checked={accurate} onChange={(e) => setAccurate(e.target.checked)} />
                <span>The details in it are accurate to the best of my knowledge.</span>
              </label>
            </li>
          </ul>
          <div className="form-actions">
            <button
              type="button"
              className="btn btn--primary"
              onClick={confirm}
              disabled={!reviewed || !accurate || busy !== null}
              aria-busy={busy === 'confirm'}
            >
              {busy === 'confirm' ? 'Confirming…' : 'Confirm and get the file'}
            </button>
            <span className="small muted">Confirming records the date on the case timeline.</span>
          </div>
        </section>
      ) : (
        <section className="card stack" aria-labelledby="take-heading">
          <div>
            <h2 id="take-heading" className="card__title">
              Take it with you
            </h2>
            <p className="small muted m-0">
              Print it, attach it to an email, or paste the text. Wintora does not send it.
            </p>
          </div>
          <div className="letter-actions">
            <a className="btn btn--primary" href={`/api/letters/${letter.id}/download?format=pdf`}>
              <Icon name="document" />
              PDF
            </a>
            <a className="btn btn--secondary" href={`/api/letters/${letter.id}/download?format=docx`}>
              Word
            </a>
            <a className="btn btn--secondary" href={`/api/letters/${letter.id}/download?format=txt`}>
              Plain text
            </a>
          </div>
        </section>
      )}

      <div className="letter-actions">
        <button type="button" className="btn btn--quiet" onClick={remove} disabled={busy !== null}>
          <Icon name="trash" />
          Remove this letter
        </button>
      </div>
    </div>
  );
}
