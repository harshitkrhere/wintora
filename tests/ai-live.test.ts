/**
 * Live OpenRouter smoke test. Opt-in, network-dependent, never part of the gate.
 *
 *   npm run ai:smoke
 *   npm run ai:smoke -- google/gemma-4-31b-it:free nvidia/nemotron-3-super-120b-a12b:free
 *
 * Why this exists: "which free model will work" is a measurement, not an
 * opinion. A free endpoint can be withdrawn, throttled, or simply too weak to
 * follow a strict prompt, and the only honest way to know is to send a real
 * request through the real validator and look at what comes back.
 *
 * The finding below is synthetic and contains no customer data.
 */

import { describe, expect, it } from 'vitest';
import { createOpenRouterProvider } from '@/lib/ai/openrouter';
import { allowedNumbersFor, phraseFinding } from '@/lib/ai/provider';
import type { Finding } from '@/domain/analysis/types';

const LIVE = process.env.AI_LIVE === '1';

const SYNTHETIC_FINDING: Finding = {
  code: 'LINE_ITEM_SUM_MISMATCH',
  severity: 'REVIEW',
  title: 'Line items do not add up to the stated subtotal',
  explanation:
    'The individual charges on this statement add up to $1,240.00, but the ' +
    'subtotal printed on the statement is $1,420.00. That is a difference of ' +
    '$180.00. It is worth asking the billing office which figure is correct.',
  confidence: 'HIGH',
  isAiGenerated: false,
  evidence: [
    {
      documentId: '00000000-0000-4000-8000-000000000000',
      fieldPath: 'subtotalCents',
      observed: { subtotalCents: 142_000, lineItemSumCents: 124_000 },
      expected: { subtotalCents: 124_000 },
    },
  ],
};

describe.skipIf(!LIVE)('OpenRouter live smoke', () => {
  const apiKey = process.env.OPENROUTER_API_KEY ?? '';
  const models = (process.env.AI_SMOKE_MODELS ?? '')
    .split(',')
    .map((m) => m.trim())
    .filter((m) => m.length > 0);

  const outcomes: { model: string; ok: boolean; detail: string }[] = [];

  it('has something to test', () => {
    expect(apiKey, 'OPENROUTER_API_KEY missing').not.toBe('');
    expect(models.length, 'no models supplied').toBeGreaterThan(0);
  });

  for (const model of models) {
    it(
      `${model} produces output the validator accepts`,
      async () => {
        const provider = createOpenRouterProvider({
          apiKey,
          appUrl: 'http://localhost:3000',
          allowPromptTraining: process.env.AI_ALLOW_PROMPT_TRAINING === 'true',
          timeoutMs: 60_000,
        });

        // Force this model regardless of cost-level routing, so the result is
        // attributable to the model under test and not to env configuration.
        const pinned = {
          ...provider,
          complete: (req: Parameters<typeof provider.complete>[0]) =>
            provider.complete({ ...req, model }),
        };

        const result = await phraseFinding(pinned, {
          finding: SYNTHETIC_FINDING,
          allowedNumbers: allowedNumbersFor(SYNTHETIC_FINDING),
          costLevel: 'LOW',
        });

        outcomes.push({
          model,
          ok: result.aiUsed,
          detail: result.aiUsed ? result.text : (result.reason ?? 'unknown'),
        });

        // eslint-disable-next-line no-console
        console.log(
          `\n  ${result.aiUsed ? 'PASS' : 'FALLBACK'}  ${model}\n` +
            `    ${result.aiUsed ? result.text : `reason: ${result.reason ?? 'unknown'}`}\n`,
        );

        // A fallback is not a crash: the user would have seen correct
        // deterministic text. It does mean this model is not earning its place.
        expect(
          result.aiUsed,
          `${model} fell back (${result.reason ?? 'unknown'}). ` +
            'PROVIDER_ERROR usually means rate limited or unavailable; ' +
            'VALIDATION_REJECTED means the model invented a figure, a citation, ' +
            'or a deadline and was correctly blocked.',
        ).toBe(true);
      },
      90_000,
    );
  }
});
