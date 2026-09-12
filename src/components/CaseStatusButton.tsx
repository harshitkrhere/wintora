'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';

export function CaseStatusButton({ caseId, status }: { caseId: string; status: string }): React.ReactElement {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const next = status === 'OPEN' ? 'CLOSED' : 'OPEN';

  const change = useCallback(async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/cases/${caseId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: next }),
      });
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: { message?: string } };
        setError(j.error?.message ?? 'We could not update the case.');
        return;
      }
      router.refresh();
    } catch {
      setError('We could not reach the service.');
    } finally {
      setBusy(false);
    }
  }, [caseId, next, router]);

  return (
    <>
      <button type="button" className="btn btn--secondary" onClick={change} disabled={busy} aria-busy={busy}>
        {busy ? 'Saving…' : next === 'CLOSED' ? 'Close case' : 'Reopen case'}
      </button>
      {error ? (
        <span className="field__error" role="alert">
          {error}
        </span>
      ) : null}
    </>
  );
}
