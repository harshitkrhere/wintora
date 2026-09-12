/**
 * A blank variable is an absent variable.
 *
 * `.env.example` ships every key as `NAME=`, and env:sync preserves that
 * shape, so blank is the normal state of anything not yet configured. Two
 * things went wrong with that before this test existed: a blank URL field
 * failed validation and took every route down, and a blank secret counted as
 * "configured". Both are pinned here.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { __resetEnvCache, isConfigured, publicEnv, serverEnv } from '@/lib/env';

afterEach(() => {
  vi.unstubAllEnvs();
  __resetEnvCache();
});

describe('blank environment values', () => {
  it('a blank optional URL does not fail validation', () => {
    vi.stubEnv('AZURE_DI_ENDPOINT', '');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '   ');
    __resetEnvCache();

    expect(() => serverEnv()).not.toThrow();
    expect(() => publicEnv()).not.toThrow();
    expect(serverEnv().AZURE_DI_ENDPOINT).toBeUndefined();
    expect(publicEnv().NEXT_PUBLIC_SUPABASE_URL).toBeUndefined();
  });

  it('a blank secret is not configured', () => {
    vi.stubEnv('OCR_PROVIDER', 'azure');
    vi.stubEnv('AZURE_DI_ENDPOINT', 'https://example.cognitiveservices.azure.com/');
    vi.stubEnv('AZURE_DI_KEY', '');
    __resetEnvCache();

    expect(serverEnv().AZURE_DI_KEY).toBeUndefined();
    expect(isConfigured('ocr')).toBe(false);
  });

  it('a blank payment secret is not configured either', () => {
    vi.stubEnv('PADDLE_API_KEY', 'pdl_sdbx_apikey_test');
    vi.stubEnv('PADDLE_WEBHOOK_SECRET', '');
    __resetEnvCache();

    expect(isConfigured('payments')).toBe(false);
  });

  it('a real value still comes through untouched', () => {
    vi.stubEnv('AZURE_DI_ENDPOINT', 'https://wintora-di.cognitiveservices.azure.com/');
    __resetEnvCache();
    expect(serverEnv().AZURE_DI_ENDPOINT).toBe('https://wintora-di.cognitiveservices.azure.com/');
  });
});
