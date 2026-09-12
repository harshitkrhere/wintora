'use client';

/**
 * Export everything, or delete everything. Both are rights, not features:
 * they work on every plan, including expired ones, and nothing here can be
 * gated by entitlements.
 *
 * Deletion needs a typed confirmation and a fresh sign-in. The server checks
 * both; this form just makes them possible to satisfy.
 */

import { useCallback, useState } from 'react';

interface Result {
  message?: string;
  error?: { message?: string; code?: string; reason?: string };
}

const STEP_UP = 'For your protection this needs a fresh sign-in. Sign out, sign back in, and try again within ten minutes.';

async function call(path: string, method: string, body?: unknown): Promise<{ ok: boolean; text: string }> {
  try {
    const r = await fetch(path, {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    });
    const j = (await r.json().catch(() => ({}))) as Result;
    if (r.ok) return { ok: true, text: j.message ?? 'Done.' };
    if (j.error?.reason === 'REQUIRES_VERIFICATION') return { ok: false, text: STEP_UP };
    return { ok: false, text: j.error?.message ?? 'Something went wrong.' };
  } catch {
    return { ok: false, text: 'We could not reach the service. Please check your connection.' };
  }
}

function Note({ note }: { note: { ok: boolean; text: string } | null }): React.ReactElement | null {
  if (note === null) return null;
  return (
    <p className={`notice ${note.ok ? 'notice--success' : 'notice--error'}`} role={note.ok ? 'status' : 'alert'}>
      {note.text}
    </p>
  );
}

export function ExportAction(): React.ReactElement {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  const go = useCallback(async () => {
    setBusy(true);
    setNote(await call('/api/privacy/export', 'POST'));
    setBusy(false);
  }, []);

  return (
    <div className="stack">
      <div className="actions">
        <button type="button" className="btn btn--secondary" onClick={go} disabled={busy} aria-busy={busy}>
          {busy ? 'Requesting…' : 'Request a copy of my data'}
        </button>
      </div>
      <Note note={note} />
    </div>
  );
}

export function DeleteAction(): React.ReactElement {
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const armed = confirm === 'DELETE MY ACCOUNT';

  const go = useCallback(async () => {
    setBusy(true);
    setNote(await call('/api/privacy/delete', 'POST', { confirmation: confirm }));
    setBusy(false);
  }, [confirm]);

  const cancel = useCallback(async () => {
    setBusy(true);
    setNote(await call('/api/privacy/delete', 'DELETE'));
    setBusy(false);
  }, []);

  return (
    <div className="stack">
      <div className="field">
        <label htmlFor="delete-confirm">Type DELETE MY ACCOUNT to confirm</label>
        <input
          id="delete-confirm"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          autoComplete="off"
          spellCheck={false}
          placeholder="DELETE MY ACCOUNT"
        />
        <p className="field__hint">The button unlocks once the words match exactly.</p>
      </div>
      <div className="actions">
        <button type="button" className="btn btn--danger" onClick={go} disabled={!armed || busy} aria-busy={busy}>
          {busy ? 'Working…' : 'Schedule deletion'}
        </button>
        <button type="button" className="btn btn--quiet" onClick={cancel} disabled={busy}>
          Cancel a scheduled deletion
        </button>
      </div>
      <Note note={note} />
    </div>
  );
}
