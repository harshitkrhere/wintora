/**
 * Validated environment access.
 *
 * Two separate accessors, deliberately:
 *
 *   publicEnv  - safe for the browser. Only NEXT_PUBLIC_ names.
 *   serverEnv  - server only. Throws if imported into a client bundle.
 *
 * The `server-only` guard is a runtime backstop; the real gate is
 * `scripts/verify-no-secret-leaks.mjs`, which fails the build if a server
 * secret is referenced from client code. See docs/SECURITY.md section 9.
 */

import { z } from 'zod';

const publicSchema = z.object({
  NEXT_PUBLIC_APP_URL: z.string().url().default('http://localhost:3000'),
  NEXT_PUBLIC_SUPABASE_URL: z.string().url().optional(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().optional(),
  NEXT_PUBLIC_ANALYTICS_DOMAIN: z.string().optional(),
  NEXT_PUBLIC_ANALYTICS_SCRIPT_URL: z.string().optional(),
});

const serverSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  SAFE_MODE: z
    .string()
    .optional()
    .transform((v) => v === 'true'),

  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  SUPABASE_DB_URL: z.string().optional(),
  SUPABASE_DOCUMENTS_BUCKET: z.string().default('user-documents'),

  // Razorpay is the only payment provider with an adapter, so there is no
  // PAYMENT_PROVIDER switch: a switch with one position is a place for stale
  // configuration to hide. Razorpay is a gateway, not a Merchant of Record;
  // the operator is the legal seller (docs/BILLING.md). Test and live modes are
  // told apart by the key id prefix (rzp_test_ / rzp_live_).
  /** Public by design: checkout.js is given it in the browser. */
  RAZORPAY_KEY_ID: z.string().regex(/^rzp_(test|live)_[A-Za-z0-9]+$/).optional(),
  /** Server-only. Authenticates the API and verifies the checkout callback. */
  RAZORPAY_KEY_SECRET: z.string().optional(),
  /** Server-only. Verifies the X-Razorpay-Signature on every webhook. */
  RAZORPAY_WEBHOOK_SECRET: z.string().optional(),
  /**
   * Razorpay signs no timestamp, so freshness comes from the event's own
   * created_at. Razorpay retries a failed delivery with backoff for about a
   * day; three days accepts every honest retry. The real replay defence is the
   * unique (provider, event_id) constraint, so this is defence in depth.
   */
  RAZORPAY_EVENT_MAX_AGE_SECONDS: z.coerce.number().int().positive().default(259_200),

  /**
   * OpenRouter by default: it brokers free model endpoints, and the operator is
   * bootstrapping. The model only rephrases a finding the deterministic engine
   * already produced, so a weaker free model costs polish, never correctness.
   * `none` is a first-class value, not a failure — the product works without AI.
   */
  AI_PROVIDER: z.enum(['openrouter', 'anthropic', 'none']).default('openrouter'),
  OPENROUTER_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  /**
   * Free endpoints are withdrawn and re-added without notice, so these are
   * starting points rather than guarantees. `npm run ai:models` lists what is
   * free today; `npm run ai:smoke` measures whether a model can actually satisfy
   * the output validator.
   */
  AI_MODEL_BASIC: z.string().default('nex-agi/nex-n2.5-mini:free'),
  AI_MODEL_ADVANCED: z.string().default('nex-agi/nex-n2.5-mini:free'),
  AI_MAX_INPUT_CHARS: z.coerce.number().int().positive().default(120_000),
  /**
   * Most endpoints are free because prompts may be retained or used for
   * training. Default false, which (a) asks OpenRouter to route only to
   * providers that do not collect prompt data, and (b) stops raw document text
   * being included in a prompt at all. Setting this true is a deliberate
   * privacy decision that must be reflected in the privacy notice before it is
   * used with real customer documents.
   */
  AI_ALLOW_PROMPT_TRAINING: z
    .string()
    .optional()
    .transform((v) => v === 'true'),
  /**
   * Whether a prompt may include raw text from the customer's document.
   *
   * Default false. The excerpt is the most sensitive thing in the request and
   * the least necessary: the deterministic explanation and its evidence already
   * contain everything the model is allowed to say. Redaction still applies when
   * this is enabled; this switch decides whether the text is eligible to be sent
   * at all, which is a question redaction cannot answer.
   */
  AI_SEND_DOCUMENT_EXCERPT: z
    .string()
    .optional()
    .transform((v) => v === 'true'),

  /**
   * How photographs and scans are read. PDFs with a text layer never need this:
   * they are read in-process. `azure` is Azure Document Intelligence's prebuilt
   * invoice model, chosen for its per-field confidence and a free tier that is
   * a real service with a data processing agreement.
   */
  OCR_PROVIDER: z.enum(['none', 'azure']).default('none'),
  AZURE_DI_ENDPOINT: z.string().url().optional(),
  AZURE_DI_KEY: z.string().optional(),
  /**
   * `structural` is byte sniffing plus PDF structure checks, in-process, with
   * no third party. It is what runs today. It is NOT signature-based antivirus,
   * and docs/LIMITATIONS.md says so. `none` keeps every upload PENDING and
   * refuses extraction, which is the fail-closed default for a fresh install.
   */
  MALWARE_SCAN_PROVIDER: z.enum(['none', 'structural']).default('none'),
  EMAIL_PROVIDER: z.string().default('none'),
  EMAIL_FROM: z.string().default('Wintora <info@wintora.online>'),

  CRON_SECRET: z.string().optional(),
  LOG_HASH_SECRET: z.string().optional(),
});

