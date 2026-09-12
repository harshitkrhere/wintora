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
import { Icon } from './Icons';

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

/**
 * Where a person's inbox lives, if their address makes it obvious. Only the
 * providers whose web inbox URL is stable and well known; for anything else
 * there is no button, because a guess that opens the wrong site is worse
 * than none.
 */
function inboxUrlFor(address: string): { name: string; url: string } | null {
  const domain = address.split('@')[1]?.toLowerCase() ?? '';
  if (domain === 'gmail.com' || domain === 'googlemail.com') return { name: 'Gmail', url: 'https://mail.google.com/' };
  if (['outlook.com', 'hotmail.com', 'live.com', 'msn.com'].includes(domain)) return { name: 'Outlook', url: 'https://outlook.live.com/mail/' };
  if (['yahoo.com', 'yahoo.ca', 'ymail.com'].includes(domain)) return { name: 'Yahoo Mail', url: 'https://mail.yahoo.com/' };
  if (['icloud.com', 'me.com', 'mac.com'].includes(domain)) return { name: 'iCloud Mail', url: 'https://www.icloud.com/mail/' };
  if (domain === 'proton.me' || domain === 'protonmail.com') return { name: 'Proton Mail', url: 'https://mail.proton.me/' };
  return null;
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
    const inbox = inboxUrlFor(email);
    return (
      <div className="auth-done" role="status">
        <div className="icon-tile icon-tile--lg icon-tile--success" aria-hidden>
          <Icon name="mail" />
        </div>
        <h2 className="card__title">Check your email</h2>
        <p className="small muted">{message}</p>
        {inbox ? (
          <div className="auth-actions">
            <a href={inbox.url} className="btn btn--secondary" target="_blank" rel="noopener">
              Open {inbox.name}
              <Icon name="external" />
            </a>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <form onSubmit={(e) => submit(e)} className="auth-form">
      {/* Google first: for most people it is one tap and no password to
          forget. The email form stays fully usable underneath, because
          requiring a Google account to read your own medical bills would be a
          poor trade. */}
      <button
        type="button"
        className="btn btn--secondary btn--block btn--lg"
        onClick={startGoogle}
        disabled={busy}
      >
        <GoogleMark />
        {isSignUp ? 'Sign up with Google' : 'Continue with Google'}
      </button>

      <div className="divider" aria-hidden="true">
        or use an email address
      </div>

      <div className="field">
        <label htmlFor="auth-email">Email address</label>
        <input
          id="auth-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          placeholder="you@example.com"
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
          <p className="field__hint">
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
          <p className="field__hint">
            Guidance differs by country, so we ask once. Nothing else is required.
          </p>
        </div>
      ) : null}

      {message !== null ? (
        <p role="alert" className="notice notice--error auth-form__error">
          {message}
        </p>
      ) : null}

      <div className="auth-actions">
        <button type="submit" className="btn btn--primary btn--lg" disabled={busy} aria-busy={busy}>
          {busy ? 'Working…' : isSignUp ? 'Create account' : 'Sign in'}
        </button>

        {!isSignUp ? (
          <div className="auth-form__alt">
            <button
              type="button"
              className="btn btn--quiet"
              onClick={(e) => submit(e, true)}
              disabled={busy || email.length === 0}
            >
              Email me a sign-in link instead
            </button>
          </div>
        ) : null}
      </div>
    </form>
  );
}

/**
 * Google's mark, inline so it needs no network request and cannot be blocked
 * by img-src. Drawn from Google's published brand colours.
 */
function GoogleMark(): React.ReactElement {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
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
