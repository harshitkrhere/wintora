'use client';

/**
 * The checkout page's client half.
 *
 * Opens Razorpay's payment form for a subscription the SERVER already created
 * for THIS user. The component receives the subscription id and the public key
 * as props from a server component; it never chooses a plan, an amount or a
 * currency, and the browser could not change any of them if it tried.
 *
 * When the form completes, Razorpay hands back a payment id, the subscription
 * id and a signature over the two. That is posted to /api/billing/verify,
 * which checks the signature and then reads the subscription back from
 * Razorpay. Nothing is granted on the browser's word.
 *
 * The component is a small state machine. Every state has exactly one
 * rendering, and there is no combination of flags without one.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  loadRazorpayCheckout,
  type RazorpayCheckoutResponse,
  type RazorpayInstance,
} from '@/lib/razorpay/checkout-client';
import { Icon } from './Icons';

type Phase =
  | { kind: 'loading' }
  | { kind: 'ready' }
  | { kind: 'open' }
  | { kind: 'verifying' }
  | { kind: 'done' }
  | { kind: 'dismissed' }
  | { kind: 'failed'; message: string; charged: boolean };

/** The colour of the provider's form: the product's primary blue, so the two feel like one flow. */
const BRAND_BLUE = '#2563eb';

export function RazorpayCheckout({
  keyId,
  subscriptionId,
  planName,
  description,
  email,
}: {
  keyId: string;
  subscriptionId: string;
  planName: string;
  description: string;
  email: string | null;
}): React.ReactElement {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const instance = useRef<RazorpayInstance | null>(null);

  const verify = useCallback(
    async (response: RazorpayCheckoutResponse): Promise<void> => {
      setPhase({ kind: 'verifying' });
      try {
        const result = await fetch('/api/billing/verify', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(response),
        });
        if (!result.ok) {
          const json = (await result.json().catch(() => ({}))) as { error?: { message?: string } };
          setPhase({
            kind: 'failed',
            message:
              json.error?.message ??
              'We could not confirm the payment. If you were charged, contact us and we will sort it out.',
            charged: true,
          });
          return;
        }
        setPhase({ kind: 'done' });
        window.location.assign('/billing/success');
      } catch {
        setPhase({
          kind: 'failed',
          message:
            'We could not reach the service to confirm the payment. Your payment may have gone through; check your subscription page in a moment.',
          charged: true,
        });
      }
    },
    [],
  );

  const open = useCallback(async (): Promise<void> => {
    try {
      const Razorpay = await loadRazorpayCheckout();
      const rzp = new Razorpay({
        key: keyId,
        subscription_id: subscriptionId,
        name: 'Wintora',
        description,
        prefill: email !== null ? { email } : undefined,
        theme: { color: BRAND_BLUE },
        // A closed form is a decision, not an error. The customer is told
        // plainly that nothing was charged.
        modal: { ondismiss: () => setPhase({ kind: 'dismissed' }) },
        handler: (response) => {
          void verify(response);
        },
      });
      rzp.on('payment.failed', (failure) => {
        setPhase({
          kind: 'failed',
          message:
            failure.error?.description ??
            'The payment did not go through. Nothing has been charged.',
          charged: false,
        });
      });
      instance.current = rzp;
      setPhase({ kind: 'open' });
      rzp.open();
    } catch {
      setPhase({
        kind: 'failed',
        message: 'We could not load the secure payment form. Please check your connection and try again.',
        charged: false,
      });
    }
  }, [keyId, subscriptionId, description, email, verify]);

  // Open once on arrival. The customer clicked "Choose plan" to get here, so a
  // second click would be ceremony.
  const openedOnce = useRef(false);
  useEffect(() => {
    if (openedOnce.current) return;
    openedOnce.current = true;
    void open();
  }, [open]);

  switch (phase.kind) {
    case 'loading':
    case 'ready':
    case 'open':
      return (
        <div aria-live="polite" className="wait">
          <div className="progress" aria-hidden>
            <div className="progress__bar" />
          </div>
          <p className="wait__note">Opening checkout for {planName}</p>
          <p className="small muted card__last">
            {phase.kind === 'loading'
              ? 'Loading the secure payment form…'
              : 'The payment form is open. Your card details go to Razorpay, not to Wintora.'}
          </p>
        </div>
      );

    case 'verifying':
    case 'done':
      return (
        <div aria-live="polite" role="status" className="wait">
          <div className="progress" aria-hidden>
            <div className="progress__bar" />
          </div>
          <p className="wait__note">Confirming your payment</p>
          <p className="small muted card__last">
            One moment while we confirm it with the payment provider. Do not pay again.
          </p>
        </div>
      );

    case 'dismissed':
      return (
        <div role="status" className="card status-card">
          <div className="icon-tile icon-tile--neutral" aria-hidden>
            <Icon name="lock" />
          </div>
          <div className="status-card__body">
            <h2 className="card__title">Checkout closed</h2>
            <p className="small muted">Nothing has been charged. You can reopen the form whenever you like.</p>
            <div className="card__actions">
              <button type="button" className="btn btn--primary" onClick={() => void open()}>
                Reopen checkout
              </button>
              <a href="/pricing" className="btn btn--secondary">
                Back to plans
              </a>
            </div>
          </div>
        </div>
      );

    case 'failed':
      return (
        <div role="alert" className="card status-card">
          <div className={`icon-tile ${phase.charged ? 'icon-tile--warning' : 'icon-tile--error'}`} aria-hidden>
            <Icon name="alert" />
          </div>
          <div className="status-card__body">
            <h2 className="card__title">
              {phase.charged ? 'We could not confirm the payment' : 'The payment did not go through'}
            </h2>
            <p className="small">{phase.message}</p>
            <p className="small muted">
              {phase.charged
                ? 'If your card was charged, your subscription will appear on your subscription page as soon as the payment provider confirms it. If it does not, contact us and we will sort it out.'
                : 'Nothing has been charged. You can try again, or use a different card.'}
            </p>
            <div className="card__actions">
              {phase.charged ? (
                <a href="/settings/subscription" className="btn btn--primary">
                  Go to your subscription page
                </a>
              ) : (
                <button type="button" className="btn btn--primary" onClick={() => void open()}>
                  Try again
                </button>
              )}
              <a href="/pricing" className="btn btn--secondary">
                Back to plans
              </a>
            </div>
          </div>
        </div>
      );
  }
}
