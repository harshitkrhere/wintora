#!/usr/bin/env node
/**
 * The email log, from the operator's machine.
 *
 *   npm run email:log                      last 50 messages
 *   npm run email:log -- --kind WELCOME    one kind
 *   npm run email:log -- --status BOUNCED  one status
 *   npm run email:log -- --with-address    resolve each account's email (asks Auth)
 *   npm run email:log -- --limit 200
 *
 * Reads SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY from .env.local. Prints
 * subjects and statuses, never bodies; use --with-address only when you are
 * investigating a delivery problem, since it puts addresses on your screen.
 */

import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

function env() {
  const out = {};
  for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (m) out[m[1]] = m[2].trim().replace(/^"(.*)"$/, '$1');
  }
  return out;
}

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const e = env();
const url = e.NEXT_PUBLIC_SUPABASE_URL;
const key = e.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env.local');
  process.exit(1);
}

const admin = createClient(url, key, { auth: { persistSession: false } });
let query = admin
  .from('email_log')
  .select('id, user_id, kind, subject, provider, provider_message_id, status, error_class, attempts, created_at, sent_at, last_event_at')
  .order('created_at', { ascending: false })
  .limit(Number(flag('--limit') ?? 50));
if (flag('--kind')) query = query.eq('kind', flag('--kind'));
if (flag('--status')) query = query.eq('status', flag('--status'));

const { data, error } = await query;
if (error) {
  console.error('query failed:', error.message);
  process.exit(1);
}

const withAddress = args.includes('--with-address');
const addresses = new Map();
if (withAddress) {
  for (const id of new Set(data.map((r) => r.user_id))) {
    const { data: u } = await admin.auth.admin.getUserById(id);
    addresses.set(id, u?.user?.email ?? '?');
  }
}

const pad = (s, n) => String(s ?? '').padEnd(n).slice(0, n);
const when = (iso) => (iso ? new Date(iso).toISOString().replace('T', ' ').slice(0, 16) : '');

console.log(
  [pad('sent/created', 16), pad('status', 11), pad('kind', 18), pad('subject', 44), pad('provider id', 24), withAddress ? 'to' : 'account'].join('  '),
);
for (const r of data) {
  console.log(
    [
      pad(when(r.sent_at ?? r.created_at), 16),
      pad(r.status + (r.attempts > 1 ? `×${r.attempts}` : ''), 11),
      pad(r.kind, 18),
      pad(r.subject, 44),
      pad(r.provider_message_id ?? (r.error_class ? `(${r.error_class})` : ''), 24),
      withAddress ? addresses.get(r.user_id) : r.user_id.slice(0, 8),
    ].join('  '),
  );
}
console.log(`\n${data.length} row(s).`);

const counts = {};
for (const r of data) counts[r.status] = (counts[r.status] ?? 0) + 1;
console.log(Object.entries(counts).map(([k, v]) => `${k} ${v}`).join('  '));
