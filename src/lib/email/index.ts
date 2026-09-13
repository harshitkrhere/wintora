/**
 * Transactional email, behind a port.
 *
 * Wintora sends exactly two kinds of message, both to the account holder and
 * both a nudge to open the app: "a reminder you set is due" and "a document
 * is about to be removed". Neither carries a provider, an amount, a condition
 * or anything else from a case, so an inbox that is shared, forwarded or
 * breached learns only that the person uses the product.
 *
 * `getEmailSender()` returns null when no provider is configured. Callers
 * treat null as "queue it and show it in the app", never as an error.
 */

import { serverEnv } from '@/lib/env';
import { log } from '@/lib/logging';

export interface OutboundEmail {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
}

export interface SendReceipt {
  /** The provider's id for the message, when it gives one. Delivery events refer to it. */
  readonly providerMessageId: string | null;
}

export interface EmailSender {
  readonly name: 'hostinger' | 'resend';
  send(message: OutboundEmail): Promise<SendReceipt>;
}

/** "Wintora <info@wintora.online>" -> { name: "Wintora", address: "info@wintora.online" }. */
export function parseFrom(from: string): { name: string | null; address: string } {
  const match = /^\s*(?:"?([^"<]*)"?\s*)?<([^>]+)>\s*$/.exec(from);
  if (match !== null) {
    const name = (match[1] ?? '').trim();
    return { name: name.length > 0 ? name : null, address: match[2]!.trim() };
  }
  return { name: null, address: from.trim() };
}

/**
 * The From header, rebuilt from its parts so a value typed into a dashboard
 * without the space ("Wintora<info@...>") or with stray quotes still becomes
 * a well-formed "Name <address>".
 */
export function formatFrom(from: string): string {
  const { name, address } = parseFrom(from);
  return name !== null ? `${name} <${address}>` : address;
}

class HostingerSender implements EmailSender {
  readonly name = 'hostinger' as const;

  constructor(
    private readonly token: string,
    private readonly mailboxId: string,
    private readonly from: string,
  ) {}

  async send(message: OutboundEmail): Promise<SendReceipt> {
    const { name } = parseFrom(this.from);
    const response = await fetch(
      `https://api.mail.hostinger.com/api/v1/mailboxes/${encodeURIComponent(this.mailboxId)}/send`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.token}`,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify({
          to: [message.to],
          subject: message.subject,
          text: message.text,
          ...(name !== null ? { displayName: name } : {}),
        }),
        signal: AbortSignal.timeout(15_000),
      },
    );
    if (!response.ok) {
      // The body is the provider's error envelope; its code is safe to log,
      // the rest is not needed.
      let code = 'unknown';
      try {
        code = ((await response.json()) as { code?: string }).code ?? code;
      } catch {
        // Not JSON. The status is enough.
      }
      throw new Error(`hostinger send failed: ${response.status} ${code}`);
    }
    // 204: sent and filed under Sent, no id to track by.
    return { providerMessageId: null };
  }
}

class ResendSender implements EmailSender {
  readonly name = 'resend' as const;

  constructor(
    private readonly apiKey: string,
    private readonly from: string,
  ) {}

  async send(message: OutboundEmail): Promise<SendReceipt> {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from: formatFrom(this.from),
        to: [message.to],
        subject: message.subject,
        text: message.text,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      throw new Error(`resend send failed: ${response.status}`);
    }
    const json = (await response.json().catch(() => ({}))) as { id?: string };
    return { providerMessageId: typeof json.id === 'string' ? json.id : null };
  }
}

let cached: EmailSender | null | undefined;

/** The configured sender, or null when email is off. Never throws. */
export function getEmailSender(): EmailSender | null {
  if (cached !== undefined) return cached;
  const env = serverEnv();

  switch (env.EMAIL_PROVIDER) {
    case 'hostinger':
      if (env.HOSTINGER_EMAIL_TOKEN === undefined || env.HOSTINGER_MAILBOX_ID === undefined) {
        log.warn('EMAIL_PROVIDER=hostinger but HOSTINGER_EMAIL_TOKEN or HOSTINGER_MAILBOX_ID is unset; email is off');
        cached = null;
      } else {
        cached = new HostingerSender(env.HOSTINGER_EMAIL_TOKEN, env.HOSTINGER_MAILBOX_ID, env.EMAIL_FROM);
      }
      break;
    case 'resend':
      if (env.RESEND_API_KEY === undefined) {
        log.warn('EMAIL_PROVIDER=resend but RESEND_API_KEY is unset; email is off');
        cached = null;
      } else {
        cached = new ResendSender(env.RESEND_API_KEY, env.EMAIL_FROM);
      }
      break;
    default:
      cached = null;
  }
  return cached;
}

/** Test-only. */
export function __resetEmailSender(): void {
  cached = undefined;
}
