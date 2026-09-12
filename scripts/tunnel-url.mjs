#!/usr/bin/env node
/**
 * Find the running cloudflared quick tunnel and point the app at it.
 *
 *   npm run tunnel            # show the URL and what to paste where
 *   npm run tunnel -- --apply # also write NEXT_PUBLIC_APP_URL into .env.local
 *
 * A quick tunnel gets a new random hostname on every restart, and two places
 * need it: NEXT_PUBLIC_APP_URL and the Razorpay webhook URL. Copying it by hand, every restart,
 * is exactly the kind of thing that gets done twice and forgotten once.
 *
 * cloudflared publishes the hostname on its local metrics server, so this reads
 * it rather than asking you to scrape it out of the log.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const APPLY = process.argv.includes('--apply');
const ENV_FILE = '.env.local';

// cloudflared picks the first free port in this range for its metrics server.
const PORTS = [20241, 20242, 20243, 20244, 20245, 20246];

async function findTunnel() {
  for (const port of PORTS) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/quicktunnel`, {
        signal: AbortSignal.timeout(1500),
      });
      if (!response.ok) continue;
      const json = await response.json();
      if (typeof json.hostname === 'string' && json.hostname.length > 0) {
        return { hostname: json.hostname, port };
      }
    } catch {
      // Port not listening, or not a cloudflared metrics server. Try the next.
    }
  }
  return null;
}

const found = await findTunnel();

if (found === null) {
  console.error(
    '\nNo running cloudflared quick tunnel found.\n\n' +
      '  Start one in another terminal and leave it running:\n' +
      '    npx cloudflared tunnel --url http://localhost:3000\n\n' +
      '  Note: Ctrl+C kills the tunnel and the next run gets a NEW hostname.\n',
  );
  process.exit(1);
}

const base = `https://${found.hostname}`;

console.log(`\nTunnel found on metrics port ${found.port}\n`);
console.log(`  Public URL   ${base}\n`);
console.log('  Paste this into the Razorpay dashboard (Settings > Webhooks):\n');
console.log(`    Webhook URL   ${base}/api/webhooks/razorpay\n`);
console.log(
  `  No payment link is needed: checkout opens on ${base}/checkout for the signed-in customer.\n`,
);

if (!APPLY) {
  console.log('  Re-run with --apply to write NEXT_PUBLIC_APP_URL into .env.local.\n');
  process.exit(0);
}

if (!existsSync(ENV_FILE)) {
  console.error(`${ENV_FILE} not found. Run from the repo root.`);
  process.exit(1);
}

const source = readFileSync(ENV_FILE, 'utf8');
const line = /^NEXT_PUBLIC_APP_URL=.*$/m;

if (!line.test(source)) {
  console.error(`${ENV_FILE} has no NEXT_PUBLIC_APP_URL line. Run: npm run env:sync -- --apply`);
  process.exit(1);
}

writeFileSync(ENV_FILE, source.replace(line, `NEXT_PUBLIC_APP_URL=${base}`), 'utf8');

console.log(`  ${ENV_FILE}: NEXT_PUBLIC_APP_URL updated.`);
console.log('  Restart `npm run dev` so the new value is picked up.\n');
