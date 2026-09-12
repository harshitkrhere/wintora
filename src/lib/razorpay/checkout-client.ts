/**
 * Loading Razorpay's checkout.js in the browser.
 *
 * checkout.js renders the payment form in an iframe served by Razorpay, so
 * card details go to Razorpay and never to us. Our CSP allows exactly this
 * script (`https://checkout.razorpay.com`) and its frames; see
 * src/lib/http/csp.ts.
 *
 * The public key id is all the script needs to open a subscription the server
 * already created. It cannot create one, change a price or read anything, and
 * the callback it produces is verified server-side before anything is written.
 *
 * Browser-only module: it touches `document` and `window`.
 */

export const RAZORPAY_CHECKOUT_JS = 'https://checkout.razorpay.com/v1/checkout.js';

export interface RazorpayCheckoutResponse {
  razorpay_payment_id: string;
  razorpay_subscription_id: string;
  razorpay_signature: string;
}

export interface RazorpayPaymentFailed {
  error?: {
    code?: string;
    description?: string;
    reason?: string;
    metadata?: { payment_id?: string };
  };
}

export interface RazorpayCheckoutOptions {
  key: string;
  subscription_id: string;
  name: string;
  description?: string;
  image?: string;
  /** Set to 1 to update the card on an existing subscription instead of paying. */
  subscription_card_change?: 0 | 1;
  prefill?: { email?: string; name?: string; contact?: string };
  notes?: Record<string, string>;
  theme?: { color?: string };
  modal?: { ondismiss?: () => void; escape?: boolean; backdropclose?: boolean };
  retry?: { enabled?: boolean };
  handler: (response: RazorpayCheckoutResponse) => void;
}

export interface RazorpayInstance {
  open(): void;
  close(): void;
  on(event: 'payment.failed', callback: (response: RazorpayPaymentFailed) => void): void;
}

export type RazorpayConstructor = new (options: RazorpayCheckoutOptions) => RazorpayInstance;

declare global {
  interface Window {
    Razorpay?: RazorpayConstructor;
  }
}

let loading: Promise<RazorpayConstructor> | null = null;

/** Load checkout.js once per page and resolve to its constructor. */
export function loadRazorpayCheckout(): Promise<RazorpayConstructor> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('checkout.js can only load in a browser'));
  }
  if (window.Razorpay !== undefined) return Promise.resolve(window.Razorpay);
  if (loading !== null) return loading;

  loading = new Promise<RazorpayConstructor>((resolve, reject) => {
    const settle = (): void => {
      if (window.Razorpay !== undefined) resolve(window.Razorpay);
      else reject(new Error('checkout.js loaded but defined no Razorpay global'));
    };

    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${RAZORPAY_CHECKOUT_JS}"]`,
    );
    if (existing !== null) {
      existing.addEventListener('load', settle, { once: true });
      existing.addEventListener('error', () => reject(new Error('checkout.js failed to load')), {
        once: true,
      });
      // It may already have finished loading before we attached listeners.
      if (window.Razorpay !== undefined) settle();
      return;
    }

    const script = document.createElement('script');
    script.src = RAZORPAY_CHECKOUT_JS;
    script.async = true;
    script.onload = settle;
    script.onerror = () => {
      loading = null;
      reject(new Error('checkout.js failed to load'));
    };
    document.head.appendChild(script);
  });

  return loading;
}
