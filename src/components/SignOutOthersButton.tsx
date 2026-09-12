'use client';

import { useCallback, useState } from 'react';

export function SignOutOthersButton(): React.ReactElement {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  const go = useCallback(async () => {
    setBusy(true);
    setNote(null);
    try {
      const r = await fetch('/api/auth/signout-others', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      const j = (await r.json().catch(() => ({}))) as { message?: string; error?: { message?: string } };
      setNote(
        r.ok
          ? { ok: true, text: j.message ?? 'Done.' }
          : { ok: false, text: j.error?.message ?? 'Something went wrong.' },
      );
    } catch {
      setNote({ ok: false, text: 'We could not reach the service. Please check your connection.' });
    } finally {
      setBusy(false);
    }
  }, []);

  return (
    <div className="stack">
      <div className="actions">
        <button type="button" className="btn btn--secondary" onClick={go} disabled={busy} aria-busy={busy}>
          {busy ? 'Signing out…' : 'Sign out of all other devices'}
        </button>
      </div>
      {note ? (
        <p className={`notice ${note.ok ? 'notice--success' : 'notice--error'}`} role={note.ok ? 'status' : 'alert'}>
          {note.text}
        </p>
      ) : null}
    </div>
  );
}
