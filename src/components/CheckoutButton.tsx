'use client';

/**
 * The pricing page call to action.
 *
 * This exists because linking straight to `/checkout?plan=plus` does not work
 * and cannot: `/checkout` opens a Paddle transaction that must already exist.
 * Creating it is a server operation, because the price has to be resolved from
 * `plan_prices` rather than supplied by the browser.
 *
 * So the flow is: POST the plan SLUG, let the server resolve the price and
 * create the transaction, then follow the URL it returns.
 *
 * Nothing here decides entitlements. It starts a checkout; the webhook grants
 * the plan.
 */

import { useCallback, useState } from 'react';

interface CheckoutResponse {
  kind: 'CHECKOUT' | 'UPGRADED' | 'DOWNGRADE_SCHEDULED';
  url?: string;
  message?: string;
  error?: { message?: string };
}

/**
 * A stable key for this purchase attempt.
 *
 * It must survive a retry (so a double click or a refresh does not create a
 * second transaction) but differ for a genuinely new purchase. Stored per plan
 * for the tab's lifetime; a timestamp or a fresh random value here would defeat
 * the whole point of an idempotency key.
 */
function attemptKeyFor(planSlug: string): string {
  const storageKey = `wintora.checkout.attempt.${planSlug}`;
  try {
    const existing = sessionStorage.getItem(storageKey);
    if (existing !== null && existing.length >= 8) return existing;
    const fresh = crypto.randomUUID().replace(/-/g, '');
    sessionStorage.setItem(storageKey, fresh);
    return fresh;
  } catch {
    // Private browsing, or storage disabled. A per-render key is worse than a
    // stored one but still better than failing the purchase outright.
    return crypto.randomUUID().replace(/-/g, '');
  }
}

export function CheckoutButton({
  planSlug,
  planName,
  variant = 'secondary',
}: {
  planSlug: string;
  planName: string;
  variant?: 'primary' | 'secondary';
}): React.ReactElement {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = useCallback(async (): Promise<void> => {
    setBusy(true);
    setError(null);

    try {
      const response = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ planSlug, attemptKey: attemptKeyFor(planSlug) }),
      });

      const json = (await response.json()) as CheckoutResponse;

      if (response.status === 401) {
        // Not signed in. Come back here after signing in.
        const next = encodeURIComponent(`/pricing?plan=${planSlug}`);
        window.location.href = `/signin?next=${next}`;
        return;
      }

      if (!response.ok) {
        setError(json.error?.message ?? 'We could not start checkout. Please try again.');
        setBusy(false);
        return;
      }

      // Already subscribed: the server changed the plan instead of opening a
      // checkout, so there is nothing to redirect to.
      if (json.kind !== 'CHECKOUT') {
        setError(json.message ?? 'Your plan has been updated.');
        setBusy(false);
        return;
      }

      if (typeof json.url !== 'string') {
        setError('We could not start checkout. Please try again.');
        setBusy(false);
        return;
      }

      window.location.href = json.url;
    } catch {
      setError('We could not reach the service. Please check your connection.');
      setBusy(false);
    }
  }, [planSlug]);

  return (
    <div style={{ marginTop: 'auto' }}>
      <button
        type="button"
        onClick={start}
        disabled={busy}
        className={variant === 'primary' ? 'btn btn--primary' : 'btn btn--secondary'}
        style={{ width: '100%' }}
      >
        {busy ? 'Starting checkout…' : `Choose ${planName}`}
      </button>

      {error !== null ? (
        <p role="alert" className="small" style={{ marginTop: '0.6rem', marginBottom: 0 }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
