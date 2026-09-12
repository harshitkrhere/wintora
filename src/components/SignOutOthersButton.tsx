'use client';

import { useCallback, useState } from 'react';

export function SignOutOthersButton(): React.ReactElement {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

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
      setNote(r.ok ? (j.message ?? 'Done.') : (j.error?.message ?? 'Something went wrong.'));
    } catch {
      setNote('We could not reach the service. Please check your connection.');
    } finally {
      setBusy(false);
    }
  }, []);

  return (
    <div className="stack">
      <button type="button" className="btn btn--secondary" onClick={go} disabled={busy}>
        {busy ? 'Signing out…' : 'Sign out of all other devices'}
      </button>
      {note ? <p className="notice notice--accent" style={{ margin: 0 }}>{note}</p> : null}
    </div>
  );
}
