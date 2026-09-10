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
  /** Paddle's client-side token. Public by design, like a publishable key. */
  NEXT_PUBLIC_PADDLE_CLIENT_TOKEN: z.string().optional(),
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

  // Paddle is a Merchant of Record: the legal seller to the customer. See
  // docs/BILLING.md. Stripe is not used: it is invite-only in India.
  PAYMENT_PROVIDER: z.enum(['paddle']).default('paddle'),
  PADDLE_API_KEY: z.string().optional(),
  PADDLE_WEBHOOK_SECRET: z.string().optional(),
  PADDLE_ENVIRONMENT: z.enum(['sandbox', 'production']).default('sandbox'),
  /**
   * Paddle's own SDKs default to 5 seconds, which is tight for a public
   * network hop and drops legitimate events. A dropped billing event means a
   * paying customer does not get what they bought. The real replay defence is
   * the unique (provider, event_id) constraint, so this is defence in depth
   * and is set wide enough not to reject honest traffic.
   */
  PADDLE_WEBHOOK_TOLERANCE_SECONDS: z.coerce.number().int().positive().default(300),

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

  OCR_PROVIDER: z.string().default('none'),
  MALWARE_SCAN_PROVIDER: z.string().default('none'),
  EMAIL_PROVIDER: z.string().default('none'),
  EMAIL_FROM: z.string().default('Wintora <no-reply@example.com>'),

  CRON_SECRET: z.string().optional(),
  LOG_HASH_SECRET: z.string().optional(),
});

export type PublicEnv = z.infer<typeof publicSchema>;
export type ServerEnv = z.infer<typeof serverSchema>;

let cachedPublic: PublicEnv | null = null;
let cachedServer: ServerEnv | null = null;

export function publicEnv(): PublicEnv {
  if (cachedPublic === null) {
    // Next.js inlines NEXT_PUBLIC_ values at build time, so they must be read
    // as full property accesses rather than through a destructured object.
    cachedPublic = publicSchema.parse({
      NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
      NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      NEXT_PUBLIC_PADDLE_CLIENT_TOKEN: process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN,
      NEXT_PUBLIC_ANALYTICS_DOMAIN: process.env.NEXT_PUBLIC_ANALYTICS_DOMAIN,
      NEXT_PUBLIC_ANALYTICS_SCRIPT_URL: process.env.NEXT_PUBLIC_ANALYTICS_SCRIPT_URL,
    });
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
    cachedServer = serverSchema.parse(process.env);
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
      // Both are required: without the webhook secret the endpoint fails
      // closed, so checkout would succeed and entitlements would never arrive.
      return (
        env.PADDLE_API_KEY !== undefined && env.PADDLE_WEBHOOK_SECRET !== undefined
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
      return env.OCR_PROVIDER !== 'none';
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
