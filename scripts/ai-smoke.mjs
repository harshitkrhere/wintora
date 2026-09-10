#!/usr/bin/env node
/**
 * Measure whether a free OpenRouter model can actually do the one AI job in
 * Wintora: rephrasing an already-determined finding without inventing anything.
 *
 *   npm run ai:smoke
 *   npm run ai:smoke -- google/gemma-4-31b-it:free liquid/lfm-2.5-2.6b:free
 *
 * With no arguments it tests AI_MODEL_BASIC and AI_MODEL_ADVANCED from
 * .env.local. It sends a synthetic finding, never customer data, and it prints
 * no secret value.
 *
 * The work happens in tests/ai-live.test.ts so that the REAL output validator
 * runs against the response. A standalone script would have to re-implement the
 * validator, and a second copy would eventually disagree with the first.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ENV_FILE = '.env.local';

if (!existsSync(ENV_FILE)) {
  console.error(`${ENV_FILE} not found. Copy .env.example and fill it in.`);
  process.exit(1);
}

/** Parse without evaluating. Same approach as scripts/doctor.mjs. */
const env = {};
for (const line of readFileSync(ENV_FILE, 'utf8').split('\n')) {
  const trimmed = line.trim();
  if (trimmed.length === 0 || trimmed.startsWith('#')) continue;
  const eq = trimmed.indexOf('=');
  if (eq === -1) continue;
  const key = trimmed.slice(0, eq).trim();
  let value = trimmed.slice(eq + 1).trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  env[key] = value;
}

const apiKey = env.OPENROUTER_API_KEY ?? '';
if (apiKey === '') {
  console.error(
    [
      'OPENROUTER_API_KEY is empty in .env.local.',
      '',
      'Create a key at https://openrouter.ai/settings/keys and paste it into',
      '.env.local directly. Do not paste it into a chat window, a terminal',
      'argument, or a commit: all three are recorded somewhere.',
    ].join('\n'),
  );
  process.exit(1);
}

const requested = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const models =
  requested.length > 0
    ? requested
    : [env.AI_MODEL_BASIC, env.AI_MODEL_ADVANCED].filter(
        (m) => typeof m === 'string' && m.length > 0,
      );

if (models.length === 0) {
  console.error(
    'No models to test. Set AI_MODEL_BASIC in .env.local, or pass model ids as arguments.',
  );
  process.exit(1);
}

const unique = [...new Set(models)];

console.log(`\nSmoke-testing ${unique.length} model(s) against the real output validator:`);
for (const m of unique) console.log(`  - ${m}`);
console.log(
  [
    '',
    'PASS     the model rephrased the finding and the validator accepted it.',
    'FALLBACK the user would have seen the deterministic sentence instead.',
    '         PROVIDER_ERROR is usually a free-tier rate limit, or no',
    '         non-retaining provider available while AI_ALLOW_PROMPT_TRAINING',
    '         is false. VALIDATION_REJECTED means the model invented a figure,',
    '         citation or deadline and was correctly blocked.',
    '',
  ].join('\n'),
);

/**
 * Preflight: ask each model a trivial question and report exactly what the
 * provider said.
 *
 * This exists because `phraseFinding` deliberately logs only an error class, so
 * a rate limit, a data-policy refusal and a withdrawn model all arrive as a bare
 * `PROVIDER_ERROR`. That is correct for production, where a response body could
 * echo input, and useless for diagnosis. A synthetic prompt carries no customer
 * data, so the provider's own message is safe to surface here.
 */
const allowTraining = (env.AI_ALLOW_PROMPT_TRAINING ?? 'false') === 'true';

async function preflight(model) {
  const body = {
    model,
    max_tokens: 32,
    temperature: 0.2,
    messages: [{ role: 'user', content: 'Reply with the single word: ok' }],
  };
  if (!allowTraining) body.provider = { data_collection: 'deny' };

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
        'HTTP-Referer': 'http://localhost:3000',
        'X-Title': 'Wintora',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(45_000),
    });

    const json = await response.json().catch(() => null);
    const message = json?.error?.message ?? '';
    const content = json?.choices?.[0]?.message?.content ?? '';
    const reasoning = json?.choices?.[0]?.message?.reasoning ?? '';

    if (response.status === 200 && json?.error === undefined) {
      if (content.trim() !== '') return { ok: true, note: 'responds' };
      return {
        ok: false,
        note: reasoning !== '' ? 'spent its budget reasoning, returned no answer' : 'empty response',
      };
    }
    if (/data policy/i.test(message)) {
      return {
        ok: false,
        note:
          'refused: free endpoints for this model all train on prompts, and ' +
          'AI_ALLOW_PROMPT_TRAINING is false',
      };
    }
    if (response.status === 429) return { ok: false, note: 'rate limited (free capacity is shared)' };
    return { ok: false, note: `HTTP ${response.status} ${message.slice(0, 70)}`.trim() };
  } catch (error) {
    return { ok: false, note: `request failed: ${error.name}` };
  }
}

console.log(
  `Preflight (data_collection=${allowTraining ? 'allowed' : 'deny'}):`,
);
const reachable = [];
for (const model of unique) {
  const { ok, note } = await preflight(model);
  console.log(`  ${ok ? 'up  ' : 'down'}  ${model.padEnd(50)} ${note}`);
  if (ok) reachable.push(model);
}

if (reachable.length === 0) {
  console.error(
    [
      '',
      'No model responded, so there is nothing for the validator to judge.',
      '',
      'If the reason above is a data-policy refusal, the trade-off is real and',
      'yours to make: most free endpoints are free because they may train on',
      'prompts. Either pick a model that accepts the constraint (npm run ai:models,',
      'then preflight candidates here), set AI_PROVIDER=none and keep deterministic',
      'wording, or set AI_ALLOW_PROMPT_TRAINING=true as a documented decision.',
    ].join('\n'),
  );
  process.exit(1);
}

if (reachable.length < unique.length) {
  console.log(`\nTesting the ${reachable.length} model(s) that responded.`);
}
console.log('');

/**
 * Run vitest's own entry point with this node binary.
 *
 * Not `npx`: on Windows that resolves to npx.cmd, and Node refuses to spawn a
 * .cmd without `shell: true` (the CVE-2024-27980 mitigation), which fails with
 * EINVAL. Pointing at the .mjs directly needs no shell and behaves the same on
 * every platform.
 */
const vitestBin = fileURLToPath(
  new URL('../node_modules/vitest/vitest.mjs', import.meta.url),
);

if (!existsSync(vitestBin)) {
  console.error(`vitest not found at ${vitestBin}. Run "npm install" first.`);
  process.exit(1);
}

const result = spawnSync(
  process.execPath,
  [vitestBin, 'run', 'tests/ai-live.test.ts', '--reporter=verbose'],
  {
    stdio: 'inherit',
    env: {
      ...process.env,
      AI_LIVE: '1',
      OPENROUTER_API_KEY: apiKey,
      AI_SMOKE_MODELS: reachable.join(','),
      AI_ALLOW_PROMPT_TRAINING: env.AI_ALLOW_PROMPT_TRAINING ?? 'false',
    },
  },
);

// Never exit quietly on a spawn failure. An earlier version reported only
// `status`, so an EINVAL looked exactly like a test run that printed nothing.
if (result.error !== undefined) {
  console.error(`\nCould not start vitest: ${result.error.message}`);
  process.exit(1);
}
if (result.status === null) {
  console.error(`\nvitest was terminated by signal ${result.signal ?? 'unknown'}.`);
  process.exit(1);
}

process.exit(result.status);
