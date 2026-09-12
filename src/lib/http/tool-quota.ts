/**
 * The free allowance on the anonymous bill checker.
 *
 * A signed, httpOnly cookie counts how many checks this browser has run. The
 * server refuses the request once the count reaches the limit, so the cap
 * cannot be bypassed by calling the API directly or editing the page.
 *
 * What this is: a conversion nudge. Five real answers, then an account,
 * which is free and needs no card.
 *
 * What this is not: a security control. A person who clears cookies or opens
 * a private window starts again, and that is acceptable. Tying the count to
 * an IP address instead would punish everyone behind a shared connection and
 * would mean keeping IP-linked records this product deliberately does not
 * keep (docs/SECURITY.md section 8). The per-IP rate limit still bounds abuse.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { serverEnv } from '@/lib/env';

export const FREE_CHECKS_COOKIE = 'wintora_free_checks';
const MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

function key(): Buffer {
  const env = serverEnv();
  // Derived with a context string so this key can never be confused with the
  // one used for log hashing, even though both come from the same secret.
  const base = env.LOG_HASH_SECRET ?? env.CRON_SECRET ?? 'development-only-not-a-secret';
  return createHmac('sha256', base).update('wintora:free-checks:v1').digest();
}

function sign(count: number): string {
  return createHmac('sha256', key()).update(`free-checks:${count}`).digest('base64url');
}

/** Read the count from a cookie value, or 0 for anything missing or tampered. */
export function readFreeChecks(cookieValue: string | undefined): number {
  if (cookieValue === undefined) return 0;
  const dot = cookieValue.indexOf('.');
  if (dot <= 0) return 0;
  const countText = cookieValue.slice(0, dot);
  const signature = cookieValue.slice(dot + 1);
  if (!/^\d{1,4}$/.test(countText)) return 0;
  const count = Number(countText);
  const expected = sign(count);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return 0;
  return count;
}

export function freeChecksCookie(count: number): {
  name: string;
  value: string;
  options: { httpOnly: true; sameSite: 'lax'; secure: boolean; path: '/'; maxAge: number };
} {
  return {
    name: FREE_CHECKS_COOKIE,
    value: `${count}.${sign(count)}`,
    options: {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: MAX_AGE_SECONDS,
    },
  };
}