export type PublicEnv = z.infer<typeof publicSchema>;
export type ServerEnv = z.infer<typeof serverSchema>;

let cachedPublic: PublicEnv | null = null;
let cachedServer: ServerEnv | null = null;

/**
 * Treat a blank variable as an absent one.
 *
 * `.env.example` ships every key as `NAME=` and `env:sync` preserves that
 * shape, so a blank value is the normal state of anything not yet configured.
 * To zod, though, '' is a present string: `z.string().url().optional()` fails
 * validation on it and takes every route down with "Invalid url", and
 * `z.string().optional()` accepts it, so `KEY !== undefined` reports a secret
 * as configured when it is not. Both have happened. Normalise once, here,
 * before any schema sees the values.
 */
function stripBlanks(
  source: Readonly<Record<string, string | undefined>>,
): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(source)) {
    out[key] = value === undefined || value.trim() === '' ? undefined : value;
  }
  return out;
}

/**
 * The canonical origin, refusing to guess in production.
 *
 * `NEXT_PUBLIC_APP_URL` keeps a localhost default because local development
 * needs one. In production that default is actively harmful: the site boots,
 * every page renders, the sitemap advertises `http://localhost:3000/` to search
 * engines, and every POST fails the CSRF origin check with a bare 403. Nothing
 * announces the cause.
 *
 * Server-side only. Throwing in the browser would blank a page that is otherwise
 * readable, and the build already fails first: `sitemap.ts`, `robots.ts` and the
 * root layout all call this while prerendering.
 */
export function appUrl(): string {
  // An unset variable and an empty one mean the same thing here. A blank entry
  // in a hosting dashboard or a bare `KEY=` line yields '', which `??` treats as
  // present, so normalise before any other check: otherwise development returns
  // '' and `new URL('')` throws somewhere far from the cause.
  const raw = process.env.NEXT_PUBLIC_APP_URL;
  const value = raw === undefined || raw.trim() === '' ? undefined : raw.trim();

  // Enforced on a DEPLOYED production build, which is where the silent
  // localhost fallback actually bit. A local `next build` against .env.local
  // legitimately carries the development value and must still be able to
  // check that the project compiles; it gets a warning, not a refusal. Vercel
  // sets VERCEL=1; other hosts and CI generally set CI.
  const deployed = process.env.VERCEL === '1' || process.env.CI === 'true';
  const production = typeof window === 'undefined' && process.env.NODE_ENV === 'production';

  if (production && !deployed && (value === undefined || new URL(value).hostname === 'localhost')) {
    // eslint-disable-next-line no-console
    console.warn(
      '[wintora] NEXT_PUBLIC_APP_URL is a development value in a production build. ' +
        'Fine for a local build check; a deployment with this value would be refused.',
    );
  }

  if (production && deployed) {
    if (value === undefined) {
      throw new Error(
        'NEXT_PUBLIC_APP_URL is not set. Production cannot fall back to ' +
          'localhost: the sitemap would advertise it and every POST would fail ' +
          'the origin check. Set it to the canonical origin, including the ' +
          'subdomain (https://www.example.com), and REDEPLOY so the value is ' +
          'compiled in.',
      );
    }
    if (new URL(value).hostname === 'localhost') {
      throw new Error(
        `NEXT_PUBLIC_APP_URL is "${value}" in a production build. That is a ` +
          'development value; set the canonical public origin and redeploy.',
      );
    }
  }

  return value ?? 'http://localhost:3000';
}

