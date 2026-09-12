'use client';

/**
 * The pricing page call to action.
 *
 * This exists because linking straight to `/checkout?plan=plus` does not work
 * and cannot: `/checkout` opens a provider subscription that must already exist.
 * Creating it is a server operation, because the price has to be resolved from
 * `plan_prices` rather than supplied by the browser.
 *
 * So the flow is: POST the plan SLUG and INTERVAL, let the server resolve the
 * price and create the transaction, then follow the URL it returns.
 *
 * Nothing here decides entitlements. It starts a checkout; the webhook grants
 * the plan.
 */

import { useCallback, useState } from 'react';
import type { BillingInterval } from '@/config/plans';

interface CheckoutResponse {
  kind: 'CHECKOUT' | 'UPGRADED' | 'DOWNGRADE_SCHEDULED';
  url?: string;
  message?: string;
  error?: { message?: string };
}

/**
 * The button is a small state machine. Each state renders one way; there is
 * no combination of flags that has no rendering.
 */
type ButtonState =
  | { kind: 'idle' }
  | { kind: 'starting' }
  | { kind: 'failed'; message: string }
  /** The server changed the plan in place; there is nothing to redirect to. */
  | { kind: 'changed'; message: string };

/**
 * A stable key for this purchase attempt.
 *
 * It must survive a retry (so a double click or a refresh does not create a
 * second transaction) but differ for a genuinely new purchase. Stored per
 * offer for the tab's lifetime; a timestamp or a fresh random value here would
 * defeat the whole point of an idempotency key.
 */
function attemptKeyFor(planSlug: string, interval: BillingInterval): string {
  const storageKey = `wintora.checkout.attempt.${planSlug}.${interval}`;
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

const GENERIC_FAILURE = 'We could not start checkout. Please try again.';

export function CheckoutButton({
  planSlug,
  planName,
  interval,
  variant = 'secondary',
}: {
  planSlug: string;
  planName: string;
  interval: BillingInterval;
  variant?: 'primary' | 'secondary';
}): React.ReactElement {
  const [state, setState] = useState<ButtonState>({ kind: 'idle' });

  const start = useCallback(async (): Promise<void> => {
    setState({ kind: 'starting' });

    try {
      const response = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          planSlug,
          interval,
          attemptKey: attemptKeyFor(planSlug, interval),
        }),
      });

      if (response.status === 401) {
        // Not signed in. Come back to this exact offer after signing in.
        const next = encodeURIComponent(`/pricing?plan=${planSlug}&interval=${interval}`);
        window.location.href = `/signin?next=${next}`;
        return;
      }

      const json = (await response.json()) as CheckoutResponse;

      if (!response.ok) {
        setState({ kind: 'failed', message: json.error?.message ?? GENERIC_FAILURE });
        return;
      }

      if (json.kind !== 'CHECKOUT') {
        setState({ kind: 'changed', message: json.message ?? 'Your plan has been updated.' });
        return;
      }

      if (typeof json.url !== 'string') {
        setState({ kind: 'failed', message: GENERIC_FAILURE });
        return;
      }

      window.location.href = json.url;
    } catch {
      setState({
        kind: 'failed',
        message: 'We could not reach the service. Please check your connection.',
      });
    }
  }, [planSlug, interval]);

  const busy = state.kind === 'starting';

  return (
    <div className="plan__cta">
      <button
        type="button"
        onClick={start}
        disabled={busy}
        aria-busy={busy}
        className={`btn btn--block ${variant === 'primary' ? 'btn--primary' : 'btn--secondary'}`}
      >
        {busy ? 'Starting checkout…' : `Choose ${planName}`}
      </button>

      {state.kind === 'failed' ? (
        <p role="alert" className="field__error plan__cta-note">
          {state.message}
        </p>
      ) : null}
      {state.kind === 'changed' ? (
        <p role="status" className="notice notice--success plan__cta-note">
          {state.message}
        </p>
      ) : null}
    </div>
  );
}
