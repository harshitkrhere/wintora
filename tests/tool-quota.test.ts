/**
 * The free allowance on the anonymous checker.
 *
 * A signed cookie, verified server-side. The property that matters: a value
 * the server did not sign reads as zero, never as whatever number was typed
 * into it. The property that is deliberately NOT here: resistance to
 * clearing the cookie. That is a conversion nudge, not a security control,
 * and the module says so.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { __resetEnvCache } from '@/lib/env';
import { freeChecksCookie, readFreeChecks } from '@/lib/http/tool-quota';

afterEach(() => {
  vi.unstubAllEnvs();
  __resetEnvCache();
});

describe('free checks cookie', () => {
  it('round-trips a count the server signed', () => {
    vi.stubEnv('LOG_HASH_SECRET', 'test-secret');
    __resetEnvCache();
    const c = freeChecksCookie(3);
    expect(c.name).toBe('wintora_free_checks');
    expect(c.options.httpOnly).toBe(true);
    expect(readFreeChecks(c.value)).toBe(3);
  });

  it('reads a missing or malformed cookie as zero', () => {
    expect(readFreeChecks(undefined)).toBe(0);
    expect(readFreeChecks('')).toBe(0);
    expect(readFreeChecks('5')).toBe(0);
    expect(readFreeChecks('abc.def')).toBe(0);
  });

  // The whole point. Editing the number in devtools must not work.
  it('reads a tampered count as zero', () => {
    vi.stubEnv('LOG_HASH_SECRET', 'test-secret');
    __resetEnvCache();
    const c = freeChecksCookie(2);
    const [, signature] = c.value.split('.');
    expect(readFreeChecks(`9.${signature}`)).toBe(0);
    expect(readFreeChecks(`2.${signature}x`)).toBe(0);
  });

  it('a cookie signed under one secret is worthless under another', () => {
    vi.stubEnv('LOG_HASH_SECRET', 'secret-a');
    __resetEnvCache();
    const c = freeChecksCookie(4);
    vi.stubEnv('LOG_HASH_SECRET', 'secret-b');
    __resetEnvCache();
    expect(readFreeChecks(c.value)).toBe(0);
  });
});
