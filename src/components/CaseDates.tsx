'use client';

/**
 * The dates on a case: reminders and deadlines, in one list, kept distinct.
 *
 * A reminder is the customer's note to their future self, sent to them by
 * email when a provider is configured. A deadline is a date that matters to
 * the case; it is shown as "verified" only when it cites a reviewed source,
 * and everything the customer types here is labelled as theirs. Neither is
 * ever invented from a document.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { CaseDeadline, CaseReminder } from '@/lib/cases/load';
import { offlineFailure, readApiError, type ApiFailure } from '@/lib/http/client';
import { ApiNotice } from './ApiNotice';
import { Icon } from './Icons';

function dayLabel(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function whenLabel(iso: string): string {
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/** Local "YYYY-MM-DDTHH:MM" for a datetime-local input, a week from now at 9am. */
function defaultRemindAt(): string {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  d.setHours(9, 0, 0, 0);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function CaseDates({
  caseId,
  reminders,
  deadlines,
  can,
  emailOn,
}: {
  caseId: string;
  reminders: readonly CaseReminder[];
  deadlines: readonly CaseDeadline[];
  can: { reminders: boolean; deadlines: boolean };
  /** Whether a reminder will also arrive by email. Said plainly either way. */
  emailOn: boolean;
}): React.ReactElement {
  const router = useRouter();
  const [adding, setAdding] = useState<'reminder' | 'deadline' | null>(null);
  const [title, setTitle] = useState('');
  const [when, setWhen] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<ApiFailure | null>(null);

  const now = Date.now();
  const today = new Date().toISOString().slice(0, 10);

  const call = async (url: string, method: string, body?: unknown): Promise<boolean> => {
    setError(null);
    try {
      const response = await fetch(url, {
        method,
        headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      if (!response.ok) {
        setError(await readApiError(response, 'That was not saved.'));
        return false;
      }
      router.refresh();
      return true;
    } catch {
      setError(offlineFailure());
      return false;
    }
  };

  const add = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    if (adding === null) return;
    setBusy('add');
    const ok =
      adding === 'reminder'
        ? await call(`/api/cases/${caseId}/reminders`, 'POST', {
            title: title.trim(),
            remindAt: new Date(when).toISOString(),
          })
        : await call(`/api/cases/${caseId}/deadlines`, 'POST', { label: title.trim(), dueDate: when });
    setBusy(null);
    if (ok) {
      setAdding(null);
      setTitle('');
      setWhen('');
    }
  };

  const toggle = async (kind: 'reminder' | 'deadline', id: string, done: boolean): Promise<void> => {
    setBusy(id);
    await call(`/api/${kind}s/${id}`, 'PATCH', { done });
    setBusy(null);
  };

  const remove = async (kind: 'reminder' | 'deadline', id: string): Promise<void> => {
    if (!window.confirm('Remove this date?')) return;
    setBusy(id);
    await call(`/api/${kind}s/${id}`, 'DELETE');
    setBusy(null);
  };

  const rows = [
    ...deadlines.map((d) => ({
      kind: 'deadline' as const,
      id: d.id,
      label: d.label,
      sub: d.verified ? 'Verified date' : 'Entered by you',
      verified: d.verified,
      when: dayLabel(d.dueDate),
      overdue: d.completedAt === null && d.dueDate < today,
      done: d.completedAt !== null,
      sort: Date.parse(`${d.dueDate}T00:00:00`),
      notes: d.notes,
    })),
    ...reminders.map((r) => ({
      kind: 'reminder' as const,
      id: r.id,
      label: r.title,
      sub: r.notifiedAt !== null ? 'Reminder · sent' : 'Reminder',
      verified: false,
      when: whenLabel(r.remindAt),
      overdue: r.completedAt === null && Date.parse(r.remindAt) <= now,
      done: r.completedAt !== null,
      sort: Date.parse(r.remindAt),
      notes: r.detail,
    })),
  ].sort((a, b) => Number(a.done) - Number(b.done) || a.sort - b.sort);

  return (
    <div className="stack">
      {rows.length === 0 ? (
        <p className="caption m-0">
          No dates yet. A reminder is a note to yourself; a date is something the case is waiting
          on. Nothing here is guessed from your documents.
        </p>
      ) : (
        <ul className="dates">
          {rows.map((row) => (
            <li key={row.id} className={`dates__row${row.done ? ' dates__row--done' : ''}`}>
              <input
                type="checkbox"
                checked={row.done}
                disabled={busy === row.id}
                aria-label={`Mark ${row.label} ${row.done ? 'not done' : 'done'}`}
                onChange={() => void toggle(row.kind, row.id, !row.done)}
              />
              <span className="dates__label">
                <span>{row.label}</span>
                <span className="dates__sub">
                  {row.verified ? (
                    <span className="badge badge--success">Verified</span>
                  ) : (
                    row.sub
                  )}
                  {row.notes ? ` · ${row.notes}` : ''}
                </span>
              </span>
              <span className="dates__actions">
                <span className={`dates__when${row.overdue ? ' dates__when--overdue' : ''}`}>
                  {row.overdue ? 'Overdue · ' : ''}
                  {row.when}
                </span>
                {!row.verified ? (
                  <button
                    type="button"
                    className="btn btn--quiet btn--icon"
                    aria-label={`Remove ${row.label}`}
                    disabled={busy === row.id}
                    onClick={() => void remove(row.kind, row.id)}
                  >
                    <Icon name="close" />
                  </button>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      )}

      {adding !== null ? (
        <form onSubmit={add} className="inline-form">
          <div className="field">
            <label htmlFor="date-title">{adding === 'reminder' ? 'Remind me to' : 'What is due'}</label>
            <input
              id="date-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
              required
              placeholder={adding === 'reminder' ? 'e.g. Call the billing office if no reply' : 'e.g. Reply to the letter by'}
            />
          </div>
          <div className="field">
            <label htmlFor="date-when">{adding === 'reminder' ? 'When' : 'Date'}</label>
            <input
              id="date-when"
              type={adding === 'reminder' ? 'datetime-local' : 'date'}
              value={when}
              onChange={(e) => setWhen(e.target.value)}
              min={adding === 'reminder' ? undefined : today}
              required
            />
          </div>
          <div className="cluster">
            <button type="submit" className="btn btn--primary" disabled={busy === 'add'} aria-busy={busy === 'add'}>
              {busy === 'add' ? 'Saving…' : 'Save'}
            </button>
            <button type="button" className="btn btn--quiet" onClick={() => setAdding(null)}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <div className="cluster">
          {can.reminders ? (
            <button
              type="button"
              className="btn btn--secondary btn--sm"
              onClick={() => {
                setAdding('reminder');
                setWhen(defaultRemindAt());
              }}
            >
              <Icon name="clock" />
              Set a reminder
            </button>
          ) : null}
          {can.deadlines ? (
            <button
              type="button"
              className="btn btn--secondary btn--sm"
              onClick={() => {
                setAdding('deadline');
                setWhen('');
              }}
            >
              <Icon name="calendar" />
              Add a date
            </button>
          ) : null}
          {!can.reminders && !can.deadlines ? (
            <span className="caption">
              Reminders and date tracking are part of the paid plans. <a href="/pricing">See plans</a>
            </span>
          ) : null}
        </div>
      )}

      <ApiNotice failure={error} />

      <p className="small muted m-0">
        {emailOn
          ? 'Reminders are emailed to you on the day, with a link to the case and nothing from it. '
          : 'Reminders show here and on your home page. '}
        Dates you enter are marked as yours; a verified date always cites its source.
      </p>
    </div>
  );
}
