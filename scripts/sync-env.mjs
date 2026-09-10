#!/usr/bin/env node
/**
 * Reconcile .env.local against .env.example.
 *
 *   npm run env:sync            # report drift only
 *   npm run env:sync -- --apply # rewrite .env.local from the template
 *
 * The template is the structure; your file is the values. This regenerates
 * .env.local using the template's keys, comments and ordering, carrying every
 * value you have already set across unchanged.
 *
 * It exists because a template change is easy to make and easy to forget to
 * propagate. When the payment provider changed, .env.example was updated and
 * .env.local silently kept a block of dead Stripe keys.
 *
 * Never prints a value. Keys with values are reported as "set", nothing more.
 * A key that is being dropped BUT still holds a value is reported loudly and,
 * without --force, blocks the rewrite: losing a credential you cannot re-fetch
 * is worse than a tidy file.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const APPLY = process.argv.includes('--apply');
const FORCE = process.argv.includes('--force');

const TEMPLATE = '.env.example';
const TARGET = '.env.local';

for (const file of [TEMPLATE, TARGET]) {
  if (!existsSync(file)) {
    console.error(`${file} not found. Run from the repo root.`);
    process.exit(1);
  }
}

/** Parse `KEY=value` lines, preserving the raw value exactly. */
function parse(text) {
  const values = new Map();
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    values.set(trimmed.slice(0, eq).trim(), trimmed.slice(eq + 1));
  }
  return values;
}

const templateText = readFileSync(TEMPLATE, 'utf8');
const targetText = readFileSync(TARGET, 'utf8');

const templateKeys = parse(templateText);
const currentValues = parse(targetText);

const isSet = (v) => typeof v === 'string' && v.trim().length > 0;

const added = [];
const removed = [];
const carried = [];

for (const key of templateKeys.keys()) {
  if (!currentValues.has(key)) {
    added.push(key);
  } else if (isSet(currentValues.get(key))) {
    carried.push(key);
  }
}

for (const [key, value] of currentValues) {
  if (!templateKeys.has(key)) {
    removed.push({ key, hadValue: isSet(value) });
  }
}

// ---------------------------------------------------------------------------

console.log(`\nEnvironment drift  (${TARGET} vs ${TEMPLATE})\n`);

if (added.length > 0) {
  console.log('  Missing from your file (will be added, empty):');
  for (const key of added) console.log(`    + ${key}`);
  console.log('');
}

if (removed.length > 0) {
  console.log('  No longer in the template (will be removed):');
  for (const { key, hadValue } of removed) {
    console.log(`    - ${key}${hadValue ? '   <-- HAS A VALUE' : ''}`);
  }
  console.log('');
}

if (carried.length > 0) {
  console.log(`  Values carried over unchanged: ${carried.length}`);
  for (const key of carried) console.log(`    = ${key} (set)`);
  console.log('');
}

if (added.length === 0 && removed.length === 0) {
  console.log('  No drift. Nothing to do.\n');
  process.exit(0);
}

const droppingValues = removed.filter((r) => r.hadValue);
if (droppingValues.length > 0 && !FORCE) {
  console.error(
    `  ${droppingValues.length} key(s) being removed still hold a value.\n` +
      '  Copy anything you still need, then re-run with --force.\n',
  );
  if (APPLY) process.exit(1);
}

if (!APPLY) {
  console.log('  Report only. Re-run with --apply to rewrite the file.\n');
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Rewrite: template structure, your values.
// ---------------------------------------------------------------------------

const output = templateText
  .split('\n')
  .map((line) => {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith('#')) return line;
    const eq = trimmed.indexOf('=');
    if (eq === -1) return line;

    const key = trimmed.slice(0, eq).trim();
    const existing = currentValues.get(key);
    // An existing value wins; otherwise keep the template's default.
    return isSet(existing) ? `${key}=${existing}` : line;
  })
  .join('\n');

writeFileSync(TARGET, output, 'utf8');

console.log(`  ${TARGET} rewritten.`);
console.log(`  ${carried.length} value(s) preserved, ${added.length} key(s) added, ${removed.length} removed.`);
console.log('  No value was printed.\n');
