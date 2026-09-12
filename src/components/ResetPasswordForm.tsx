'use client';

import { useCallback, useState } from 'react';
import { MIN_PASSWORD_LENGTH } from '@/lib/auth/password';

export function ResetPasswordForm(): React.ReactElement {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const submit = useCallback(
    async (e: React.FormEvent): Promise<void> => {
      e.preventDefault();
      setBusy(true);
      setMessage(null);
      try {
        const r = await fetch('/api/auth/reset', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ password }),
        });
        const j = (await r.json()) as { message?: string; error?: { message?: string } };
        if (r.ok) {
          window.location.assign('/dashboard');
          return;
        }
        setMessage(j.error?.message ?? 'Something went wrong.');
      } catch {
        setMessage('We could not reach the service. Please check your connection.');
      } finally {
        setBusy(false);
      }
    },
    [password],
  );

  return (
    <form onSubmit={submit} className="stack auth-form">
      <div className="field">
        <label htmlFor="reset-password">New password</label>
        <input
          id="reset-password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          minLength={MIN_PASSWORD_LENGTH}
          required
        />
        <p className="field__hint">At least {MIN_PASSWORD_LENGTH} characters. A sentence you will remember works well.</p>
      </div>
      <button type="submit" className="btn btn--primary btn--lg" disabled={busy} aria-busy={busy}>
        {busy ? 'Saving…' : 'Save new password'}
      </button>
      {message ? (
        <p className="notice notice--error" role="alert">
          {message}
        </p>
      ) : null}
    </form>
  );
}
