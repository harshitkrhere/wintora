#!/usr/bin/env node
/**
 * Deployment gate: server secrets must never reach a client bundle.
 *
 *   1. No server-only env var referenced from a client component, from
 *      src/components/, or from any file marked "use client".
 *   2. No secret-shaped value behind a NEXT_PUBLIC_ name.
 *   3. No committed secret literals anywhere in the repository.
 *   4. .env files are never committed.
 *
 * The service_role key BYPASSES Row Level Security, so a leak of that one key
 * defeats the entire database authorization layer. That is why this is a build
 * gate rather than a convention. See docs/SECURITY.md section 9.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, relative, sep } from 'node:path';

const ROOT = process.cwd();
const failures = [];

const SERVER_ONLY_ENV = [
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_DB_URL',
  'PADDLE_API_KEY',
  'PADDLE_WEBHOOK_SECRET',
  'OPENROUTER_API_KEY',
  'ANTHROPIC_API_KEY',
  'AZURE_DI_KEY',
  'OCR_API_KEY',
  'MALWARE_SCAN_API_KEY',
  'EMAIL_API_KEY',
  'CRON_SECRET',
  'LOG_HASH_SECRET',
];

/** Live credential shapes. Test keys and placeholders are allowed. */
const SECRET_LITERALS = [
  { name: 'Paddle live API key', pattern: /\bpdl_live_apikey_[A-Za-z0-9_]{16,}/ },
  { name: 'Paddle webhook secret', pattern: /\bpdl_ntfset_[A-Za-z0-9_]{16,}/ },
  { name: 'Anthropic API key', pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}/ },
  { name: 'OpenRouter API key', pattern: /\bsk-or-v1-[a-f0-9]{32,}/ },
  { name: 'JWT', pattern: /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\./ },
  { name: 'private key block', pattern: /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/ },
];

function fail(rule, file, detail) {
  failures.push({ rule, file, detail });
}

function walk(dir, extensions) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next' || entry === '.git') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full, extensions));
    } else if (extensions.length === 0 || extensions.some((ext) => entry.endsWith(ext))) {
      out.push(full);
    }
  }
  return out;
}

function rel(file) {
  return relative(ROOT, file).split(sep).join('/');
}

const sourceFiles = walk(join(ROOT, 'src'), ['.ts', '.tsx']);

// ---------------------------------------------------------------------------
// 1. Server secrets in client code
// ---------------------------------------------------------------------------

for (const file of sourceFiles) {
  const path = rel(file);
  const content = readFileSync(file, 'utf8');

  const isClientComponent =
    /^\s*['"]use client['"]/m.test(content) || path.startsWith('src/components/');

  if (!isClientComponent) continue;

  for (const name of SERVER_ONLY_ENV) {
    if (content.includes(name)) {
      fail(
        'secret-in-client',
        path,
        `references ${name} from client code; this ships the secret to the browser`,
      );
    }
  }

  // A client component must not import the server Supabase or payment modules
  // either: their transitive imports read server env at module load.
  for (const forbidden of ['@/lib/supabase/server', '@/lib/payments', '@/lib/env']) {
    if (content.includes(`from '${forbidden}'`)) {
      fail('secret-in-client', path, `client component imports ${forbidden}`);
    }
  }
}

// ---------------------------------------------------------------------------
// 2. Secret-shaped names behind NEXT_PUBLIC_
// ---------------------------------------------------------------------------

const SECRET_WORDS = /(SECRET|PRIVATE|SERVICE_ROLE|PASSWORD|_TOKEN|API_KEY)/;

for (const file of [...sourceFiles, join(ROOT, '.env.example')]) {
  if (!existsSync(file)) continue;
  const content = readFileSync(file, 'utf8');

  for (const match of content.matchAll(/NEXT_PUBLIC_[A-Z0-9_]+/g)) {
    const name = match[0];
    // Paddle's client token is public by design, like a publishable key.
    if (name === 'NEXT_PUBLIC_PADDLE_CLIENT_TOKEN') continue;
    if (name === 'NEXT_PUBLIC_SUPABASE_ANON_KEY') continue;

    if (SECRET_WORDS.test(name)) {
      fail(
        'public-secret',
        rel(file),
        `${name} is exposed to the browser but is named like a secret`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// 3. Committed secret literals
// ---------------------------------------------------------------------------

const scannable = [
  ...sourceFiles,
  ...walk(join(ROOT, 'supabase'), ['.sql']),
  ...walk(join(ROOT, 'scripts'), ['.mjs']),
  ...walk(join(ROOT, 'tests'), ['.ts']),
  ...walk(join(ROOT, 'docs'), ['.md']),
  join(ROOT, '.env.example'),
];

for (const file of scannable) {
  if (!existsSync(file)) continue;
  const path = rel(file);
  const content = readFileSync(file, 'utf8');

  for (const { name, pattern } of SECRET_LITERALS) {
    if (pattern.test(content)) {
      fail('committed-secret', path, `looks like a committed ${name}`);
    }
  }
}

// ---------------------------------------------------------------------------
// 4. Env files must not be COMMITTED
//
// A local .env.local is normal and expected: docs/DEPLOYMENT.md tells every
// developer to create one. What must never happen is one being tracked by git.
// So this checks tracking, not mere existence.
// ---------------------------------------------------------------------------

const ENV_FILES = ['.env', '.env.local', '.env.production', '.env.development'];

const insideGitRepo = existsSync(join(ROOT, '.git'));

if (insideGitRepo) {
  for (const candidate of ENV_FILES) {
    const tracked = spawnSync('git', ['ls-files', '--error-unmatch', candidate], {
      cwd: ROOT,
      stdio: 'ignore',
    });
    if (tracked.status === 0) {
      fail(
        'env-file',
        candidate,
        'environment file is tracked by git; remove it from the index and rotate every value it held',
      );
    }
  }
}

const gitignore = existsSync(join(ROOT, '.gitignore'))
  ? readFileSync(join(ROOT, '.gitignore'), 'utf8')
  : '';

// The .gitignore check runs regardless: it is what keeps an untracked file
// untracked, and it must be right before a repository is ever initialised.
for (const candidate of ['.env', '.env.local']) {
  if (!gitignore.split('\n').some((line) => line.trim() === candidate)) {
    fail('env-file', '.gitignore', `does not ignore ${candidate}`);
  }
}

// ---------------------------------------------------------------------------

if (failures.length > 0) {
  console.error(`\nverify-no-secret-leaks: ${failures.length} violation(s)\n`);
  for (const failure of failures) {
    console.error(`  [${failure.rule}] ${failure.file}\n      ${failure.detail}`);
  }
  console.error('');
  process.exit(1);
}

console.log(
  `verify-no-secret-leaks: ok (${sourceFiles.length} source files, ` +
    `${SERVER_ONLY_ENV.length} server secrets guarded)`,
);
