'use client';

/**
 * Who this bill is for.
 *
 * A household (Pro) tracks bills for more than one person on one account.
 * The person is a label the customer chooses; the account holder is "me" by
 * default and costs nothing. A new name is checked against the plan's limit
 * on the server, and the message that comes back names the limit.
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from './Icons';

interface Member {
  readonly label: string;
  readonly relationship: string | null;
  readonly caseCount: number;
}

const NEW = '__new__';
const NONE = '';

export function CaseMember({
  caseId,
  current,
  enabled,
}: {
  caseId: string;
  current: { label: string; relationship: string | null } | null;
  /** HOUSEHOLD_CASES on this plan. Display only; the server re-checks. */
  enabled: boolean;
}): React.ReactElement | null {
  const router = useRouter();
  const [members, setMembers] = useState<Member[] | null>(null);
  const [limit, setLimit] = useState<number | null>(null);
  const [editing, setEditing] = useState(false);
  const [choice, setChoice] = useState<string>(current?.label ?? NONE);
  const [newName, setNewName] = useState('');
  const [relationship, setRelationship] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!editing || members !== null) return;
    fetch('/api/household', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { members: Member[]; limit: number | null } | null) => {
        setMembers(j?.members ?? []);
        setLimit(j?.limit ?? null);
      })
      .catch(() => setMembers([]));
  }, [editing, members]);

  if (!enabled && current === null) return null;

  const save = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const response =
        choice === NONE
          ? await fetch(`/api/cases/${caseId}/member`, { method: 'DELETE' })
          : await fetch(`/api/cases/${caseId}/member`, {
              method: 'PUT',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                label: choice === NEW ? newName.trim() : choice,
                ...(relationship.trim().length > 0 ? { relationship: relationship.trim() } : {}),
              }),
            });
      if (!response.ok) {
        const json = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
        setError(json.error?.message ?? 'We could not save that.');
        return;
      }
      setEditing(false);
      setMembers(null);
      router.refresh();
    } catch {
      setError('We could not reach the service.');
    } finally {
      setBusy(false);
    }
  };

  if (!editing) {
    return (
      <span className="meta__item">
        <Icon name="user" />
        {current !== null ? (
          <>
            For {current.label}
            {current.relationship ? ` (${current.relationship})` : ''}
          </>
        ) : (
          'For you'
        )}
        {enabled ? (
          <button type="button" className="btn btn--link" onClick={() => setEditing(true)}>
            Change
          </button>
        ) : null}
      </span>
    );
  }

  return (
    <span className="member-picker">
      <label htmlFor="member-choice" className="sr-only">
        Who is this bill for
      </label>
      <select id="member-choice" value={choice} onChange={(e) => setChoice(e.target.value)} disabled={members === null}>
        <option value={NONE}>Me</option>
        {(members ?? []).map((m) => (
          <option key={m.label} value={m.label}>
            {m.label}
            {m.relationship ? ` (${m.relationship})` : ''}
          </option>
        ))}
        <option value={NEW}>Someone else…</option>
      </select>
      {choice === NEW ? (
        <>
          <input
            aria-label="Their name"
            placeholder="Name"
            value={newName}
            maxLength={60}
            onChange={(e) => setNewName(e.target.value)}
          />
          <input
            aria-label="Relationship"
            placeholder="Relationship (optional)"
            value={relationship}
            maxLength={60}
            onChange={(e) => setRelationship(e.target.value)}
          />
        </>
      ) : null}
      <button
        type="button"
        className="btn btn--primary btn--sm"
        onClick={save}
        disabled={busy || (choice === NEW && newName.trim().length === 0)}
        aria-busy={busy}
      >
        {busy ? 'Saving…' : 'Save'}
      </button>
      <button type="button" className="btn btn--quiet btn--sm" onClick={() => setEditing(false)}>
        Cancel
      </button>
      {limit !== null && members !== null ? (
        <span className="caption">
          {members.length} of {limit} people on your plan
        </span>
      ) : null}
      {error !== null ? (
        <span className="field__error" role="alert">
          {error}
        </span>
      ) : null}
    </span>
  );
}
