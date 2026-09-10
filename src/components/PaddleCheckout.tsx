'use client';

/**
 * The checkout page's client half.
 *
 * Paddle Billing has no fully-hosted checkout. `transaction.checkout.url` is
 * your default payment link with `?_ptxn=<transaction id>` appended, and that
 * link points at THIS page. The page must:
 *
 *   1. load Paddle.js from cdn.paddle.com
 *   2. select the sandbox environment when we are not in production
 *   3. call Paddle.Initialize({ token }) with the client-side token
 *   4. read _ptxn from the query string
 *   5. call Paddle.Checkout.open({ transactionId })
 *
 * The client-side token is public by design, like a publishable key. It can
 * open a checkout for a transaction that already exists; it cannot create one,
 * change a price, or read anything. Prices come from `plan_prices` server-side,
 * so a tampered token buys nothing.
 *
 * This component contains no authorization logic and no plan checks. It opens
 * a transaction the server already created.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

interface PaddleCheckoutInstance {
  Environment: { set(environment: string): void };
  Initialize(options: { token: string; eventCallback?: (event: unknown) => void }): void;
  Checkout: { open(options: { transactionId: string }): void };
}

declare global {
  interface Window {
    Paddle?: PaddleCheckoutInstance;
  }
}

const PADDLE_JS = 'https://cdn.paddle.com/paddle/v2/paddle.js';

type Phase = 'loading' | 'opening' | 'open' | 'error';

export function PaddleCheckout({
  transactionId,
  clientToken,
  environment,
  planName,
}: {
  transactionId: string | null;
  clientToken: string | null;
  environment: 'sandbox' | 'production';
  planName: string | null;
}): React.ReactElement {
  const [phase, setPhase] = useState<Phase>('loading');
  const [message, setMessage] = useState<string | null>(null);
  // Paddle.Initialize must run once per page load, not once per render.
  const initialised = useRef(false);

  const fail = useCallback((text: string) => {
    setPhase('error');
    setMessage(text);
  }, []);

  useEffect(() => {
    if (initialised.current) return;

    if (transactionId === null) {
      fail('This checkout link is missing its transaction reference.');
      return;
    }
    if (clientToken === null) {
      // Fail visibly rather than showing a blank page forever.
      fail('Checkout is not configured yet. Please try again shortly.');
      return;
    }

    initialised.current = true;

    const open = (): void => {
      const paddle = window.Paddle;
      if (paddle === undefined) {
        fail('We could not load the payment form. Please refresh and try again.');
        return;
      }

      try {
        // Sandbox must be selected BEFORE Initialize, or the token is
        // validated against the wrong environment.
        if (environment === 'sandbox') paddle.Environment.set('sandbox');

        paddle.Initialize({
          token: clientToken,
          eventCallback: (event) => {
            const name = (event as { name?: string }).name;
            if (name === 'checkout.closed') {
              setPhase('error');
              setMessage('Checkout was closed before payment completed.');
            }
            if (name === 'checkout.completed') {
              setPhase('open');
              setMessage(null);
            }
          },
        });

        setPhase('opening');
        paddle.Checkout.open({ transactionId });
        setPhase('open');
      } catch {
        fail('We could not open the payment form. Please refresh and try again.');
      }
    };

    const existing = document.querySelector<HTMLScriptElement>(`script[src="${PADDLE_JS}"]`);
    if (existing !== null) {
      open();
      return;
    }

    const script = document.createElement('script');
    script.src = PADDLE_JS;
    script.async = true;
    script.onload = open;
    script.onerror = () =>
      fail('We could not reach the payment provider. Please check your connection.');
    document.head.appendChild(script);
  }, [transactionId, clientToken, environment, fail]);

  if (phase === 'error') {
    return (
      <div role="alert" className="card">
        <h2 style={{ marginTop: 0, fontSize: '1.05rem' }}>We could not open checkout</h2>
        <p className="small">{message}</p>
        <p className="small muted">
          Nothing has been charged. If this keeps happening, contact us and we will
          sort it out.
        </p>
        <a href="/pricing" className="btn btn--secondary">
          Back to plans
        </a>
      </div>
    );
  }

  return (
    <div aria-live="polite" className="card">
      <h2 style={{ marginTop: 0, fontSize: '1.05rem' }}>
        {planName !== null ? `Opening checkout for ${planName}` : 'Opening checkout'}
      </h2>
      <p className="small muted" style={{ marginBottom: 0 }}>
        {phase === 'loading'
          ? 'Loading the secure payment form…'
          : 'The payment form should appear in a moment.'}
      </p>
    </div>
  );
}
