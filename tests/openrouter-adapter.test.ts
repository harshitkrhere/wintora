/**
 * OpenRouter adapter behaviour, offline.
 *
 * The adapter's job is not "call an API". It is to turn every way a brokered
 * free endpoint can disappoint into a thrown error, so that `phraseFinding`
 * falls back to the deterministic explanation instead of showing a user an empty
 * string or a chain of thought.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createOpenRouterProvider } from '@/lib/ai/openrouter';

const BASE = {
  apiKey: 'test-key',
  appUrl: 'https://wintora.example',
  allowPromptTraining: false,
};

const REQUEST = {
  system: 'system prompt',
  user: 'user prompt',
  model: 'vendor/model:free',
  maxTokens: 400,
};

function stubFetch(response: { status?: number; body: unknown }): ReturnType<typeof vi.fn> {
  const fn = vi.fn().mockResolvedValue({
    ok: (response.status ?? 200) < 400,
    status: response.status ?? 200,
    json: async () => response.body,
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

function completion(content: string | null, extra: Record<string, unknown> = {}): unknown {
  return { choices: [{ message: { content, ...extra } }] };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('OpenRouter adapter', () => {
  it('returns the assistant message content', async () => {
    stubFetch({ body: completion('  The charges do not match the subtotal.  ') });

    const provider = createOpenRouterProvider(BASE);
    await expect(provider.complete(REQUEST)).resolves.toBe(
      'The charges do not match the subtotal.',
    );
  });

  it('sends the model, token cap and a low temperature', async () => {
    const fetchMock = stubFetch({ body: completion('ok') });

    await createOpenRouterProvider(BASE).complete(REQUEST);

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.model).toBe('vendor/model:free');
    expect(body.max_tokens).toBe(400);
    expect(body.temperature).toBe(0.2);
    expect(body.messages).toEqual([
      { role: 'system', content: 'system prompt' },
      { role: 'user', content: 'user prompt' },
    ]);
  });

  // The privacy control. A medical bill rephrasing must not be routed to a
  // provider that trains on it, and this is the only thing that prevents it.
  it('denies prompt data collection by default', async () => {
    const fetchMock = stubFetch({ body: completion('ok') });

    await createOpenRouterProvider(BASE).complete(REQUEST);

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.provider).toEqual({ data_collection: 'deny' });
  });

  it('omits the routing restriction only when training is explicitly allowed', async () => {
    const fetchMock = stubFetch({ body: completion('ok') });

    await createOpenRouterProvider({ ...BASE, allowPromptTraining: true }).complete(REQUEST);

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.provider).toBeUndefined();
  });

  it('authenticates with a bearer token and identifies the app', async () => {
    const fetchMock = stubFetch({ body: completion('ok') });

    await createOpenRouterProvider(BASE).complete(REQUEST);

    const headers = fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer test-key');
    expect(headers['HTTP-Referer']).toBe('https://wintora.example');
    expect(headers['X-Title']).toBe('Wintora');
  });

  it('throws on a rate limit, which is routine on a free endpoint', async () => {
    stubFetch({ status: 429, body: {} });

    await expect(createOpenRouterProvider(BASE).complete(REQUEST)).rejects.toThrow(/429/);
  });

  // OpenRouter can report an upstream failure inside an HTTP 200. Trusting
  // response.ok alone would hand that object to the output validator, which
  // would reject it for the wrong reason and hide a provider problem.
  it('throws when an error is reported inside a 200 response', async () => {
    stubFetch({ status: 200, body: { error: { message: 'upstream down', code: 502 } } });

    await expect(createOpenRouterProvider(BASE).complete(REQUEST)).rejects.toThrow(/502/);
  });

  it('throws on an empty completion rather than returning empty text', async () => {
    stubFetch({ body: completion('   ') });

    await expect(createOpenRouterProvider(BASE).complete(REQUEST)).rejects.toThrow(/empty/i);
  });

  it('throws when a null content field is returned', async () => {
    stubFetch({ body: completion(null) });

    await expect(createOpenRouterProvider(BASE).complete(REQUEST)).rejects.toThrow(/empty/i);
  });

  // Reasoning models can spend the entire budget thinking. Chain-of-thought is
  // not an answer, and must never reach a user as if it were one.
  it('throws when a reasoning model returns reasoning but no content', async () => {
    stubFetch({
      body: completion('', { reasoning: 'Let me work through the arithmetic...' }),
    });

    await expect(createOpenRouterProvider(BASE).complete(REQUEST)).rejects.toThrow(
      /reasoning but no content/,
    );
  });

  it('throws when the response carries no choices at all', async () => {
    stubFetch({ body: { choices: [] } });

    await expect(createOpenRouterProvider(BASE).complete(REQUEST)).rejects.toThrow(/empty/i);
  });

  // The error message is logged. If it carried response text it could echo
  // redacted-but-sensitive input back into the log stream.
  it('never includes response text in the error it throws', async () => {
    stubFetch({
      status: 400,
      body: { error: { message: 'patient MRN 123456 rejected', code: 'bad_request' } },
    });

    await expect(createOpenRouterProvider(BASE).complete(REQUEST)).rejects.toThrow(
      /^OpenRouter returned 400$/,
    );
  });
});
