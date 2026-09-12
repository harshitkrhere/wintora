'use client';

/**
 * Self-service subscription controls: cancel at period end, pause, resume,
 * update card. Each is one click plus, for cancellation, one confirmation.
 *
 * The component decides nothing about entitlements. It asks the server to make
 * a change; the server asks the provider; the page is refreshed from the
 * database. What the customer sees afterwards is what is enforced.
 *
 * A state machine, not a set of flags: every state renders one way.
 */

import { useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';
import { loadRazorpayCheckout } from '@/lib/razorpay/checkout-client';

type Action = 'cancel' | 'pause' | 'resume' | 'card';

type State =
  | { kind: 'idle' }
  | { kind: 'confirming'; action: 'cancel' }
  | { kind: 'working'; action: Action }
  | { kind: 'card-open' }
  | { kind: 'done'; message: string }
  | { kind: 'failed'; message: string };

interface ManageResponse {
  action?: Action;
  message?: string;
  keyId?: string;
  subscriptionId?: string;
  error?: { message?: string };
}

const GENERIC = 'We could not make that change. Please try again.';

/** The colour of the provider's form: the product's primary blue, so the two feel like one flow. */
const BRAND_BLUE = '#2563eb';

export function ManageSubscription({
  status,
  cancelAtPeriodEnd,
  canPause,
  periodEndLabel,
  email,
}: {
  status: string;
  cancelAtPeriodEnd: boolean;
  canPause: boolean;
  periodEndLabel: string;
  email: string | null;
}): React.ReactElement {
  const router = useRouter();
  const [state, setState] = useState<State>({ kind: 'idle' });

  const call = useCallback(async (action: Action): Promise<ManageResponse | null> => {
    try {
      const response = await fetch('/api/billing/manage', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const json = (await response.json().catch(() => ({}))) as ManageResponse;
      if (!response.ok) {
        setState({ kind: 'failed', message: json.error?.message ?? GENERIC });
        return null;
      }
      return json;
    } catch {
      setState({ kind: 'failed', message: 'We could not reach the service. Please check your connection.' });
      return null;
    }
  }, []);

  const run = useCallback(
    async (action: Exclude<Action, 'card'>): Promise<void> => {
      setState({ kind: 'working', action });
      const json = await call(action);
      if (json === null) return;
      setState({ kind: 'done', message: json.message ?? 'Done.' });
      router.refresh();
    },
    [call, router],
  );

  const updateCard = useCallback(async (): Promise<void> => {
    setState({ kind: 'working', action: 'card' });
    const json = await call('card');
    if (json === null) return;
    if (json.keyId === undefined || json.subscriptionId === undefined) {
      setState({ kind: 'failed', message: GENERIC });
      return;
    }
    try {
      const Razorpay = await loadRazorpayCheckout();
      const rzp = new Razorpay({
        key: json.keyId,
        subscription_id: json.subscriptionId,
        // Razorpay's card-change mode: authorises a new card for future
        // charges and takes no payment now.
        subscription_card_change: 1,
        name: 'Wintora',
        description: 'Update the card for your subscription',
        prefill: email !== null ? { email } : undefined,
        theme: { color: BRAND_BLUE },
        modal: { ondismiss: () => setState({ kind: 'idle' }) },
        handler: () => {
          setState({
            kind: 'done',
            message: 'Your card has been updated. Future renewals will use the new card.',
          });
          router.refresh();
        },
      });
      rzp.on('payment.failed', (failure) => {
        setState({
          kind: 'failed',
          message: failure.error?.description ?? 'The card could not be verified. Nothing has changed.',
        });
      });
      setState({ kind: 'card-open' });
      rzp.open();
    } catch {
      setState({ kind: 'failed', message: 'We could not load the secure card form. Please try again.' });
    }
  }, [call, email, router]);

  const busy = state.kind === 'working' || state.kind === 'card-open';
  const ending = status === 'CANCELED_PENDING_EXPIRY' || cancelAtPeriodEnd;
  const paused = status === 'PAUSED';
  const failing = status === 'PAST_DUE' || status === 'GRACE';

  return (
    <div className="manage">
      <div className="manage__actions">
        {paused ? (
          <button
            type="button"
            className="btn btn--primary"
            disabled={busy}
            aria-busy={state.kind === 'working' && state.action === 'resume'}
            onClick={() => void run('resume')}
          >
            Resume subscription
          </button>
        ) : null}

        <button
          type="button"
          className="btn btn--secondary"
          disabled={busy}
          aria-busy={busy && state.kind === 'card-open'}
          onClick={() => void updateCard()}
        >
          {failing ? 'Update card to fix payment' : 'Update card'}
        </button>

        {canPause && !paused && !ending && status === 'ACTIVE' ? (
          <button
            type="button"
            className="btn btn--secondary"
            disabled={busy}
            aria-busy={state.kind === 'working' && state.action === 'pause'}
            onClick={() => void run('pause')}
          >
            Pause
          </button>
        ) : null}

        {!ending && !paused ? (
          <button
            type="button"
            className="btn btn--quiet"
            disabled={busy}
            onClick={() => setState({ kind: 'confirming', action: 'cancel' })}
          >
            Cancel subscription
          </button>
        ) : null}
      </div>

      {state.kind === 'confirming' ? (
        <div className="manage__confirm" role="group" aria-labelledby="cancel-confirm-title">
          <p id="cancel-confirm-title" className="manage__confirm-title">
            End your subscription on {periodEndLabel}?
          </p>
          <p className="small">
            You keep every paid feature until then. Afterwards your account moves to Free,
            and your cases, documents and letters stay exactly where they are. This cannot
            be undone from here; if you change your mind you can subscribe again after it
            ends.
          </p>
          <div className="card__actions">
            <button type="button" className="btn btn--primary" onClick={() => setState({ kind: 'idle' })}>
              Keep my subscription
            </button>
            <button type="button" className="btn btn--danger" onClick={() => void run('cancel')}>
              Yes, end it on {periodEndLabel}
            </button>
          </div>
        </div>
      ) : null}

      {state.kind === 'working' ? (
        <p className="caption" role="status">
          Making the change with the payment provider…
        </p>
      ) : null}
      {state.kind === 'card-open' ? (
        <p className="caption" role="status">
          The secure card form is open. Card details go to Razorpay, not to Wintora.
        </p>
      ) : null}
      {state.kind === 'done' ? (
        <p className="notice notice--success" role="status">
          {state.message}
        </p>
      ) : null}
      {state.kind === 'failed' ? (
        <p className="notice notice--error" role="alert">
          {state.message}
        </p>
      ) : null}
    </div>
  );
}
