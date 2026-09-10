#!/usr/bin/env node
/**
 * List the OpenRouter models that are free *right now*.
 *
 * Free endpoints on OpenRouter are not a stable catalogue: they are added,
 * rate-limited and withdrawn without notice. Hard-coding a model id that was
 * free once means a silent fallback to deterministic text months later, so this
 * script exists to re-check rather than to trust a note in a doc.
 *
 * Reads no secrets. /api/v1/models is public, so this is safe to run anywhere.
 *
 *   npm run ai:models           # free models only
 *   npm run ai:models -- --all  # include paid, for comparison
 */

const ENDPOINT = 'https://openrouter.ai/api/v1/models';

/**
 * Every price OpenRouter quotes must be zero.
 *
 * Deliberately not an allowlist of known keys. Google's Lyria quotes zero for
 * prompt, completion, request and image, and bills $0.08 per song under a key an
 * allowlist would not have named; OpenRouter adds pricing dimensions over time.
 * Any unrecognised non-zero number therefore means "not free".
 */
function isFree(model) {
  const pricing = model.pricing ?? {};
  return Object.values(pricing).every((value) => {
    const n = Number(value);
    // A non-numeric value is not a price we can clear, so treat it as paid.
    return Number.isFinite(n) ? n === 0 : false;
  });
}

/**
 * Zero price does not mean "usable for rephrasing". Google's Lyria music models
 * and NVIDIA's content-safety classifier both quote zero and both appear in the
 * free list; neither can rewrite a sentence. Require text in and text out.
 */
function isTextToText(model) {
  const a = model.architecture ?? {};
  const input = a.input_modalities ?? [];
  const output = a.output_modalities ?? [];
  if (input.length > 0 || output.length > 0) {
    // Output must be text and ONLY text. Lyria declares ["text","audio"], so
    // asking whether the list contains text is not enough.
    return input.includes('text') && output.length === 1 && output[0] === 'text';
  }
  // Older records only carry the combined `modality` string, e.g. "text->text".
  return typeof a.modality === 'string' ? a.modality.endsWith('->text') : false;
}

function fmt(n) {
  if (typeof n !== 'number' || Number.isNaN(n)) return '?';
  return n >= 1000 ? `${Math.round(n / 1000)}k` : String(n);
}

async function main() {
  const showAll = process.argv.includes('--all');

  let response;
  try {
    response = await fetch(ENDPOINT, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(20_000),
    });
  } catch (error) {
    console.error(`Could not reach OpenRouter: ${error.message}`);
    process.exit(1);
  }

  if (!response.ok) {
    console.error(`OpenRouter returned ${response.status}`);
    process.exit(1);
  }

  const { data } = await response.json();
  if (!Array.isArray(data)) {
    console.error('Unexpected response shape from OpenRouter.');
    process.exit(1);
  }

  const textOnly = data.filter(isTextToText);
  const models = (showAll ? textOnly : textOnly.filter(isFree)).sort(
    (a, b) => (b.context_length ?? 0) - (a.context_length ?? 0),
  );
  const dropped = data.length - textOnly.length;

  console.log(
    `${models.length} text-to-text ${showAll ? '' : 'free '}model(s) on OpenRouter, widest context first.`,
  );
  console.log(`(${dropped} non-text model(s) excluded: image, audio, classifier.)\n`);
  console.log(
    `${'MODEL ID'.padEnd(52)} ${'CTX'.padStart(6)}  ${'OUT'.padStart(6)}  NAME`,
  );
  console.log('-'.repeat(110));

  for (const m of models) {
    const out = m.top_provider?.max_completion_tokens ?? null;
    console.log(
      `${String(m.id).padEnd(52)} ${fmt(m.context_length).padStart(6)}  ${fmt(out).padStart(6)}  ${m.name ?? ''}`,
    );
  }

  if (!showAll) {
    console.log(
      [
        '',
        'Before choosing one, check three things that matter more than the ranking above:',
        '',
        '  1. Rate limits. Free endpoints are shared and throttled. Wintora treats a',
        '     throttled call as PROVIDER_ERROR and shows the deterministic sentence, so a',
        '     tight limit degrades polish, never correctness.',
        '  2. Prompt retention. Most free endpoints are free because prompts may be',
        '     logged or used for training. See docs/AI_SAFETY.md, section "Free model',
        '     endpoints", and set AI_PROVIDER_TRAINS_ON_PROMPTS accordingly.',
        '  3. Instruction-following. The rephrasing prompt is strict and output is',
        '     validated; a weak model simply gets rejected more often.',
        '',
        'Set the chosen ids as AI_MODEL_BASIC and AI_MODEL_ADVANCED in .env.local.',
      ].join('\n'),
    );
  }
}

await main();
