'use client';

import { useCallback, useState } from 'react';

export function ForgotPasswordForm(): React.ReactElement {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const submit = useCallback(
    async (e: React.FormEvent): Promise<void> => {
      e.preventDefault();
      setBusy(true);
      setMessage(null);
      try {
        const r = await fetch('/api/auth/forgot', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email }),
        });
        const j = (await r.json()) as { message?: string; error?: { message?: string } };
        setMessage(r.ok ? (j.message ?? 'Check your email.') : (j.error?.message ?? 'Something went wrong.'));
      } catch {
        setMessage('We could not reach the service. Please check your connection.');
      } finally {
        setBusy(false);
      }
    },
    [email],
  );

  return (
    <form onSubmit={submit} className="stack">
      <div className="field" style={{ margin: 0 }}>
        <label htmlFor="forgot-email">Email</label>
        <input
          id="forgot-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          required
        />
      </div>
      <button type="submit" className="btn btn--primary" disabled={busy}>
        {busy ? 'Sending…' : 'Send reset link'}
      </button>
      {message ? <p className="notice notice--accent" style={{ margin: 0 }}>{message}</p> : null}
    </form>
  );
}
