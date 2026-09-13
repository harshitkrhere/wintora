'use client';

/**
 * A letter, from draft to sent, in three steps the customer can see:
 *
 *   1. Review   read it, change anything
 *   2. Confirm  two explicit statements, then the file
 *   3. Send     where, how, and a record that it went, plus a follow-up
 *
 * Wintora never sends anything. Step 3 makes the customer's own sending as
 * easy as it can be (their mail app opens with the subject and text filled
 * in; the page says where on a statement the address usually is) and then
 * asks them to say that they did it, so the case has the date and the
 * follow-up reminder has something to count from.
 *
 * Editing a confirmed or sent letter returns it to step 1, because a letter
 * that changed after review has not been reviewed.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  FOLLOW_UP_AFTER_DAYS,
  SEND_ROUTES,
  WHERE_TO_SEND,
  followUpDate,
  mailtoLink,
  subjectFor,
  type SendRoute,
} from '@/domain/letters/send';
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

async function readError(response: Response, fallback: string): Promise<string> {
  try {
    const json = (await response.json()) as { error?: { message?: string } };
    return json.error?.message ?? fallback;
  } catch {
    return fallback;
  }
}

function today(): string {
  const d = new Date();
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function day(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { dateStyle: 'long', timeZone: 'UTC' });
}

const STEPS = ['Review', 'Confirm', 'Send'] as const;

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
  const [sentTo, setSentTo] = useState(letter.sentTo);
  const [reviewed, setReviewed] = useState(false);
  const [accurate, setAccurate] = useState(false);
  const [route, setRoute] = useState<SendRoute>('email');
  const [sendTo, setSendTo] = useState('');
  const [sentOn, setSentOn] = useState(today);
  const [reminderSet, setReminderSet] = useState(false);
  const [busy, setBusy] = useState<'save' | 'confirm' | 'delete' | 'copy' | 'sent' | 'remind' | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const dirty = content !== saved;
  const confirmed = status === 'FINALIZED';
  const sent = confirmed && sentAt !== null;
  const current: 1 | 2 | 3 = confirmed ? 3 : 1;
  const subject = useMemo(() => subjectFor(saved, letter.title), [saved, letter.title]);
  const mailto = useMemo(() => mailtoLink({ content: saved, title: letter.title, to: sendTo }), [saved, letter.title, sendTo]);

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
        const json = (await response.json()) as {
          letter: { content: string; status: string; sentAt: string | null; sentVia: string | null; sentTo: string | null };
        };
        setSaved(json.letter.content);
        setContent(json.letter.content);
        setStatus(json.letter.status);
        setSentAt(json.letter.sentAt);
        setSentVia(json.letter.sentVia);
        setSentTo(json.letter.sentTo);
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

  const copy = async (text: string, what: string): Promise<void> => {
    setBusy('copy');
    try {
      await navigator.clipboard.writeText(text);
      setNote(`${what} copied`);
    } catch {
      setError('Your browser did not allow copying. Select the text and copy it instead.');
    } finally {
      setBusy(null);
    }
  };

  const markSent = async (): Promise<void> => {
    setBusy('sent');
    setError(null);
    try {
      const response = await fetch(`/api/letters/${letter.id}/sent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ via: route, sentOn, ...(sendTo.trim().length > 0 ? { to: sendTo.trim() } : {}) }),
      });
      if (!response.ok) {
        setError(await readError(response, 'We could not record that.'));
        return;
      }
      const json = (await response.json()) as { letter: { sentAt: string | null; sentVia: string | null; sentTo: string | null } };
      setSentAt(json.letter.sentAt);
      setSentVia(json.letter.sentVia);
      setSentTo(json.letter.sentTo);
      router.refresh();
    } catch {
      setError('We could not reach the service.');
    } finally {
      setBusy(null);
    }
  };

  const remind = async (): Promise<void> => {
    if (sentAt === null) return;
    setBusy('remind');
    setError(null);
    try {
      // Fourteen days after it was sent; if that has already passed (a letter
      // recorded late), tomorrow morning.
      let due = followUpDate(new Date(sentAt));
      if (Date.parse(`${due}T09:00:00Z`) < Date.now() + 60_000) due = followUpDate(new Date(), 1);
      const response = await fetch(`/api/cases/${letter.caseId}/reminders`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: `Follow up on: ${letter.title}`,
          detail: `No reply yet? The follow-up template refers back to the letter you sent on ${day(sentAt)}.`,
          remindAt: `${due}T09:00:00.000Z`,
        }),
      });
      if (!response.ok) {
        setError(await readError(response, 'We could not set the reminder.'));
        return;
      }
      setReminderSet(true);
      router.refresh();
    } catch {
      setError('We could not reach the service.');
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
      <ol className="stepper" aria-label="Progress">
        {STEPS.map((label, i) => {
          const n = i + 1;
          const done = n < current || (n === 3 && sent);
          const state = done ? 'done' : n === current ? 'current' : 'todo';
          return (
            <li key={label} className={`stepper__step stepper__step--${state}`} aria-current={state === 'current' ? 'step' : undefined}>
              <span className="stepper__num" aria-hidden>
                {done ? '✓' : n}
              </span>
              <span className="stepper__label">{label}</span>
            </li>
          );
        })}
      </ol>

      {/* ------------------------------------------------ 1. the letter */}
      <div className="card stack">
        <div className="card__header">
          <div>
            <h2 className="card__title">{confirmed ? 'Your letter' : '1. Read it, change anything'}</h2>
            <p className="small muted m-0">
              {sent
                ? `Sent ${sentVia === 'portal' ? 'through the patient portal' : `by ${sentVia ?? 'a route you chose'}`} on ${day(sentAt!)}${sentTo ? ` to ${sentTo}` : ''}. Editing it starts a new version.`
                : confirmed
                  ? 'Confirmed as reviewed. Editing it again returns it to a draft.'
                  : 'Names, dates and amounts came from what you entered; check them against the paperwork. Every word is yours to change.'}
            </p>
          </div>
          <span className={`badge ${sent ? 'badge--success' : confirmed ? 'badge--info' : 'badge--neutral'} badge--dot`}>
            {sent ? 'Sent' : confirmed ? 'Ready to send' : 'Draft'}
          </span>
        </div>

        <label htmlFor="letter-body" className="sr-only">
          Letter text
        </label>
        <textarea id="letter-body" className="letter-text" value={content} onChange={(e) => setContent(e.target.value)} spellCheck />

        <div className="letter-actions">
          <button type="button" className="btn btn--secondary" onClick={save} disabled={!dirty || busy !== null} aria-busy={busy === 'save'}>
            {busy === 'save' ? 'Saving…' : dirty ? 'Save changes' : 'Saved'}
          </button>
          <button type="button" className="btn btn--quiet" onClick={() => void copy(content, 'Letter')} disabled={busy !== null}>
            Copy text
          </button>
          <span className="spacer" />
          <span className="small muted" aria-live="polite">
            {note ?? ''}
          </span>
        </div>

        {letter.attachments.length > 0 ? (
          <p className="caption m-0">
            Evidence attached: {letter.attachments.map((a) => a.label).join('; ')}. It appears at the end of the letter and can be
            edited like the rest.
          </p>
        ) : null}

        {error !== null ? (
          <p role="alert" className="notice notice--error">
            {error}
          </p>
        ) : null}
      </div>

      {/* --------------------------------------------------- 2. confirm */}
      {!confirmed ? (
        <section className="card stack" aria-labelledby="confirm-heading">
          <div>
            <h2 id="confirm-heading" className="card__title">
              2. Confirm it
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
            <button type="button" className="btn btn--primary" onClick={confirm} disabled={!reviewed || !accurate || busy !== null} aria-busy={busy === 'confirm'}>
              {busy === 'confirm' ? 'Confirming…' : 'Confirm — then send it'}
            </button>
            <span className="small muted">Next: the file, where to send it, and how.</span>
          </div>
        </section>
      ) : null}

      {/* ------------------------------------------------------ 3. send */}
      {confirmed && !sent ? (
        <section className="card stack" aria-labelledby="send-heading">
          <div>
            <h2 id="send-heading" className="card__title">
              3. Send it yourself
            </h2>
            <p className="small muted m-0">
              Wintora does not send letters. Here is the file, where the billing office&rsquo;s address usually is, and the quickest
              way for each route.
            </p>
          </div>

          <div className="stack--sm">
            <p className="eyebrow eyebrow--quiet m-0">Get the file</p>
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
              <button type="button" className="btn btn--quiet" onClick={() => void copy(content, 'Letter')} disabled={busy !== null}>
                Copy text
              </button>
            </div>
          </div>

          <div className="stack--sm">
            <p className="eyebrow eyebrow--quiet m-0">Send it by</p>
            <div className="segmented" role="group" aria-label="How you will send it">
              {SEND_ROUTES.map((r) => (
                <button
                  key={r.key}
                  type="button"
                  className="segmented__option"
                  aria-pressed={route === r.key}
                  onClick={() => setRoute(r.key)}
                >
                  {r.label}
                </button>
              ))}
            </div>
            <p className="small m-0">{WHERE_TO_SEND[route]}</p>

            {route === 'email' ? (
              <div className="stack--sm">
                <div className="field">
                  <label htmlFor="send-to">Their email address, if the statement gives one</label>
                  <input id="send-to" type="email" value={sendTo} onChange={(e) => setSendTo(e.target.value)} placeholder="billing@…" maxLength={200} />
                </div>
                <div className="letter-actions">
                  <a className="btn btn--primary" href={mailto.href}>
                    <Icon name="mail" />
                    Open in your email app
                  </a>
                  <button type="button" className="btn btn--quiet" onClick={() => void copy(subject, 'Subject')} disabled={busy !== null}>
                    Copy subject line
                  </button>
                </div>
                <p className="caption m-0">
                  Subject: <strong>{subject}</strong>.{' '}
                  {mailto.bodyIncluded
                    ? 'The letter is pasted into the message; attach the PDF too if you want a signed copy on file.'
                    : 'The letter is long for an email body, so attach the PDF and the message says to see it.'}{' '}
                  Nothing is sent until you press Send in your own mail app.
                </p>
              </div>
            ) : (
              <div className="field">
                <label htmlFor="send-to-note">Where you sent it, for your record (optional)</label>
                <input
                  id="send-to-note"
                  value={sendTo}
                  onChange={(e) => setSendTo(e.target.value)}
                  placeholder={route === 'post' ? 'e.g. Billing Office, PO Box 123' : route === 'portal' ? 'e.g. MyChart message' : ''}
                  maxLength={200}
                />
              </div>
            )}
          </div>

          <div className="stack--sm">
            <p className="eyebrow eyebrow--quiet m-0">Then tell the case</p>
            <div className="inline-form">
              <div className="field">
                <label htmlFor="sent-on">Date you sent it</label>
                <input id="sent-on" type="date" value={sentOn} max={today()} onChange={(e) => setSentOn(e.target.value)} />
              </div>
              <div className="cluster">
                <button type="button" className="btn btn--primary" onClick={markSent} disabled={busy !== null} aria-busy={busy === 'sent'}>
                  {busy === 'sent' ? 'Recording…' : 'I have sent it'}
                </button>
              </div>
            </div>
            <p className="caption m-0">This goes on the case timeline so you have the date, and it lets you set a follow-up.</p>
          </div>
        </section>
      ) : null}

      {/* ------------------------------------------------- after sending */}
      {sent ? (
        <section className="card stack" aria-labelledby="after-heading">
          <div>
            <h2 id="after-heading" className="card__title">
              What happens next
            </h2>
            <p className="small muted m-0">
              Billing offices usually reply within two to four weeks, often with a revised statement or a phone call. Keep anything
              they send with this case.
            </p>
          </div>
          <ul className="check-list">
            <li>
              No reply by <strong>{day(followUpDate(new Date(sentAt!)))}</strong>? Send the follow-up letter; it refers back to this
              one by date.
            </li>
            <li>If they reply with a corrected statement, upload it to this case and run the check again.</li>
            <li>If they call, write down who you spoke with and what was agreed; there is a template to confirm it in writing.</li>
          </ul>
          <div className="letter-actions">
            {canRemind ? (
              reminderSet ? (
                <span className="badge badge--success">Reminder set for {day(followUpDate(new Date(sentAt!)))}</span>
              ) : (
                <button type="button" className="btn btn--primary" onClick={remind} disabled={busy !== null} aria-busy={busy === 'remind'}>
                  <Icon name="clock" />
                  {busy === 'remind' ? 'Setting…' : `Remind me in ${FOLLOW_UP_AFTER_DAYS} days`}
                </button>
              )
            ) : null}
            <a className="btn btn--secondary" href={`/cases/${letter.caseId}/letters/new?template=FOLLOW_UP_PREVIOUS_LETTER`}>
              Write the follow-up
            </a>
            <a className="btn btn--quiet" href={`/api/letters/${letter.id}/download?format=pdf`}>
              PDF copy
            </a>
          </div>
        </section>
      ) : null}

      <div className="letter-actions">
        <a className="btn btn--quiet" href={`/cases/${letter.caseId}`}>
          Back to the case
        </a>
        <span className="spacer" />
        <button type="button" className="btn btn--quiet" onClick={remove} disabled={busy !== null}>
          <Icon name="trash" />
          Remove this letter
        </button>
      </div>
    </div>
  );
}
