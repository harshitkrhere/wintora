'use client';

import { useCallback, useState } from 'react';

export function ForgotPasswordForm(): React.ReactElement {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

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
        setMessage(
          r.ok
            ? { ok: true, text: j.message ?? 'Check your email.' }
            : { ok: false, text: j.error?.message ?? 'Something went wrong.' },
        );
      } catch {
        setMessage({ ok: false, text: 'We could not reach the service. Please check your connection.' });
      } finally {
        setBusy(false);
      }
    },
    [email],
  );

  return (
    <form onSubmit={submit} className="stack auth-form">
      <div className="field">
        <label htmlFor="forgot-email">Email address</label>
        <input
          id="forgot-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          placeholder="you@example.com"
          required
        />
      </div>
      <button type="submit" className="btn btn--primary btn--lg" disabled={busy} aria-busy={busy}>
        {busy ? 'Sending…' : 'Send reset link'}
      </button>
      {message ? (
        <p className={`notice ${message.ok ? 'notice--success' : 'notice--error'}`} role={message.ok ? 'status' : 'alert'}>
          {message.text}
        </p>
      ) : null}
    </form>
  );
}
