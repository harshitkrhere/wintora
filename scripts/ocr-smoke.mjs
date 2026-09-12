#!/usr/bin/env node
/**
 * Prove the Azure Document Intelligence integration against the real service.
 *
 *   npm run ocr:smoke
 *
 * Loads .env.local, prints no secret, and runs tests/ocr-live.test.ts through
 * vitest so the REAL adapter is exercised. Sends one synthetic bill.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

if (!existsSync('.env.local')) {
  console.error('.env.local not found.');
  process.exit(1);
}

const env = {};
for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const t = line.trim();
  if (t.length === 0 || t.startsWith('#')) continue;
  const i = t.indexOf('=');
  if (i === -1) continue;
  let v = t.slice(i + 1).trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  env[t.slice(0, i).trim()] = v;
}

const endpoint = env.AZURE_DI_ENDPOINT ?? '';
const apiKey = env.AZURE_DI_KEY ?? '';
if (endpoint === '' || apiKey === '') {
  console.error('AZURE_DI_ENDPOINT and AZURE_DI_KEY must both be set in .env.local.');
  process.exit(1);
}

console.log(`\nSending one synthetic bill to ${new URL(endpoint).hostname} ...\n`);

const vitestBin = fileURLToPath(new URL('../node_modules/vitest/vitest.mjs', import.meta.url));
const result = spawnSync(
  process.execPath,
  [vitestBin, 'run', 'tests/ocr-live.test.ts', '--reporter=verbose'],
  {
    stdio: 'inherit',
    env: { ...process.env, OCR_LIVE: '1', AZURE_DI_ENDPOINT: endpoint, AZURE_DI_KEY: apiKey },
  },
);

if (result.error !== undefined) {
  console.error(`\nCould not start vitest: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
