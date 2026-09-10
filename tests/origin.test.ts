/**
 * CSRF origin checking.
 *
 * The development case is the one that bites: browsing `http://localhost:3000`
 * while `NEXT_PUBLIC_APP_URL` points at a tunnel is a normal setup, and a naive
 * equality check rejects every POST with a bare 403 that looks like a
 * permissions bug rather than a configuration mismatch.
 */

import { describe, expect, it } from 'vitest';
import { checkOrigin, isPlaceholderAppUrl } from '@/lib/http/origin';

const APP = 'https://wintora.example';

const check = (overrides: Partial<Parameters<typeof checkOrigin>[0]>) =>
  checkOrigin({
    origin: APP,
    appUrl: APP,
    isDevelopment: false,
    method: 'POST',
    ...overrides,
  });

describe('same origin', () => {
  it('accepts a request from the configured app URL', () => {
    expect(check({}).ok).toBe(true);
  });

  it('ignores a path on the configured URL', () => {
    expect(check({ appUrl: `${APP}/pricing` }).ok).toBe(true);
  });
});

describe('cross origin', () => {
  it('rejects a different origin in production', () => {
    const verdict = check({ origin: 'https://evil.example' });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toContain('cross-origin');
  });

  it('rejects a different scheme on the same host', () => {
    expect(check({ origin: 'http://wintora.example' }).ok).toBe(false);
  });

  it('rejects a subdomain of the app host', () => {
    // A compromised subdomain is a classic CSRF vector.
    expect(check({ origin: 'https://cdn.wintora.example' }).ok).toBe(false);
  });

  it('rejects a missing Origin header', () => {
    const verdict = check({ origin: null });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toContain('missing Origin');
  });

  it('rejects a malformed Origin header', () => {
    expect(check({ origin: 'not-a-url' }).ok).toBe(false);
  });
});

describe('safe methods', () => {
  it.each(['GET', 'HEAD', 'OPTIONS', 'get'])('%s needs no Origin', (method) => {
    expect(check({ method, origin: null }).ok).toBe(true);
  });

  it.each(['POST', 'PATCH', 'DELETE', 'PUT'])('%s does need one', (method) => {
    expect(check({ method, origin: null }).ok).toBe(false);
  });
});

describe('development loopback allowance', () => {
  it('accepts localhost when the app URL is a tunnel', () => {
    // The exact setup that produced a baffling 403: dev server on localhost,
    // NEXT_PUBLIC_APP_URL pointing at a cloudflared tunnel so Paddle can
    // reach the webhook.
    const verdict = checkOrigin({
      origin: 'http://localhost:3000',
      appUrl: 'https://random-words.trycloudflare.com',
      isDevelopment: true,
      method: 'POST',
    });
    expect(verdict.ok).toBe(true);
  });

  it.each(['http://127.0.0.1:3000', 'http://192.168.1.20:3000', 'http://10.0.0.5:3000'])(
    'accepts %s in development',
    (origin) => {
      expect(check({ origin, isDevelopment: true }).ok).toBe(true);
    },
  );

  it('does NOT accept localhost in production', () => {
    // The allowance is a development convenience, not a hole in the check.
    expect(check({ origin: 'http://localhost:3000', isDevelopment: false }).ok).toBe(false);
  });

  it('does not accept an arbitrary origin just because it is development', () => {
    expect(check({ origin: 'https://evil.example', isDevelopment: true }).ok).toBe(false);
  });

  it('does not treat a lookalike host as loopback', () => {
    // "localhost.evil.example" is not localhost.
    expect(
      check({ origin: 'https://localhost.evil.example', isDevelopment: true }).ok,
    ).toBe(false);
  });
});

describe('configuration errors', () => {
  it('reports an unparseable app URL rather than silently passing', () => {
    const verdict = check({ appUrl: 'not a url' });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toContain('NEXT_PUBLIC_APP_URL');
  });

  it('recognises documentation placeholders', () => {
    // These get pasted out of setup instructions and produce a 403 that looks
    // like a permissions problem. Naming them turns it into a clear message.
    expect(isPlaceholderAppUrl('https://something.trycloudflare.com')).toBe(true);
    expect(isPlaceholderAppUrl('https://yourdomain.com')).toBe(true);
    expect(isPlaceholderAppUrl('https://example.com')).toBe(true);
  });

  it('does not flag a real URL as a placeholder', () => {
    expect(isPlaceholderAppUrl('https://random-words.trycloudflare.com')).toBe(false);
    expect(isPlaceholderAppUrl('http://localhost:3000')).toBe(false);
    expect(isPlaceholderAppUrl(APP)).toBe(false);
  });
});
