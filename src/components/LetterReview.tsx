'use client';

/**
 * A letter, in one card with three states.
 *
 *   Draft   read it, change it, tick one box, get the letter
 *   Ready   email it or download it; say when it has gone
 *   Sent    what to expect, and one button for a follow-up reminder
 *
 * Wintora never sends anything. "Email it" opens the customer's own mail
 * app with the subject and the letter filled in; the PDF is theirs to
 * print or attach. "I have sent it" is their own note that it went, so the
 * case has the date.
 *
 * The one box covers both statements the record needs (read it; details
 * are accurate), because asking them separately was two boxes for one
 * thought. Editing a ready or sent letter turns it back into a draft.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FOLLOW_UP_AFTER_DAYS, followUpDate, mailtoLink, type SendRoute } from '@/domain/letters/send';
import { offlineFailure, readApiError, type ApiFailure } from '@/lib/http/client';
import { ActionBar } from './ActionBar';
import { ApiNotice } from './ApiNotice';
import { Icon } from './Icons';

export interface LetterView {
  readonly id: string;
  readonly caseId: string;
  readonly title: string;
  readonly content: string;
  readonly status: string;
  readonly confirmedAt: string | null;
  readonly sentAt: string | null;
  readonly sentVia: string | null;
  readonly sentTo: string | null;
  readonly attachments: readonly { kind: string; id: string; label: string }[];
}

function today(): string {
  const d = new Date();
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function day(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { dateStyle: 'long', timeZone: 'UTC' });
}

const VIA_LABEL: Record<string, string> = {
  email: 'by email',
  post: 'by post',
  portal: 'through the patient portal',
  fax: 'by fax',
  other: '',
};

export function LetterReview({
  letter,
  confirmation,
  canRemind,
}: {
  letter: LetterView;
  confirmation: string;
  /** REMINDERS on this plan. Display only; the API re-checks. */
  canRemind: boolean;
}): React.ReactElement {
  const router = useRouter();
  const [content, setContent] = useState(letter.content);
  const [saved, setSaved] = useState(letter.content);
  const [status, setStatus] = useState(letter.status);
  const [sentAt, setSentAt] = useState(letter.sentAt);
  const [sentVia, setSentVia] = useState(letter.sentVia);
  const [editing, setEditing] = useState(letter.status !== 'FINALIZED');
  const [agreed, setAgreed] = useState(false);
  // Which route was used, from what they clicked last. Recorded, not asked.
  const [route, setRoute] = useState<SendRoute>('other');
  const [reminderSet, setReminderSet] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<ApiFailure | null>(null);

  const dirty = content !== saved;
  const ready = status === 'FINALIZED' && sentAt === null;
  const sent = status === 'FINALIZED' && sentAt !== null;
  const mailto = useMemo(() => mailtoLink({ content: saved, title: letter.title }), [saved, letter.title]);

  useEffect(() => {
    if (note === null) return;
    const t = setTimeout(() => setNote(null), 3000);
    return () => clearTimeout(t);
  }, [note]);

  const call = useCallback(
    async (url: string, method: 'PATCH' | 'POST' | 'DELETE', body: unknown, kind: string): Promise<Record<string, unknown> | null> => {
      setBusy(kind);
      setError(null);
      try {
        const response = await fetch(url, {
          method,
          headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
          body: body !== undefined ? JSON.stringify(body) : undefined,
        });
        if (!response.ok) {
          setError(await readApiError(response, 'That was not saved.'));
          return null;
        }
        router.refresh();
        return (await response.json().catch(() => ({}))) as Record<string, unknown>;
      } catch {
        setError(offlineFailure());
        return null;
      } finally {
        setBusy(null);
      }
    },
    [router],
  );

  const applyLetter = (json: Record<string, unknown> | null): void => {
    const l = json?.letter as { content: string; status: string; sentAt: string | null; sentVia: string | null } | undefined;
    if (l === undefined) return;
    setSaved(l.content);
    setContent(l.content);
    setStatus(l.status);
    setSentAt(l.sentAt);
    setSentVia(l.sentVia);
  };

  const save = async (): Promise<void> => {
    const json = await call(`/api/letters/${letter.id}`, 'PATCH', { content }, 'save');
    if (json !== null) {
      applyLetter(json);
      setNote('Saved');
    }
  };

  const finish = async (): Promise<void> => {
    const body: Record<string, unknown> = { finalize: { reviewed: true, accurateToBestKnowledge: true } };
    if (dirty) body.content = content;
    const json = await call(`/api/letters/${letter.id}`, 'PATCH', body, 'confirm');
    if (json !== null) {
      applyLetter(json);
      setEditing(false);
      setAgreed(false);
    }
  };

  const markSent = async (): Promise<void> => {
    const json = await call(`/api/letters/${letter.id}/sent`, 'POST', { via: route, sentOn: today() }, 'sent');
    if (json !== null) applyLetter(json);
  };

  const remind = async (): Promise<void> => {
    if (sentAt === null) return;
    let due = followUpDate(new Date(sentAt));
    if (Date.parse(`${due}T09:00:00Z`) < Date.now() + 60_000) due = followUpDate(new Date(), 1);
    const json = await call(
      `/api/cases/${letter.caseId}/reminders`,
      'POST',
      { title: `Follow up on: ${letter.title}`, remindAt: `${due}T09:00:00.000Z` },
      'remind',
    );
    if (json !== null) setReminderSet(true);
  };

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(saved);
      setNote('Copied');
    } catch {
      setError({ code: null, message: 'Your browser did not allow copying. Select the text and copy it instead.' });
    }
  };

  const remove = async (): Promise<void> => {
    if (!window.confirm('Remove this letter? This cannot be undone.')) return;
    const json = await call(`/api/letters/${letter.id}`, 'DELETE', undefined, 'delete');
    if (json !== null) router.push(`/cases/${letter.caseId}`);
  };

  return (
    <div className="stack--lg">
      <div className="card stack">
        <div className="card__header">
          <div>
            <h2 className="card__title">{sent ? 'Sent' : ready ? 'Your letter is ready' : 'Your draft'}</h2>
            <p className="small muted m-0">
              {sent
                ? `You sent this ${VIA_LABEL[sentVia ?? 'other'] ?? ''} on ${day(sentAt!)}.`.replace(/\s+/g, ' ')
                : ready
                  ? 'Email it or print it, and send it to the billing office address on your statement.'
                  : 'Check the names, dates and amounts against your paperwork. Change anything you like.'}
            </p>
          </div>
          <span className={`badge ${sent ? 'badge--success' : ready ? 'badge--info' : 'badge--neutral'} badge--dot`}>
            {sent ? 'Sent' : ready ? 'Ready' : 'Draft'}
          </span>
        </div>

        {editing ? (
          <>
            <label htmlFor="letter-body" className="sr-only">
              Letter text
            </label>
            <textarea id="letter-body" className="letter-text" value={content} onChange={(e) => setContent(e.target.value)} spellCheck />
          </>
        ) : (
          <pre className="letter-text">{saved}</pre>
        )}

        {/* ------------------------------------------------------ draft */}
        {editing ? (
          <div className="stack--sm">
            <ul className="confirm-list">
              <li>
                <label>
                  <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
                  <span>I have read the whole letter and the details are correct.</span>
                </label>
              </li>
            </ul>
            <p className="small muted m-0" aria-live="polite">
              {note ?? ''}
            </p>
            <p className="small m-0">{confirmation}</p>
          </div>
        ) : null}

        {/* ------------------------------------------------------ ready */}
        {ready && !editing ? (
          <div className="stack--sm">
            <div className="letter-actions">
              <button type="button" className="btn btn--quiet" onClick={copy}>
                Copy text
              </button>
              <button type="button" className="btn btn--quiet" onClick={() => setEditing(true)}>
                Edit
              </button>
              <span className="spacer" />
              <span className="small muted" aria-live="polite">
                {note ?? ''}
              </span>
            </div>
            <p className="small m-0">
              &ldquo;Email it&rdquo; opens your own mail app with the letter filled in; you add their address and press send.
              The billing address is usually near the top of the statement or on the payment stub.
              {mailto.bodyIncluded ? '' : ' This letter is long, so attach the PDF to the email.'}
            </p>
            <div className="letter-actions">
              <button type="button" className="btn btn--secondary" onClick={markSent} disabled={busy !== null} aria-busy={busy === 'sent'}>
                <Icon name="check" />
                {busy === 'sent' ? 'Saving…' : 'I have sent it'}
              </button>
              <span className="small muted">Puts today&rsquo;s date on the case, so you know when to follow up.</span>
            </div>
          </div>
        ) : null}

        {/* ------------------------------------------------------- sent */}
        {sent && !editing ? (
          <div className="stack--sm">
            <p className="small m-0">
              Most billing offices reply within two to four weeks. If nothing has arrived by{' '}
              <strong>{day(followUpDate(new Date(sentAt!)))}</strong>, send the follow-up; it refers back to this letter by date.
            </p>
            <div className="letter-actions">
              {canRemind && reminderSet ? <span className="badge badge--success">Reminder set</span> : null}
              <a className="btn btn--quiet" href={`/api/letters/${letter.id}/download?format=pdf`}>
                PDF
              </a>
              <button type="button" className="btn btn--quiet" onClick={() => setEditing(true)}>
                Edit
              </button>
            </div>
          </div>
        ) : null}

        {letter.attachments.length > 0 ? (
          <p className="small muted m-0">Evidence attached: {letter.attachments.map((a) => a.label).join('; ')}.</p>
        ) : null}

        <ApiNotice failure={error} />
      </div>

      <div className="letter-actions">
        <a className="btn btn--quiet" href={`/cases/${letter.caseId}`}>
          Back to the case
        </a>
        <span className="spacer" />
        <button type="button" className="btn btn--quiet" onClick={remove} disabled={busy !== null}>
          <Icon name="trash" />
          Remove
        </button>
      </div>

      {/* The one action for this state, under the thumb; its quieter twin beside it. */}
      {editing ? (
        <ActionBar
          secondary={
            <button type="button" className="btn btn--link" onClick={save} disabled={!dirty || busy !== null}>
              {busy === 'save' ? 'Saving…' : 'Save for later'}
            </button>
          }
        >
          <button type="button" className="btn btn--primary btn--lg" onClick={finish} disabled={!agreed || busy !== null} aria-busy={busy === 'confirm'}>
            {busy === 'confirm' ? 'One moment…' : 'Get my letter'}
          </button>
        </ActionBar>
      ) : ready ? (
        <ActionBar
          secondary={
            <a className="btn btn--link" href={`/api/letters/${letter.id}/download?format=pdf`} onClick={() => setRoute('post')}>
              Download PDF
            </a>
          }
        >
          <a className="btn btn--primary btn--lg" href={mailto.href} onClick={() => setRoute('email')}>
            <Icon name="mail" />
            Email it
          </a>
        </ActionBar>
      ) : sent ? (
        <ActionBar
          secondary={
            canRemind && !reminderSet ? (
              <a className="btn btn--link" href={`/cases/${letter.caseId}/letters/new?template=FOLLOW_UP_PREVIOUS_LETTER`}>
                Write the follow-up
              </a>
            ) : undefined
          }
        >
          {canRemind && !reminderSet ? (
            <button type="button" className="btn btn--primary btn--lg" onClick={remind} disabled={busy !== null} aria-busy={busy === 'remind'}>
              <Icon name="clock" />
              {busy === 'remind' ? 'Setting…' : `Remind me in ${FOLLOW_UP_AFTER_DAYS} days`}
            </button>
          ) : (
            <a className="btn btn--primary btn--lg" href={`/cases/${letter.caseId}/letters/new?template=FOLLOW_UP_PREVIOUS_LETTER`}>
              Write the follow-up
            </a>
          )}
        </ActionBar>
      ) : null}
    </div>
  );
}
