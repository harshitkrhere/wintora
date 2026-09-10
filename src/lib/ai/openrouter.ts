/**
 * OpenRouter adapter.
 *
 * OpenRouter is a broker, not a model vendor: one OpenAI-compatible endpoint in
 * front of many upstream providers, including free endpoints. It is used here
 * because the operator is bootstrapping and a free endpoint is worth more than a
 * marginally better sentence. See docs/AI_SAFETY.md.
 *
 * Two consequences of brokering shape this file:
 *
 * 1. The upstream provider is chosen per request, so "who processes this text"
 *    is a routing outcome rather than a fixed subprocessor. That is a privacy
 *    question, handled by `data_collection: 'deny'` below.
 * 2. Free endpoints are rate-limited and come and go. Every failure here must
 *    surface as a thrown error so `phraseFinding` falls back to the
 *    deterministic explanation, which is always correct.
 */

import type { AiProvider } from './provider';

const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';

interface ChatCompletionResponse {
  choices?: {
    message?: { content?: string | null; reasoning?: string | null };
    finish_reason?: string | null;
  }[];
  /**
   * OpenRouter can report an upstream failure inside a 200 response rather than
   * as an HTTP error, so the body is checked even on success.
   */
  error?: { message?: string; code?: number | string };
}

export interface OpenRouterOptions {
  readonly apiKey: string;
  /** Sent as HTTP-Referer for OpenRouter's attribution. Not a security control. */
  readonly appUrl: string;
  /**
   * When false (the default), OpenRouter is instructed to route only to
   * upstream providers that do not retain or train on prompt data.
   */
  readonly allowPromptTraining: boolean;
  readonly timeoutMs?: number;
}

export function createOpenRouterProvider(options: OpenRouterOptions): AiProvider {
  const { apiKey, appUrl, allowPromptTraining, timeoutMs = 30_000 } = options;

  return {
    name: 'openrouter',

    async complete({ system, user, model, maxTokens }): Promise<string> {
      const body: Record<string, unknown> = {
        model,
        max_tokens: maxTokens,
        temperature: 0.2,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      };

      if (!allowPromptTraining) {
        // Restrict routing to providers that do not collect prompt data. If no
        // such provider can serve the model, OpenRouter fails the request; that
        // is the intended outcome. Failing closed costs a nicer sentence.
        // Sending prompt text derived from a medical bill to a provider that
        // trains on it cannot be undone.
        body.provider = { data_collection: 'deny' };
      }

      const response = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${apiKey}`,
          'HTTP-Referer': appUrl,
          'X-Title': 'Wintora',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (!response.ok) {
        // 429 is ordinary on a free endpoint: shared capacity, not a bug. The
        // status is carried in the message so the caller's log records which,
        // but the message never carries response text, which could echo input.
        throw new Error(`OpenRouter returned ${response.status}`);
      }

      const json = (await response.json()) as ChatCompletionResponse;

      if (json.error !== undefined) {
        throw new Error(`OpenRouter upstream error (${json.error.code ?? 'unknown'})`);
      }

      const choice = json.choices?.[0];
      const content = choice?.message?.content ?? '';

      if (content.trim() === '') {
        // Reasoning models can spend the whole token budget in `reasoning` and
        // return empty content. Chain-of-thought is not an answer and is never
        // shown to a user, so this is a failure, not a result.
        throw new Error(
          choice?.message?.reasoning != null && choice.message.reasoning !== ''
            ? 'OpenRouter returned reasoning but no content'
            : 'OpenRouter returned an empty completion',
        );
      }

      return content.trim();
    },
  };
}
