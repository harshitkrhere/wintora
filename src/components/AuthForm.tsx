'use client';

/**
 * Sign-in and sign-up.
 *
 * One component for both, because they differ by about four strings and the
 * endpoint. Keeping them together stops the two drifting apart, which is how
 * one of them ends up with weaker validation than the other.
 *
 * The server returns a constant-shaped response for both, so this never learns
 * whether an email address has an account. It just renders what it is told.
 */

import { useCallback, useState } from 'react';
import { MIN_PASSWORD_LENGTH } from '@/lib/auth/password';

type Mode = 'signin' | 'signup';

interface AuthResponse {
  kind:
    | 'SIGNED_IN'
    | 'FAILED'
    | 'CHECK_EMAIL'
    | 'MAGIC_LINK_SENT'
    | 'INVALID_PASSWORD';
  message?: string;
  redirectTo?: string;
  error?: { message?: string };
}

export function AuthForm({
  mode,
  next,
  initialError,
}: {
  mode: Mode;
  next: string | null;
  initialError: string | null;
}): React.ReactElement {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [country, setCountry] = useState<'US' | 'CA'>('US');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(initialError);
  const [done, setDone] = useState(false);

  const isSignUp = mode === 'signup';

  const submit = useCallback(
    async (event: React.FormEvent, magicLink = false): Promise<void> => {
      event.preventDefault();
      setBusy(true);
      setMessage(null);

      try {
        const response = await fetch(`/api/auth/${mode}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            email,
            // Omitting the password asks for a magic link instead.
            ...(magicLink ? {} : { password }),
            ...(isSignUp ? { country } : {}),
            ...(next !== null ? { next } : {}),
          }),
        });

        const json = (await response.json()) as AuthResponse;

        if (!response.ok) {
          setMessage(json.error?.message ?? 'Something went wrong. Please try again.');
          setBusy(false);
          return;
        }

        if (json.kind === 'SIGNED_IN' && typeof json.redirectTo === 'string') {
          // A full navigation, so the new session cookie is sent with it.
          window.location.href = json.redirectTo;
          return;
        }

        setMessage(json.message ?? null);
        setDone(json.kind === 'CHECK_EMAIL' || json.kind === 'MAGIC_LINK_SENT');
        setBusy(false);
      } catch {
        setMessage('We could not reach the service. Please check your connection.');
        setBusy(false);
      }
    },
    [mode, email, password, country, next, isSignUp],
  );

  const startGoogle = useCallback(async (): Promise<void> => {
    setBusy(true);
    setMessage(null);

    try {
      const response = await fetch('/api/auth/oauth', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          provider: 'google',
          ...(next !== null ? { next } : {}),
        }),
      });

      const json = (await response.json()) as { url?: string; error?: { message?: string } };

      if (!response.ok || typeof json.url !== 'string') {
        setMessage(
          json.error?.message ??
            'Signing in with Google is not available right now. You can use an email address instead.',
        );
        setBusy(false);
        return;
      }

      window.location.href = json.url;
    } catch {
      setMessage('We could not reach the service. Please check your connection.');
      setBusy(false);
    }
  }, [next]);

  if (done) {
    return (
      <div className="card" role="status">
        <h2 style={{ marginTop: 0, fontSize: '1.05rem' }}>Check your email</h2>
        <p className="small" style={{ marginBottom: 0 }}>
          {message}
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={(e) => submit(e)} className="card">
      {/* Google first: for most people it is one tap and no password to
          forget. The email form stays fully usable underneath, because
          requiring a Google account to read your own medical bills would be a
          poor trade. */}
      <button
        type="button"
        className="btn btn--secondary"
        onClick={startGoogle}
        disabled={busy}
        style={{ width: '100%', gap: '0.6rem' }}
      >
        <GoogleMark />
        {isSignUp ? 'Sign up with Google' : 'Continue with Google'}
      </button>

      <div
        aria-hidden="true"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem',
          margin: '1.25rem 0',
          color: 'var(--ink-400)',
          fontSize: '0.82rem',
        }}
      >
        <span style={{ flex: 1, height: 1, background: 'var(--line)' }} />
        or use an email address
        <span style={{ flex: 1, height: 1, background: 'var(--line)' }} />
      </div>

      <div className="field">
        <label htmlFor="auth-email">Email address</label>
        <input
          id="auth-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          required
          maxLength={320}
        />
      </div>

      <div className="field">
        <label htmlFor="auth-password">Password</label>
        <input
          id="auth-password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete={isSignUp ? 'new-password' : 'current-password'}
          required
          minLength={isSignUp ? MIN_PASSWORD_LENGTH : undefined}
          maxLength={400}
        />
        {isSignUp ? (
          <p className="small muted" style={{ marginTop: '0.35rem', marginBottom: 0 }}>
            At least {MIN_PASSWORD_LENGTH} characters. Length matters far more than
            mixing in symbols, so a few unrelated words works well.
          </p>
        ) : null}
      </div>

      {isSignUp ? (
        <div className="field">
          <label htmlFor="auth-country">Where are you?</label>
          <select
            id="auth-country"
            value={country}
            onChange={(e) => setCountry(e.target.value === 'CA' ? 'CA' : 'US')}
          >
            <option value="US">United States</option>
            <option value="CA">Canada</option>
          </select>
          <p className="small muted" style={{ marginTop: '0.35rem', marginBottom: 0 }}>
            Guidance differs by country, so we ask once. Nothing else is required.
          </p>
        </div>
      ) : null}

      {message !== null ? (
        <p role="alert" className="notice" style={{ marginBottom: '1rem' }}>
          {message}
        </p>
      ) : null}

      <button type="submit" className="btn btn--primary" disabled={busy}>
        {busy ? 'Working…' : isSignUp ? 'Create account' : 'Sign in'}
      </button>

      {!isSignUp ? (
        <button
          type="button"
          className="btn btn--quiet"
          onClick={(e) => submit(e, true)}
          disabled={busy || email.length === 0}
          style={{ marginLeft: '0.5rem' }}
        >
          Email me a link instead
        </button>
      ) : null}
    </form>
  );
}

/**
 * Google's mark, inline so it needs no network request and cannot be blocked
 * by img-src. Drawn from Google's published brand colours.
 */
function GoogleMark(): React.ReactElement {
  return (
    <svg width="17" height="17" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <path
        fill="#4285F4"
        d="M45.12 24.5c0-1.56-.14-3.06-.4-4.5H24v8.51h11.84c-.51 2.75-2.06 5.08-4.39 6.64v5.52h7.11c4.16-3.83 6.56-9.47 6.56-16.17z"
      />
      <path
        fill="#34A853"
        d="M24 46c5.94 0 10.92-1.97 14.56-5.33l-7.11-5.52c-1.97 1.32-4.49 2.1-7.45 2.1-5.73 0-10.58-3.87-12.31-9.07H4.34v5.7C7.96 41.07 15.4 46 24 46z"
      />
      <path
        fill="#FBBC05"
        d="M11.69 28.18C11.25 26.86 11 25.45 11 24s.25-2.86.69-4.18v-5.7H4.34C2.85 17.09 2 20.45 2 24s.85 6.91 2.34 9.88l7.35-5.7z"
      />
      <path
        fill="#EA4335"
        d="M24 10.75c3.23 0 6.13 1.11 8.41 3.29l6.31-6.31C34.91 4.18 29.93 2 24 2 15.4 2 7.96 6.93 4.34 14.12l7.35 5.7c1.73-5.2 6.58-9.07 12.31-9.07z"
      />
    </svg>
  );
}
