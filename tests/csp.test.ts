/**
 * Content Security Policy.
 *
 * Every assertion here corresponds to a mistake that actually shipped and broke
 * the running app. Both failures looked like "the button does nothing" while
 * the server-rendered HTML stayed perfectly intact, which is the worst kind of
 * bug to debug from the outside.
 */

import { describe, expect, it } from 'vitest';
import { buildCsp, directive } from '@/lib/http/csp';

const NONCE = 'dGVzdC1ub25jZS12YWx1ZQ==';

const dev = buildCsp({ nonce: NONCE, isDevelopment: true });
const prod = buildCsp({ nonce: NONCE, isDevelopment: false });

describe("'unsafe-inline' and nonces are mutually exclusive", () => {
  it('never puts a nonce in style-src', () => {
    // CSP spec: 'unsafe-inline' is IGNORED when a nonce or hash is present in
    // the same directive. Listing both does not mean "nonce, with inline as a
    // fallback" — it means nonce only, and every inline style is blocked.
    // React writes an inline style for every style={{...}} prop, so this
    // blanks the UI.
    for (const csp of [dev, prod]) {
      const styleSrc = directive(csp, 'style-src')!;
      expect(styleSrc).not.toContain('nonce-');
      expect(styleSrc).toContain("'unsafe-inline'");
    }
  });

  it('does put a nonce in script-src, and no unsafe-inline there', () => {
    for (const csp of [dev, prod]) {
      const scriptSrc = directive(csp, 'script-src')!;
      expect(scriptSrc).toContain(`'nonce-${NONCE}'`);
      // Scripts are the directive where strictness actually matters.
      expect(scriptSrc).not.toContain("'unsafe-inline'");
    }
  });
});

describe("'unsafe-eval' is development only", () => {
  it('is present in development, because Next HMR needs it', () => {
    // Without it the dev bundle throws an EvalError before React hydrates, so
    // the page renders and nothing is interactive.
    expect(directive(dev, 'script-src')).toContain("'unsafe-eval'");
  });

  it('is absent in production', () => {
    // It re-opens the injection vector a strict script-src exists to close.
    expect(directive(prod, 'script-src')).not.toContain("'unsafe-eval'");
  });
});

describe('websocket allowance', () => {
  it('is present in development for hot reload', () => {
    expect(directive(dev, 'connect-src')).toMatch(/\bws:/);
  });

  it('is absent in production', () => {
    const connectSrc = directive(prod, 'connect-src')!;
    expect(connectSrc).not.toMatch(/\bws:/);
    expect(connectSrc).not.toMatch(/\bwss:/);
  });
});

describe('the rest of the policy holds in both modes', () => {
  it.each([
    ['default-src', "'self'"],
    ['object-src', "'none'"],
    ['frame-ancestors', "'none'"],
    ['base-uri', "'self'"],
    ['form-action', "'self'"],
  ])('%s is %s', (name, expected) => {
    expect(directive(dev, name)).toBe(expected);
    expect(directive(prod, name)).toBe(expected);
  });

  it('permits only the origins the product actually talks to', () => {
    const connectSrc = directive(prod, 'connect-src')!;
    expect(connectSrc).toContain('https://*.supabase.co');
    expect(connectSrc).toContain('https://*.paddle.com');
    // No wildcard escape hatch.
    expect(connectSrc).not.toContain(' *');
  });

  it('allows Paddle.js and nothing else third-party for scripts', () => {
    const scriptSrc = directive(prod, 'script-src')!;
    expect(scriptSrc).toContain('https://cdn.paddle.com');
    expect(scriptSrc.split(' ').filter((s) => s.startsWith('https://'))).toEqual([
      'https://cdn.paddle.com',
    ]);
  });

  it('frames only Paddle, for the checkout overlay', () => {
    expect(directive(prod, 'frame-src')).toBe('https://*.paddle.com');
  });

  it('restricts images, which closes CSS-based exfiltration routes', () => {
    // Relevant precisely because style-src allows inline.
    expect(directive(prod, 'img-src')).toBe("'self' data: blob:");
  });
});

describe('directive parsing', () => {
  it('returns null for a directive that is not present', () => {
    expect(directive(prod, 'report-uri')).toBeNull();
  });

  it('does not confuse a prefix for a directive name', () => {
    // 'script-src' must not match 'script-src-elem'.
    const csp = "default-src 'self'; script-src-elem 'self'";
    expect(directive(csp, 'script-src')).toBeNull();
  });
});

/**
 * The prerender trap.
 *
 * A statically prerendered page has no request in scope when it is built, so
 * Next.js cannot stamp a nonce onto its scripts. Serving it a per-request nonce
 * blocks every script it contains: the HTML arrives whole, nothing hydrates, and
 * the only clue in the console is "Connection closed". This shipped to
 * production once. These tests exist so it cannot ship again.
 */
describe('static rendering compatibility', () => {
  it('falls back to unsafe-inline for scripts when there is no nonce', () => {
    const csp = buildCsp({ nonce: null, isDevelopment: false });
    const scriptSrc = directive(csp, 'script-src') ?? '';

    expect(scriptSrc).toContain("'unsafe-inline'");
    expect(scriptSrc).not.toContain('nonce-');
  });

  it('never emits both a nonce and unsafe-inline, which would disable the inline allowance', () => {
    const withNonce = directive(buildCsp({ nonce: 'abc', isDevelopment: false }), 'script-src') ?? '';

    expect(withNonce).toContain("'nonce-abc'");
    expect(withNonce).not.toContain("'unsafe-inline'");
  });

  it('still refuses unsafe-eval in production without a nonce', () => {
    const csp = buildCsp({ nonce: null, isDevelopment: false });
    expect(directive(csp, 'script-src') ?? '').not.toContain("'unsafe-eval'");
  });

  it('keeps every other directive identical with and without a nonce', () => {
    const a = buildCsp({ nonce: 'abc', isDevelopment: false });
    const b = buildCsp({ nonce: null, isDevelopment: false });

    for (const name of ['default-src', 'style-src', 'img-src', 'connect-src', 'frame-src', 'frame-ancestors', 'object-src', 'base-uri', 'form-action']) {
      expect(directive(b, name), `${name} must not differ`).toBe(directive(a, name));
    }
  });
});
