#!/usr/bin/env node
/**
 * Generate the two self-issued secrets straight into .env.local.
 *
 * CRON_SECRET and LOG_HASH_SECRET are not fetched from any provider: they are
 * random values you invent. Generating them on the terminal and pasting them
 * into a file means they pass through the clipboard, the scrollback, and
 * whatever else is reading either. This writes them directly and prints only
 * the byte length, so the value never appears on screen.
 *
 *   npm run init:secrets
 *
 * Existing values are never overwritten. Pass --force KEY to rotate one
 * deliberately.
 */

import { randomBytes } from 'node:crypto';
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';

const ENV_FILE = '.env.local';
const EXAMPLE_FILE = '.env.example';
const KEYS = ['CRON_SECRET', 'LOG_HASH_SECRET'];

const forceIndex = process.argv.indexOf('--force');
const forced = forceIndex === -1 ? [] : process.argv.slice(forceIndex + 1);

for (const key of forced) {
  if (!KEYS.includes(key)) {
    console.error(`Unknown key: ${key}. Expected one of ${KEYS.join(', ')}.`);
    process.exit(1);
  }
}

if (!existsSync(ENV_FILE)) {
  if (!existsSync(EXAMPLE_FILE)) {
    console.error(`Neither ${ENV_FILE} nor ${EXAMPLE_FILE} exists. Run from the repo root.`);
    process.exit(1);
  }
  copyFileSync(EXAMPLE_FILE, ENV_FILE);
  console.log(`Created ${ENV_FILE} from ${EXAMPLE_FILE}.`);
}

let contents = readFileSync(ENV_FILE, 'utf8');
const results = [];

for (const key of KEYS) {
  const line = new RegExp(`^${key}=(.*)$`, 'm');
  const match = line.exec(contents);
  const current = match?.[1]?.trim() ?? '';

  if (current.length > 0 && !forced.includes(key)) {
    results.push(`${key}: already set, left alone`);
    continue;
  }

  // 32 bytes of CSPRNG output. Never logged, never returned.
  const value = randomBytes(32).toString('hex');

  contents =
    match === null
      ? `${contents.replace(/\n*$/, '\n')}${key}=${value}\n`
      : contents.replace(line, `${key}=${value}`);

  results.push(
    `${key}: ${forced.includes(key) ? 'rotated' : 'generated'} (32 bytes, 64 hex chars)`,
  );
}

writeFileSync(ENV_FILE, contents, 'utf8');

console.log(`\n${ENV_FILE}`);
for (const result of results) console.log(`  ${result}`);
console.log('\nValues were written directly and never printed.');
console.log('Rotating LOG_HASH_SECRET breaks correlation with older logs, by design.\n');
