/**
 * The middleware refreshes a session only when the request carries one. The
 * predicate that decides that has to recognise Supabase's cookie names,
 * including the chunked form, and nothing else.
 */

import { describe, expect, it } from 'vitest';
import { hasSessionCookie } from '@/lib/auth/session-cookie';

describe('hasSessionCookie', () => {
  it('recognises the Supabase session cookie', () => {
    expect(hasSessionCookie(['sb-abcdefghij-auth-token'])).toBe(true);
  });

  it('recognises a chunked session cookie', () => {
    expect(hasSessionCookie(['sb-abcdefghij-auth-token.0', 'sb-abcdefghij-auth-token.1'])).toBe(true);
  });

  it('ignores an anonymous visitor', () => {
    expect(hasSessionCookie([])).toBe(false);
    expect(hasSessionCookie(['wintora-consent', '_ga', 'sb-abcdefghij-code-verifier'])).toBe(false);
  });
});