export function publicEnv(): PublicEnv {
  if (cachedPublic === null) {
    // Next.js inlines NEXT_PUBLIC_ values at build time, so they must be read
    // as full property accesses rather than through a destructured object.
    cachedPublic = publicSchema.parse(
      stripBlanks({
        NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
        NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
        NEXT_PUBLIC_ANALYTICS_DOMAIN: process.env.NEXT_PUBLIC_ANALYTICS_DOMAIN,
        NEXT_PUBLIC_ANALYTICS_SCRIPT_URL: process.env.NEXT_PUBLIC_ANALYTICS_SCRIPT_URL,
      }),
    );
  }
  return cachedPublic;
}

export function serverEnv(): ServerEnv {
  if (typeof window !== 'undefined') {
    throw new Error(
      'serverEnv() was called in a browser context. Server secrets must never reach the client.',
    );
  }
  if (cachedServer === null) {
    cachedServer = serverSchema.parse(stripBlanks(process.env));
  }
  return cachedServer;
}

/**
 * Is a subsystem configured? Used to fail closed rather than half-work.
 * An unconfigured malware scanner, for example, must block extraction rather
 * than let documents through unscanned.
 */
export function isConfigured(
  subsystem: 'supabase' | 'payments' | 'ai' | 'ocr' | 'malwareScan' | 'email',
): boolean {
  const env = serverEnv();
  const pub = publicEnv();

  switch (subsystem) {
    case 'supabase':
      return (
        pub.NEXT_PUBLIC_SUPABASE_URL !== undefined &&
        pub.NEXT_PUBLIC_SUPABASE_ANON_KEY !== undefined &&
        env.SUPABASE_SERVICE_ROLE_KEY !== undefined
      );
    case 'payments':
      // All three are required: without the webhook secret the endpoint fails
      // closed, so checkout would succeed and entitlements would never arrive.
      return (
        env.RAZORPAY_KEY_ID !== undefined &&
        env.RAZORPAY_KEY_SECRET !== undefined &&
        env.RAZORPAY_WEBHOOK_SECRET !== undefined
      );
    case 'ai':
      // Each provider needs its own key. A key for the provider that is not
      // selected does not configure anything.
      switch (env.AI_PROVIDER) {
        case 'openrouter':
          return env.OPENROUTER_API_KEY !== undefined;
        case 'anthropic':
          return env.ANTHROPIC_API_KEY !== undefined;
        case 'none':
          return false;
      }
    case 'ocr':
      return (
        env.OCR_PROVIDER === 'azure' &&
        env.AZURE_DI_ENDPOINT !== undefined &&
        env.AZURE_DI_KEY !== undefined
      );
    case 'malwareScan':
      return env.MALWARE_SCAN_PROVIDER !== 'none';
    case 'email':
      return env.EMAIL_PROVIDER !== 'none';
  }
}

export function isSafeMode(): boolean {
  return serverEnv().SAFE_MODE === true;
}

/** Reset caches. Test-only. */
export function __resetEnvCache(): void {
  cachedPublic = null;
  cachedServer = null;
}
