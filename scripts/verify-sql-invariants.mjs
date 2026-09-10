#!/usr/bin/env node
/**
 * Deployment gate: structural invariants that a test cannot easily express.
 *
 *   1. Every table created has Row Level Security enabled, or an explicit
 *      annotated exemption.
 *   2. No plan-string comparison outside the entitlement layer.
 *   3. No dangerouslySetInnerHTML anywhere.
 *   4. The domain layer stays pure: no imports from src/lib, no network.
 *   5. No raw SQL string concatenation.
 *
 * Exits non-zero on any violation. See docs/SECURITY.md section 14.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = process.cwd();
const failures = [];

function fail(rule, file, detail) {
  failures.push({ rule, file, detail });
}

function walk(dir, extensions) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full, extensions));
    } else if (extensions.some((ext) => entry.endsWith(ext))) {
      out.push(full);
    }
  }
  return out;
}

function rel(file) {
  return relative(ROOT, file).split(sep).join('/');
}

// ---------------------------------------------------------------------------
// 1. RLS coverage
// ---------------------------------------------------------------------------

function checkRlsCoverage() {
  const migrationDir = join(ROOT, 'supabase', 'migrations');
  const sql = walk(migrationDir, ['.sql'])
    .map((file) => readFileSync(file, 'utf8'))
    .join('\n');

  const created = new Set();
  for (const match of sql.matchAll(
    /create\s+table\s+(?:if\s+not\s+exists\s+)?public\.(\w+)/gi,
  )) {
    created.add(match[1]);
  }

  const rlsEnabled = new Set();
  for (const match of sql.matchAll(
    /alter\s+table\s+public\.(\w+)\s+enable\s+row\s+level\s+security/gi,
  )) {
    rlsEnabled.add(match[1]);
  }

  const exempt = new Set();
  for (const match of sql.matchAll(/--\s*rls-exempt:\s*(\w+)\s*--\s*(.+)/gi)) {
    exempt.add(match[1]);
  }

  if (created.size === 0) {
    fail('rls', 'supabase/migrations', 'no CREATE TABLE statements found; parser broken?');
  }

  for (const table of created) {
    if (!rlsEnabled.has(table) && !exempt.has(table)) {
      fail(
        'rls',
        'supabase/migrations',
        `table public.${table} has no "enable row level security" and no "-- rls-exempt:" annotation`,
      );
    }
  }

  // FORCE matters too: without it the table owner bypasses its own policies.
  const forced = new Set();
  for (const match of sql.matchAll(
    /alter\s+table\s+public\.(\w+)\s+force\s+row\s+level\s+security/gi,
  )) {
    forced.add(match[1]);
  }
  for (const table of rlsEnabled) {
    if (!forced.has(table)) {
      fail(
        'rls',
        'supabase/migrations',
        `table public.${table} enables RLS but does not FORCE it`,
      );
    }
  }

  return { tables: created.size, enabled: rlsEnabled.size };
}

// ---------------------------------------------------------------------------
// 2. No plan-string comparisons outside the entitlement layer
// ---------------------------------------------------------------------------

const PLAN_COMPARISON =
  /(?:plan|tier|subscription)\w*\s*(?:===|!==|==|!=)\s*['"](?:free|essential|plus|pro)['"]/i;

const ENTITLEMENT_PATHS = [
  'src/config/',
  'src/domain/entitlements/',
  'src/domain/billing/',
  'scripts/',
  'tests/',
];

function checkNoPlanComparisons(files) {
  for (const file of files) {
    const path = rel(file);
    if (ENTITLEMENT_PATHS.some((prefix) => path.startsWith(prefix))) continue;

    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, index) => {
      if (line.trimStart().startsWith('*') || line.trimStart().startsWith('//')) return;
      if (PLAN_COMPARISON.test(line)) {
        fail(
          'entitlement',
          `${path}:${index + 1}`,
          'plan-string comparison outside the entitlement layer; use checkEntitlement()',
        );
      }
    });
  }
}

// ---------------------------------------------------------------------------
// 3. No dangerouslySetInnerHTML
// ---------------------------------------------------------------------------

function checkNoDangerousHtml(files) {
  for (const file of files) {
    const content = readFileSync(file, 'utf8');
    // Match a real USE of the prop, not a mention of its name. JSX writes
    // `dangerouslySetInnerHTML={...}` and an object literal writes
    // `dangerouslySetInnerHTML: {...}`; prose about why it is banned writes
    // neither. A bare substring check flags the security comments that explain
    // the rule, which trains people to ignore the gate.
    if (/dangerouslySetInnerHTML\s*[=:]/.test(content)) {
      fail(
        'xss',
        rel(file),
        'dangerouslySetInnerHTML is not permitted; generated letters render as text nodes',
      );
    }
  }
}

// ---------------------------------------------------------------------------
// 4. Domain purity
// ---------------------------------------------------------------------------

function checkDomainPurity(files) {
  for (const file of files) {
    const path = rel(file);
    if (!path.startsWith('src/domain/')) continue;

    const content = readFileSync(file, 'utf8');

    for (const match of content.matchAll(/from\s+['"]@\/lib\/([^'"]+)['"]/g)) {
      fail(
        'purity',
        path,
        `domain imports @/lib/${match[1]}; persistence belongs behind a port`,
      );
    }
    if (/\bfetch\s*\(/.test(content)) {
      fail('purity', path, 'domain performs network I/O');
    }
    if (/from\s+['"]@supabase|from\s+['"]@paddle/.test(content)) {
      fail('purity', path, 'domain imports a provider SDK directly');
    }
  }
}

// ---------------------------------------------------------------------------
// 5. No SQL string concatenation
// ---------------------------------------------------------------------------

function checkNoRawSql(files) {
  const patterns = [
    /`\s*select\s+[\s\S]{0,200}?\$\{/i,
    /`\s*insert\s+into\s+[\s\S]{0,200}?\$\{/i,
    /`\s*update\s+[\s\S]{0,200}?\$\{/i,
    /`\s*delete\s+from\s+[\s\S]{0,200}?\$\{/i,
  ];

  for (const file of files) {
    const content = readFileSync(file, 'utf8');
    for (const pattern of patterns) {
      if (pattern.test(content)) {
        fail(
          'sql-injection',
          rel(file),
          'SQL built by string interpolation; use parameterised queries',
        );
      }
    }
  }
}

// ---------------------------------------------------------------------------

const sourceFiles = walk(join(ROOT, 'src'), ['.ts', '.tsx']);
const rlsStats = checkRlsCoverage();
checkNoPlanComparisons(sourceFiles);
checkNoDangerousHtml(sourceFiles);
checkDomainPurity(sourceFiles);
checkNoRawSql(sourceFiles);

if (failures.length > 0) {
  console.error(`\nverify-sql-invariants: ${failures.length} violation(s)\n`);
  for (const failure of failures) {
    console.error(`  [${failure.rule}] ${failure.file}\n      ${failure.detail}`);
  }
  console.error('');
  process.exit(1);
}

console.log(
  `verify-sql-invariants: ok (${rlsStats.tables} tables, ${rlsStats.enabled} with RLS, ` +
    `${sourceFiles.length} source files checked)`,
);
