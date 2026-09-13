'use client';

/**
 * Offline banner.
 *
 * Appears the moment the connection drops and leaves the moment it returns.
 * It says what is true and nothing more: nothing is cached for offline use,
 * so anything submitted while this shows will fail, and the forms already
 * say so when it does. This just says it first.
 */

import { useEffect, useState } from 'react';

export function OfflineBanner(): React.ReactElement | null {
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    const update = (): void => setOffline(!navigator.onLine);
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  if (!offline) return null;

  return (
    <div role="status" aria-live="polite" className="banner banner--offline">
      You are offline. Anything you submit will not reach us until the connection is back.
    </div>
  );
}

/**
 * A sign-in link that failed.
 *
 * When a confirmation, magic or reset link has expired or was already used,
 * Supabase does not reach our callback; it sends the browser to the site
 * with the reason in the URL fragment (#error=access_denied&error_code=
 * otp_expired...). The fragment never reaches the server, the landing page
 * ignored it, and a signed-in person was carried on to the dashboard with the
 * hash still attached and no idea their link had failed. This reads the
 * fragment once after hydration, says what happened in one sentence, and
 * removes the fragment so a reload does not repeat it.
 */
export function AuthLinkBanner(): React.ReactElement | null {
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const hash = window.location.hash;
    if (!hash.includes('error')) return;
    const params = new URLSearchParams(hash.replace(/^#/, ''));
    if (params.get('error') === null && params.get('error_code') === null) return;
    const code = params.get('error_code') ?? '';
    setMessage(
      code === 'otp_expired'
        ? 'That sign-in link has expired or was already used. Request a new one and use it soon after it arrives.'
        : 'That sign-in link did not work. Request a new one.',
    );
    // Strip the fragment so the message does not come back on reload.
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }, []);

  if (message === null) return null;
  return (
    <div role="alert" className="banner banner--maintenance">
      <span>{message}</span>{' '}
      <a href="/signin">Sign in</a> · <a href="/forgot-password">Reset your password</a>{' '}
      <button type="button" className="btn btn--link" onClick={() => setMessage(null)}>
        Dismiss
      </button>
    </div>
  );
}
