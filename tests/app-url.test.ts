/**
 * The canonical origin must never be guessed in production.
 *
 * This was a confirmed HIGH finding: a production build with
 * NEXT_PUBLIC_APP_URL unset booted cleanly, served a sitemap advertising
 * http://localhost:3000/ to search engines, and failed every POST with a bare
 * 403 from the CSRF origin check. Nothing pointed at the cause.
 *
 * Failing the build is the correct outcome. `sitemap.ts`, `robots.ts` and the
 * root layout all call appUrl() while prerendering, so a missing value stops the
 * deploy instead of shipping a site that looks fine and cannot accept a form.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { appUrl } from '@/lib/env';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('appUrl', () => {
  it('returns the configured origin', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://www.wintora.online');
    expect(appUrl()).toBe('https://www.wintora.online');
  });

  it('falls back to localhost outside production, because development needs one', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('NEXT_PUBLIC_APP_URL', '');
    expect(appUrl()).toBe('http://localhost:3000');
  });

  it('throws on a deployed production build when the variable is missing', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VERCEL', '1');
    vi.stubEnv('NEXT_PUBLIC_APP_URL', '');
    expect(() => appUrl()).toThrow(/NEXT_PUBLIC_APP_URL is not set/);
  });

  // The nastier case: the variable IS set, to a value that is merely wrong.
  // Copying .env.local into a hosting dashboard produces exactly this.
  it('throws on a deployed production build when the value is a development one', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VERCEL', '1');
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://localhost:3000');
    expect(() => appUrl()).toThrow(/development value/);
  });

  // A developer running `next build` locally has the development value and
  // must not be blocked from checking that the project compiles.
  it('only warns on a LOCAL production build with the development value', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VERCEL', '');
    vi.stubEnv('CI', '');
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://localhost:3000');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(appUrl()).toBe('http://localhost:3000');
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it('accepts a real origin on a deployed production build', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VERCEL', '1');
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://www.wintora.online');
    expect(appUrl()).toBe('https://www.wintora.online');
  });

  // The apex/www distinction is not normalised away. The CSRF check compares
  // the browser's Origin against this string exactly, so www.example.com and
  // example.com are different origins and must stay different here.
  it('preserves the subdomain exactly as configured', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://wintora.online');
    expect(appUrl()).toBe('https://wintora.online');
  });
});
